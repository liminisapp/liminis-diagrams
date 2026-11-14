import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import { parseC4 } from '../core/parser';
import { layoutC4Diagram } from '../core/layout';
import type { C4Edit } from '../core/edit';

/**
 * Re-parenting by drag: drop onto a boundary, ⌥-drag out, the drop-target
 * highlight and cancel. As in the other renderer tests the CTM is an identity
 * stub (client px === SVG units).
 */

const SOURCE = `Person(user, "User")
System_Boundary(a, "A") {
  Container_Boundary(inner, "Inner") {
    Component(deep, "Deep", "Go")
  }
  Container(web, "Web", "React")
}
System_Boundary(b, "B") {
  Container(db, "DB", "SQL")
}`;

beforeEach(() => {
  const proto = window.SVGSVGElement?.prototype as unknown as Record<string, unknown>;
  proto.createSVGPoint = function createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform() {
        return { x: this.x, y: this.y };
      },
    };
  };
  proto.getScreenCTM = function getScreenCTM() {
    return { inverse() { return this; } };
  };
});

type Positions = Record<string, { x: number; y: number }>;
type Rect = { x: number; y: number; width: number; height: number };

function setup(overrides: Record<string, unknown> = {}) {
  const diagram = parseC4(SOURCE).diagram!;
  const autoLayout = layoutC4Diagram(diagram);
  const onEdit = vi.fn<(edit: C4Edit, ctx: { positions: Positions }) => void>();
  const onPositionChange = vi.fn();
  const utils = render(
    <C4InteractiveRenderer
      diagram={diagram}
      isDarkMode={false}
      isEditMode
      manualPositions={{}}
      onPositionChange={onPositionChange}
      onEdit={onEdit}
      {...overrides}
    />,
  );
  return { ...utils, diagram, autoLayout, onEdit, onPositionChange };
}

const rectOf = (c: HTMLElement, id: string): Rect => {
  const r = c.querySelector(`[data-node-id="${id}"]`)!;
  return {
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    width: Number(r.getAttribute('width')),
    height: Number(r.getAttribute('height')),
  };
};
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const hitOf = (c: HTMLElement, id: string) => c.querySelector(`[data-node-id="${id}"]`)!;
const highlight = (c: HTMLElement) => c.querySelector('[data-drop-target]')?.getAttribute('data-drop-target') ?? null;
const EMPTY = { x: 5000, y: 5000 };

/** Press on the centre of `id`, drag to `to`, and release (⌥ held at release when `altUp`). */
function drag(
  c: HTMLElement,
  id: string,
  to: { x: number; y: number },
  opts: { altMove?: boolean; altUp?: boolean; release?: boolean } = {},
) {
  const from = centre(rectOf(c, id));
  fireEvent.pointerDown(hitOf(c, id), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y, altKey: opts.altMove ?? opts.altUp ?? false });
  if (opts.release !== false) {
    fireEvent.pointerUp(window, { pointerId: 1, clientX: to.x, clientY: to.y, altKey: opts.altUp ?? false });
  }
  return from;
}

describe('reparent: drop onto a boundary', () => {
  it('reports a reparent into the boundary, with positions, and no onPositionChange', () => {
    const { container, onEdit, onPositionChange } = setup();
    const target = centre(rectOf(container, 'b'));
    drag(container, 'user', target);

    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({ kind: 'reparent', id: 'user', parent: 'b' });
    expect(ctx.positions.user).toBeDefined();
    // Every node is pinned, so nothing reshuffles when the source changes.
    for (const id of ['user', 'a', 'inner', 'deep', 'web', 'b', 'db']) expect(ctx.positions[id]).toBeDefined();
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('clamps a nested drop into the new parent\'s content area', () => {
    const { container, onEdit } = setup();
    const b = rectOf(container, 'b');
    // Release at the very corner of B: the dragged node's origin would be left of and above it.
    drag(container, 'user', { x: b.x + 2, y: b.y + 2 });
    const [, ctx] = onEdit.mock.calls[0];
    expect(ctx.positions.user.x).toBeGreaterThanOrEqual(b.x + 40);
    expect(ctx.positions.user.y).toBeGreaterThanOrEqual(b.y + 55);
  });

  it('picks the innermost boundary under the pointer', () => {
    const { container, onEdit } = setup();
    drag(container, 'user', centre(rectOf(container, 'deep')));
    expect(onEdit.mock.calls[0][0]).toEqual({ kind: 'reparent', id: 'user', parent: 'inner' });
  });

  it('moves a whole boundary into another, its descendants keeping their offsets', () => {
    const { container, autoLayout, onEdit } = setup();
    const before = (id: string) => autoLayout.nodes.find((n) => n.id === id)!;
    drag(container, 'a', centre(rectOf(container, 'b')));
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({ kind: 'reparent', id: 'a', parent: 'b' });
    const dx = ctx.positions.a.x - before('a').x;
    const dy = ctx.positions.a.y - before('a').y;
    for (const id of ['inner', 'deep', 'web']) {
      expect(ctx.positions[id].x - before(id).x).toBeCloseTo(dx);
      expect(ctx.positions[id].y - before(id).y).toBeCloseTo(dy);
    }
    // Unrelated nodes stay where they were.
    expect(ctx.positions.user).toEqual({ x: before('user').x, y: before('user').y });
    expect(ctx.positions.db).toEqual({ x: before('db').x, y: before('db').y });
  });

  it('reports nothing structural for a drop onto the item itself or its own descendant', () => {
    const { container, onEdit, onPositionChange } = setup();
    drag(container, 'a', centre(rectOf(container, 'deep')));
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('shows no highlight while a boundary is over itself or a descendant', () => {
    const { container } = setup();
    drag(container, 'a', centre(rectOf(container, 'deep')), { release: false });
    expect(highlight(container)).toBeNull();
  });

  it('a plain drag inside the current parent is only a position change', () => {
    const { container, onEdit, onPositionChange } = setup();
    const web = rectOf(container, 'web');
    drag(container, 'web', { x: web.x + web.width / 2 + 5, y: web.y + web.height / 2 + 5 });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('a plain drag onto empty canvas is not a reparent: the boundary just grows', () => {
    const { container, onEdit, onPositionChange } = setup();
    drag(container, 'web', EMPTY);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('a plain drop onto an ancestor of the current parent lifts the item into it', () => {
    const { container, onEdit } = setup();
    // `deep` is in `inner`, which is in `a`: drop on a part of `a` outside `inner`.
    const a = rectOf(container, 'a');
    const inner = rectOf(container, 'inner');
    const p = { x: Math.min(a.x + a.width - 5, inner.x + inner.width + 10), y: a.y + a.height - 5 };
    drag(container, 'deep', p);
    expect(onEdit.mock.calls[0]?.[0]).toEqual({ kind: 'reparent', id: 'deep', parent: 'a' });
  });

  it('a click without movement reports nothing structural', () => {
    const { container, onEdit } = setup();
    const p = centre(rectOf(container, 'web'));
    fireEvent.pointerDown(hitOf(container, 'web'), { pointerId: 1, pointerType: 'mouse', clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x, clientY: p.y, altKey: true });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('without onEdit, behaves exactly as before: positions only', () => {
    const { container, onPositionChange } = setup({ onEdit: undefined });
    drag(container, 'user', centre(rectOf(container, 'b')));
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(highlight(container)).toBeNull();
  });
});

describe('reparent: option-drag out', () => {
  it('to empty canvas reports a top-level reparent and moves no other position', () => {
    const { container, autoLayout, onEdit } = setup();
    drag(container, 'web', EMPTY, { altUp: true });
    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({ kind: 'reparent', id: 'web' });
    expect('parent' in edit).toBe(false);
    for (const n of autoLayout.nodes) {
      if (n.id === 'web') continue;
      expect(ctx.positions[n.id]).toEqual({ x: n.x, y: n.y });
    }
    // The item keeps where it was dropped, not where it started.
    expect(ctx.positions.web).not.toEqual({ x: autoLayout.nodes.find((n) => n.id === 'web')!.x, y: autoLayout.nodes.find((n) => n.id === 'web')!.y });
  });

  it('onto another boundary reports a reparent into it', () => {
    const { container, onEdit } = setup();
    drag(container, 'web', centre(rectOf(container, 'db')), { altUp: true });
    expect(onEdit.mock.calls[0][0]).toEqual({ kind: 'reparent', id: 'web', parent: 'b' });
  });

  it('dropped on its own parent is a position change only', () => {
    const { container, onEdit, onPositionChange } = setup();
    const web = rectOf(container, 'web');
    drag(container, 'web', { x: web.x + web.width / 2 + 5, y: web.y + web.height / 2 }, { altUp: true });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('on a top-level item behaves as a plain drag', () => {
    const { container, onEdit, onPositionChange } = setup();
    drag(container, 'user', EMPTY, { altUp: true });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('reads ⌥ at release: held during the move but not at release is a plain drag', () => {
    const { container, onEdit } = setup();
    drag(container, 'web', EMPTY, { altMove: true, altUp: false });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('reads ⌥ at release: pressed only at release still moves out', () => {
    const { container, onEdit } = setup();
    drag(container, 'web', EMPTY, { altMove: false, altUp: true });
    expect(onEdit.mock.calls[0][0]).toEqual({ kind: 'reparent', id: 'web' });
  });

  it('does not find the old parent following the child out of it', () => {
    const { container } = setup();
    // Far from `a`: with the live layout `a` would have grown to contain the child.
    drag(container, 'web', EMPTY, { altMove: true, release: false });
    expect(highlight(container)).toBeNull();
  });
});

describe('reparent: drop-target highlight', () => {
  it('highlights exactly the boundary that would receive the drop, and tracks the pointer', () => {
    const { container } = setup();
    const from = centre(rectOf(container, 'user'));
    fireEvent.pointerDown(hitOf(container, 'user'), { pointerId: 1, pointerType: 'mouse', clientX: from.x, clientY: from.y });
    expect(highlight(container)).toBeNull();

    const b = centre(rectOf(container, 'db'));
    fireEvent.pointerMove(window, { pointerId: 1, clientX: b.x, clientY: b.y });
    expect(container.querySelectorAll('[data-drop-target]')).toHaveLength(1);
    expect(highlight(container)).toBe('b');

    const d = centre(rectOf(container, 'deep'));
    fireEvent.pointerMove(window, { pointerId: 1, clientX: d.x, clientY: d.y });
    expect(highlight(container)).toBe('inner');

    fireEvent.pointerMove(window, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    expect(highlight(container)).toBeNull();
  });

  it('is not shown for the current parent on a plain drag', () => {
    const { container } = setup();
    const w = rectOf(container, 'web');
    drag(container, 'web', { x: w.x + w.width / 2 + 3, y: w.y + w.height / 2 }, { release: false });
    expect(highlight(container)).toBeNull();
  });

  it('is cleared on release', () => {
    const { container } = setup();
    drag(container, 'user', centre(rectOf(container, 'db')));
    expect(highlight(container)).toBeNull();
  });

  it('is cleared on pointercancel, which reports no edit and no position change', () => {
    const { container, onEdit, onPositionChange } = setup();
    drag(container, 'user', centre(rectOf(container, 'db')), { release: false });
    expect(highlight(container)).toBe('b');
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(highlight(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('is cleared on Escape, and the release that follows reports nothing', () => {
    const { container, onEdit, onPositionChange } = setup();
    drag(container, 'user', centre(rectOf(container, 'db')), { release: false });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(highlight(container)).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('a cancelled drag leaves the next drag clean', () => {
    const { container, onEdit } = setup();
    drag(container, 'user', centre(rectOf(container, 'db')), { release: false });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    drag(container, 'user', centre(rectOf(container, 'db')));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({ kind: 'reparent', id: 'user', parent: 'b' });
  });
});
