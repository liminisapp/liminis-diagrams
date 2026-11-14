import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import { parseC4 } from '../core/parser';
import { applyC4Edit, type C4Edit } from '../core/edit';
import { LONG_PRESS_DELAY_MS, LONG_PRESS_MOVE_TOLERANCE } from './hooks/useC4LongPress';

/**
 * Rename gestures: double-click (and, on touch, long-press) an element or a
 * relationship label, confirm inline, and the renderer reports one `rename`.
 *
 * As elsewhere, happy-dom has no SVG geometry, so the CTM is stubbed as identity.
 */

const SOURCE = `Person(user, "User", "End user")
System_Boundary(b, "Backend") {
  Container(api, "API", "Go")
}
System(ext, "Ext")
System(db, "Db")
Person(blank, "")
Rel(user, api, "Uses", "HTTPS")
Rel(user, ext, "")
Rel(ext, db, "Reads")
Rel(ext, db, "Writes")`;

function stubSvgGeometry() {
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
}
beforeEach(stubSvgGeometry);

type Positions = Record<string, { x: number; y: number }>;

function setup(overrides: Record<string, unknown> = {}) {
  const diagram = parseC4(SOURCE).diagram!;
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
  return { ...utils, diagram, onEdit, onPositionChange };
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const node = (c: HTMLElement, id: string) => q(c, `[data-node-id="${id}"]`)!;
const rel = (c: HTMLElement, index: number) => q(c, `[data-rel-index="${index}"]`)!;
const input = (c: HTMLElement) => q(c, '[data-c4-label-input]') as HTMLInputElement | null;
const menuOf = (c: HTMLElement) => q(c, '[data-c4-menu]');
const svgOf = (c: HTMLElement) => q(c, 'svg[data-diagram]')!;
const rectOf = (c: HTMLElement, id: string) => {
  const r = node(c, id);
  return {
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    width: Number(r.getAttribute('width')),
    height: Number(r.getAttribute('height')),
  };
};

function type(c: HTMLElement, value: string, key = 'Enter') {
  const el = input(c)!;
  fireEvent.change(el, { target: { value } });
  fireEvent.keyDown(el, { key });
}

function pressDown(_c: HTMLElement, p: { x: number; y: number }, target: Element, pointerId = 1) {
  fireEvent.pointerDown(target, {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: p.x,
    clientY: p.y,
  });
}
function hold(ms = LONG_PRESS_DELAY_MS) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('rename an element: double-click', () => {
  it('opens the input prefilled with the current label, over the node', () => {
    const { container } = setup();
    expect(input(container)).toBeNull();
    fireEvent.doubleClick(node(container, 'ext'));
    const el = input(container)!;
    expect(el.value).toBe('Ext');
    expect(el.getAttribute('aria-label')).toBe('Element label');
    expect(el.style.width).toBe(`${rectOf(container, 'ext').width}px`);
  });

  it('Enter reports one rename for that alias with the sanitised label and the pinned positions', () => {
    const { container, onEdit, diagram } = setup();
    fireEvent.doubleClick(node(container, 'ext'));
    type(container, 'Say "hi"\\there');
    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({ kind: 'rename', target: { element: 'ext' }, label: "Say 'hi'/there" });
    for (const e of diagram.elements) expect(ctx.positions[e.id]).toBeDefined();
    expect(input(container)).toBeNull();
  });

  it('keeps a manual position as the host holds it', () => {
    const { container, onEdit } = setup({ manualPositions: { ext: { x: 12.5, y: 33.25 } } });
    fireEvent.doubleClick(node(container, 'ext'));
    type(container, 'Other');
    expect(onEdit.mock.calls[0][1].positions.ext).toEqual({ x: 12.5, y: 33.25 });
  });

  it('Escape and blur report nothing', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(node(container, 'ext'));
    type(container, 'Changed', 'Escape');
    expect(input(container)).toBeNull();
    fireEvent.doubleClick(node(container, 'ext'));
    fireEvent.change(input(container)!, { target: { value: 'Changed' } });
    fireEvent.blur(input(container)!);
    expect(input(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('reports nothing when the label is confirmed unchanged', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(node(container, 'ext'));
    fireEvent.keyDown(input(container)!, { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(input(container)).toBeNull();
  });

  it('reports the placeholder for an empty label', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(node(container, 'ext'));
    type(container, '   ');
    expect(onEdit.mock.calls[0][0]).toEqual({ kind: 'rename', target: { element: 'ext' }, label: 'System' });
    fireEvent.doubleClick(node(container, 'user'));
    type(container, '');
    expect(onEdit.mock.calls[1][0]).toMatchObject({ target: { element: 'user' }, label: 'Person' });
  });

  it('prefills the alias for an element whose label argument is empty, and unchanged reports nothing', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(node(container, 'blank'));
    expect(input(container)!.value).toBe('blank');
    fireEvent.keyDown(input(container)!, { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('does not open for a boundary or the legend', () => {
    const { container } = setup();
    fireEvent.doubleClick(node(container, 'b'));
    expect(input(container)).toBeNull();
    const legend = q(container, '[data-node-id="__legend__"]');
    if (legend) fireEvent.doubleClick(legend);
    expect(input(container)).toBeNull();
  });

  it('applies end to end: the host gets a one-line diff and the alias is untouched', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(node(container, 'api'));
    expect(input(container)!.value).toBe('API');
    type(container, 'Gateway');
    const result = applyC4Edit(SOURCE, onEdit.mock.calls[0][0]);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.source).toBe(SOURCE.replace('Container(api, "API", "Go")', 'Container(api, "Gateway", "Go")'));
    }
  });
});

describe('rename a relationship: double-click', () => {
  it('opens at the label, prefilled with the label argument (technology not doubled)', () => {
    const { container } = setup();
    fireEvent.doubleClick(rel(container, 0));
    const el = input(container)!;
    expect(el.value).toBe('Uses'); // the model's label is "Uses [HTTPS]"
    expect(el.getAttribute('aria-label')).toBe('Relationship label');
  });

  it('reports one rename carrying the staleness guard, and applies to only that line', () => {
    const { container, onEdit, diagram } = setup();
    fireEvent.doubleClick(rel(container, 0));
    type(container, 'Calls');
    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({
      kind: 'rename',
      target: { relationship: { index: 0, sourceId: 'user', targetId: 'api', label: 'Uses [HTTPS]' } },
      label: 'Calls',
    });
    for (const e of diagram.elements) expect(ctx.positions[e.id]).toBeDefined();
    const result = applyC4Edit(SOURCE, edit);
    expect(result.ok && result.source).toBe(SOURCE.replace('"Uses", "HTTPS"', '"Calls", "HTTPS"'));
  });

  it('confirming the technology-bearing label unchanged reports nothing', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(rel(container, 0));
    fireEvent.keyDown(input(container)!, { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('renames only the targeted one of two relationships between the same pair', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(rel(container, 3));
    expect(input(container)!.value).toBe('Writes');
    type(container, 'Persists');
    expect(onEdit.mock.calls[0][0]).toMatchObject({ target: { relationship: { index: 3, label: 'Writes' } } });
    const result = applyC4Edit(SOURCE, onEdit.mock.calls[0][0]);
    expect(result.ok && result.source).toBe(SOURCE.replace('"Writes"', '"Persists"'));
  });

  it('reaches a relationship with no visible label by its line', () => {
    const { container, onEdit } = setup();
    const target = rel(container, 1);
    expect(target.tagName.toLowerCase()).toBe('line');
    fireEvent.doubleClick(target);
    expect(input(container)!.value).toBe('');
    type(container, 'Now named');
    expect(onEdit.mock.calls[0][0]).toMatchObject({ label: 'Now named', target: { relationship: { index: 1 } } });
  });

  it('falls back to "Uses" for an empty label', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(rel(container, 2));
    type(container, '');
    expect(onEdit.mock.calls[0][0]).toMatchObject({ label: 'Uses' });
  });

  it('Escape and blur report nothing', () => {
    const { container, onEdit } = setup();
    fireEvent.doubleClick(rel(container, 0));
    type(container, 'x', 'Escape');
    fireEvent.doubleClick(rel(container, 0));
    fireEvent.blur(input(container)!);
    expect(onEdit).not.toHaveBeenCalled();
    expect(input(container)).toBeNull();
  });

  it('right-click on a relationship label opens no menu and suppresses the browser menu', () => {
    const { container } = setup();
    const notPrevented = fireEvent.contextMenu(rel(container, 0), { clientX: 5, clientY: 5 });
    expect(notPrevented).toBe(false);
    expect(menuOf(container)).toBeNull();
  });
});

describe('rename: long-press on touch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const centre = (c: HTMLElement, id: string) => {
    const r = rectOf(c, id);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };

  it('opens the input on an element after ~500 ms, and releasing reports no positions', () => {
    const { container, onEdit, onPositionChange } = setup();
    const p = centre(container, 'ext');
    pressDown(container, p, node(container, 'ext'));
    hold(LONG_PRESS_DELAY_MS - 1);
    expect(input(container)).toBeNull();
    hold(1);
    expect(input(container)!.value).toBe('Ext');
    expect(menuOf(container)).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x, clientY: p.y });
    hold(100);
    expect(onPositionChange).not.toHaveBeenCalled();
    type(container, 'Renamed');
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({ kind: 'rename', target: { element: 'ext' }, label: 'Renamed' });
  });

  it('abandons the move-drag it started: a later move reports nothing', () => {
    const { container, onPositionChange } = setup();
    const p = centre(container, 'ext');
    pressDown(container, p, node(container, 'ext'));
    hold();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: p.x + 40, clientY: p.y + 40 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x + 40, clientY: p.y + 40 });
    hold(100);
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('opens on a relationship label', () => {
    const { container } = setup();
    pressDown(container, { x: 1, y: 1 }, rel(container, 0));
    hold();
    expect(input(container)!.value).toBe('Uses');
    expect(input(container)!.getAttribute('aria-label')).toBe('Relationship label');
    expect(menuOf(container)).toBeNull();
  });

  it.each([
    ['movement past the tolerance', () => fireEvent.pointerMove(window, { pointerId: 1, clientX: 400 + LONG_PRESS_MOVE_TOLERANCE + 5, clientY: 400 })],
    ['an early release', () => fireEvent.pointerUp(window, { pointerId: 1 })],
    ['pointercancel', () => fireEvent.pointerCancel(window, { pointerId: 1 })],
  ])('is abandoned by %s on an element', (_name, abandon) => {
    const { container, onEdit } = setup();
    pressDown(container, { x: 400, y: 400 }, node(container, 'ext'));
    abandon();
    hold(1000);
    expect(input(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is abandoned the same way on a relationship label', () => {
    const { container } = setup();
    pressDown(container, { x: 1, y: 1 }, rel(container, 0));
    fireEvent.pointerCancel(window, { pointerId: 1 });
    hold(1000);
    expect(input(container)).toBeNull();
  });

  it('still opens the add menu on a boundary and on empty canvas', () => {
    const { container } = setup();
    const b = rectOf(container, 'b');
    pressDown(container, { x: b.x + 5, y: b.y + 5 }, node(container, 'b'));
    hold();
    expect(menuOf(container)).not.toBeNull();
    expect(input(container)).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    pressDown(container, { x: 900, y: 900 }, svgOf(container), 2);
    hold();
    expect(menuOf(container)).not.toBeNull();
  });

  it('does not start on a connect handle', () => {
    const { container } = setup();
    pressDown(container, { x: 1, y: 1 }, q(container, '[data-connect-handle="ext"]')!);
    hold(1000);
    expect(input(container)).toBeNull();
  });
});

describe('rename: exclusion and gating', () => {
  it('refuses while the add menu, a pending element or a pending relationship is open', () => {
    const { container, onEdit } = setup();
    fireEvent.contextMenu(svgOf(container), { clientX: 900, clientY: 900 });
    expect(menuOf(container)).not.toBeNull();
    fireEvent.doubleClick(node(container, 'ext'));
    expect(input(container)).toBeNull();
    fireEvent.click(q(container, '[data-kind="system"]')!);
    expect(input(container)!.value).toBe('System'); // the new-element input, not a rename
    fireEvent.doubleClick(node(container, 'user'));
    fireEvent.doubleClick(rel(container, 0) ?? node(container, 'user'));
    expect(container.querySelectorAll('[data-c4-label-input]').length).toBe(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('the add menu does not open while a rename input is open', () => {
    const { container } = setup();
    fireEvent.doubleClick(node(container, 'ext'));
    fireEvent.contextMenu(svgOf(container), { clientX: 900, clientY: 900 });
    expect(menuOf(container)).toBeNull();
    expect(input(container)!.getAttribute('aria-label')).toBe('Element label');
  });

  it('hides connect handles and relationship targets while renaming, and restores them after', () => {
    const { container } = setup();
    fireEvent.doubleClick(node(container, 'ext'));
    expect(q(container, '[data-connect-handle]')).toBeNull();
    expect(q(container, '[data-rel-index]')).toBeNull();
    type(container, 'x', 'Escape');
    expect(q(container, '[data-connect-handle]')).not.toBeNull();
    expect(q(container, '[data-rel-index]')).not.toBeNull();
  });

  it('does not open during a move-drag', () => {
    const { container } = setup();
    const r = rectOf(container, 'ext');
    fireEvent.pointerDown(node(container, 'ext'), { pointerId: 1, clientX: r.x + 5, clientY: r.y + 5 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: r.x + 40, clientY: r.y + 40 });
    fireEvent.doubleClick(node(container, 'ext'));
    expect(input(container)).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: r.x + 40, clientY: r.y + 40 });
  });

  it('move-drag still works afterwards', () => {
    const { container, onPositionChange } = setup();
    fireEvent.doubleClick(node(container, 'ext'));
    type(container, 'x', 'Escape');
    const r = rectOf(container, 'ext');
    fireEvent.pointerDown(node(container, 'ext'), { pointerId: 2, clientX: r.x + 5, clientY: r.y + 5 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: r.x + 35, clientY: r.y + 35 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: r.x + 35, clientY: r.y + 35 });
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('has no handlers and no relationship targets outside edit mode', () => {
    const { container, onEdit } = setup({ isEditMode: false });
    expect(q(container, '[data-rel-index]')).toBeNull();
    fireEvent.doubleClick(svgOf(container));
    expect(input(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('has none without onEdit, even in edit mode, and double-click is left to the browser', () => {
    const { container } = setup({ onEdit: undefined });
    expect(q(container, '[data-rel-index]')).toBeNull();
    fireEvent.doubleClick(node(container, 'ext'));
    expect(input(container)).toBeNull();
  });

  it('drops an open rename when edit mode is switched off', () => {
    const diagram = parseC4(SOURCE).diagram!;
    const onEdit = vi.fn();
    const props = { diagram, isDarkMode: false, manualPositions: {}, onPositionChange: vi.fn(), onEdit };
    const { container, rerender } = render(<C4InteractiveRenderer {...props} isEditMode />);
    fireEvent.doubleClick(node(container, 'ext'));
    expect(input(container)).not.toBeNull();
    rerender(<C4InteractiveRenderer {...props} isEditMode={false} />);
    expect(input(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
