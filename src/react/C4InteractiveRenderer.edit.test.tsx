import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import { parseC4 } from '../core/parser';
import { layoutC4Diagram } from '../core/layout';
import type { C4Edit } from '../core/edit';

/**
 * Structural-editing tests: add element, connect, and the gating around them.
 *
 * As in C4InteractiveRenderer.test.tsx, happy-dom has no SVG geometry, so the
 * CTM is stubbed as identity (client px === SVG units). These cover the gesture
 * pipeline and what is reported, not the coordinate maths at non-1 zoom.
 */

const SOURCE = `Person(user, "User", "End user")
System_Boundary(b, "Backend") {
  Container(api, "API", "Go")
}
System(ext, "Ext")
Rel(user, api, "Uses")`;

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
const rectOf = (c: HTMLElement, id: string) => {
  const r = q(c, `[data-node-id="${id}"]`)!;
  return {
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    width: Number(r.getAttribute('width')),
    height: Number(r.getAttribute('height')),
  };
};
const centre = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

const svgOf = (c: HTMLElement) => q(c, 'svg[data-diagram]')!;
const menuOf = (c: HTMLElement) => q(c, '[data-c4-menu]');
/** Right-click at a point (the canvas background, unless a target is given). */
function rightClick(c: HTMLElement, p: { x: number; y: number }, target?: Element) {
  return fireEvent.contextMenu(target ?? svgOf(c), { clientX: p.x, clientY: p.y });
}
function choose(c: HTMLElement, kind: string) {
  fireEvent.click(q(c, `[data-kind="${kind}"]`)!);
}
/** Open the menu by right-click at a point, choose a kind: places the element there. */
function place(c: HTMLElement, kind: string, p: { x: number; y: number }, target?: Element) {
  rightClick(c, p, target);
  choose(c, kind);
}
const relInput = (c: HTMLElement) =>
  q(c, '[data-c4-label-input][aria-label="Relationship label"]') as HTMLInputElement | null;
const labelInput = (c: HTMLElement) => q(c, '[data-c4-label-input]') as HTMLInputElement | null;

function connect(c: HTMLElement, fromId: string, to: { x: number; y: number }) {
  const handle = q(c, `[data-connect-handle="${fromId}"]`)!;
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1, clientY: 1 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe('add element', () => {
  it('places at the right-clicked point, names inline, and reports one add-element edit', () => {
    const { container, onEdit } = setup();
    place(container, 'system', { x: 900, y: 900 });

    expect(menuOf(container)).toBeNull(); // choosing closes the menu
    expect(onEdit).not.toHaveBeenCalled(); // nothing until the label is confirmed
    expect(q(container, '[data-pending-element]')).not.toBeNull();
    const input = labelInput(container)!;
    expect(input.value).toBe('System'); // kind-appropriate placeholder
    fireEvent.change(input, { target: { value: 'Billing' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({ kind: 'add-element', elementKind: 'system', label: 'Billing', alias: 'billing' });
    // Placed so its centre is where the user clicked (240x80 node).
    expect(ctx.positions.billing).toEqual({ x: 780, y: 860 });
    expect(labelInput(container)).toBeNull();
    expect(q(container, '[data-pending-element]')).toBeNull();
  });

  it('lists exactly the addable kinds', () => {
    const { container } = setup();
    rightClick(container, { x: 900, y: 900 });
    const kinds = Array.from(container.querySelectorAll('[data-c4-menu] [data-kind]')).map((b) =>
      b.getAttribute('data-kind'),
    );
    expect(kinds).toEqual([
      'person',
      'system',
      'container',
      'component',
      'systemDb',
      'containerDb',
      'componentDb',
    ]);
    expect(menuOf(container)!.getAttribute('role')).toBe('menu');
  });

  it('uses a generated unique alias when the label collides with an existing one', () => {
    const { container, onEdit } = setup();
    place(container, 'person', { x: 900, y: 900 });
    const input = labelInput(container)!;
    fireEvent.change(input, { target: { value: 'User' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((onEdit.mock.calls[0][0] as { alias: string }).alias).toBe('user_2');
  });

  it('falls back to the placeholder when the label is confirmed empty', () => {
    const { container, onEdit } = setup();
    place(container, 'containerDb', { x: 900, y: 900 });
    const input = labelInput(container)!;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toMatchObject({ label: 'Database', alias: 'database' });
  });

  it('reports the enclosing boundary as parent when opened inside one', () => {
    const { container, onEdit } = setup();
    const b = rectOf(container, 'b');
    // Right-click lands on the boundary's own hit rect, as it would in a browser.
    place(container, 'component', { x: b.x + 5, y: b.y + 5 }, q(container, '[data-node-id="b"]')!);
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toMatchObject({ kind: 'add-element', elementKind: 'component', parent: 'b' });
  });

  it('omits parent when opened outside every boundary', () => {
    const { container, onEdit } = setup();
    place(container, 'person', { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).not.toHaveProperty('parent');
  });

  it('opens no menu over an element, but still suppresses the native one', () => {
    const { container } = setup();
    const notPrevented = rightClick(container, centre(rectOf(container, 'ext')), q(container, '[data-node-id="ext"]')!);
    expect(notPrevented).toBe(false);
    expect(menuOf(container)).toBeNull();
  });

  it('suppresses the native context menu over the canvas', () => {
    const { container } = setup();
    expect(rightClick(container, { x: 900, y: 900 })).toBe(false);
    expect(menuOf(container)).not.toBeNull();
  });

  it('reports nothing on Escape in the label input, and leaves no stuck state', () => {
    const { container, onEdit } = setup();
    place(container, 'system', { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(labelInput(container)).toBeNull();
    expect(q(container, '[data-pending-element]')).toBeNull();
    // A new add works afterwards.
    rightClick(container, { x: 900, y: 900 });
    expect(menuOf(container)).not.toBeNull();
  });

  it('reports nothing when the input loses focus', () => {
    const { container, onEdit } = setup();
    place(container, 'system', { x: 900, y: 900 });
    fireEvent.blur(labelInput(container)!);
    expect(onEdit).not.toHaveBeenCalled();
    expect(labelInput(container)).toBeNull();
  });

  it('ignores a pointercancel from an unrelated pointer while naming', () => {
    const { container, onEdit } = setup();
    place(container, 'system', { x: 900, y: 900 });
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(labelInput(container)).not.toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('has no palette any more', () => {
    const { container } = setup();
    expect(q(container, '[data-c4-palette]')).toBeNull();
    expect(q(container, '[role="toolbar"]')).toBeNull();
  });
});

describe('context menu', () => {
  it('closes on Escape and reports nothing', () => {
    const { container, onEdit } = setup();
    rightClick(container, { x: 900, y: 900 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menuOf(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('closes on a pointerdown outside it, but not inside it', () => {
    const { container, onEdit } = setup();
    rightClick(container, { x: 900, y: 900 });
    fireEvent.pointerDown(q(container, '[data-kind="system"]')!, { pointerId: 1 });
    expect(menuOf(container)).not.toBeNull();
    fireEvent.pointerDown(document.body, { pointerId: 1 });
    expect(menuOf(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('closes on pointercancel of the pointer that opened it, and ignores other pointers', () => {
    vi.useFakeTimers();
    try {
      const { container, onEdit } = setup();
      longPress(container, { x: 900, y: 900 }, 7);
      expect(menuOf(container)).not.toBeNull();
      fireEvent.pointerCancel(window, { pointerId: 8 });
      expect(menuOf(container)).not.toBeNull();
      fireEvent.pointerCancel(window, { pointerId: 7 });
      expect(menuOf(container)).toBeNull();
      expect(onEdit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports arrow-key navigation between items', () => {
    const { container } = setup();
    rightClick(container, { x: 900, y: 900 });
    const first = q(container, '[data-kind="person"]') as HTMLElement;
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(menuOf(container)!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(q(container, '[data-kind="system"]'));
    fireEvent.keyDown(menuOf(container)!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('does not start a move-drag on a right-click', () => {
    const { container, onPositionChange } = setup();
    const b = q(container, '[data-node-id="b"]')!;
    fireEvent.pointerDown(b, { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 5, clientY: 5 });
    expect(onPositionChange).not.toHaveBeenCalled();
  });
});

function pressDown(c: HTMLElement, p: { x: number; y: number }, pointerId = 1, target?: Element, pointerType = 'touch') {
  fireEvent.pointerDown(target ?? svgOf(c), {
    pointerId,
    pointerType,
    isPrimary: true,
    button: 0,
    clientX: p.x,
    clientY: p.y,
  });
}
/** A touch held still on the canvas until the menu opens. */
function longPress(c: HTMLElement, p: { x: number; y: number }, pointerId = 1, target?: Element) {
  pressDown(c, p, pointerId, target);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe('long-press', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens the same menu after ~500 ms without movement, and places at the press point', () => {
    const { container, onEdit } = setup();
    pressDown(container, { x: 900, y: 900 });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(menuOf(container)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(menuOf(container)).not.toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 900, clientY: 900 });
    expect(menuOf(container)).not.toBeNull(); // lifting the finger keeps it open

    choose(container, 'system');
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][1].positions.system).toEqual({ x: 780, y: 860 });
  });

  it('works inside a boundary, reporting it as the parent', () => {
    const { container, onEdit } = setup();
    const b = rectOf(container, 'b');
    longPress(container, { x: b.x + 5, y: b.y + 5 }, 1, q(container, '[data-node-id="b"]')!);
    expect(menuOf(container)).not.toBeNull();
    choose(container, 'component');
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toMatchObject({ parent: 'b' });
  });

  it('on a boundary, takes over from the move-drag: releasing writes no positions', () => {
    const { container, onPositionChange, onEdit } = setup();
    const b = rectOf(container, 'b');
    const p = { x: b.x + 5, y: b.y + 5 };
    longPress(container, p, 1, q(container, '[data-node-id="b"]')!);
    expect(menuOf(container)).not.toBeNull();
    // Finger lifts (and a stray cancel from the same pointer is harmless to the host).
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x, clientY: p.y });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    // Move still works afterwards: no stuck drag state.
    fireEvent.keyDown(window, { key: 'Escape' });
    const rect = q(container, '[data-node-id="b"]')!;
    fireEvent.pointerDown(rect, { pointerId: 2, clientX: p.x, clientY: p.y });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: p.x + 30, clientY: p.y + 30 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: p.x + 30, clientY: p.y + 30 });
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by movement past the threshold, so a drag never opens a menu', () => {
    const { container } = setup();
    pressDown(container, { x: 900, y: 900 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 930, clientY: 900 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menuOf(container)).toBeNull();
  });

  it('tolerates a small wobble', () => {
    const { container } = setup();
    pressDown(container, { x: 900, y: 900 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 903, clientY: 902 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(menuOf(container)).not.toBeNull();
  });

  it('is cancelled by pointercancel and by lifting early, leaving nothing running', () => {
    const { container } = setup();
    pressDown(container, { x: 900, y: 900 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menuOf(container)).toBeNull();

    pressDown(container, { x: 900, y: 900 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 900, clientY: 900 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menuOf(container)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is not started by a mouse, which has a right button', () => {
    const { container } = setup();
    pressDown(container, { x: 900, y: 900 }, 1, undefined, 'mouse');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menuOf(container)).toBeNull();
  });

  it('is not started over an element, a connect handle, or by a second finger', () => {
    const { container } = setup();
    pressDown(container, centre(rectOf(container, 'ext')), 1, q(container, '[data-node-id="ext"]')!);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menuOf(container)).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1 });

    // Second finger while the first is pending cancels the press.
    pressDown(container, { x: 900, y: 900 }, 1);
    pressDown(container, { x: 950, y: 950 }, 2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menuOf(container)).toBeNull();
  });

  it('does nothing in a read-only render', () => {
    const { container } = setup({ isEditMode: false });
    pressDown(container, { x: 900, y: 900 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menuOf(container)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** Connect, then confirm the label input as it stands. */
function connectAndConfirm(c: HTMLElement, fromId: string, to: { x: number; y: number }, label?: string) {
  connect(c, fromId, to);
  const input = relInput(c)!;
  if (label !== undefined) fireEvent.change(input, { target: { value: label } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('connect', () => {
  it('asks for a label on release, defaulting to "Uses", and reports nothing yet', () => {
    const { container, onEdit } = setup();
    connect(container, 'user', centre(rectOf(container, 'ext')));
    expect(onEdit).not.toHaveBeenCalled();
    expect(relInput(container)!.value).toBe('Uses');
    expect(q(container, '[data-pending-relationship]')).not.toBeNull();
    expect(q(container, '[data-connect-line]')).toBeNull();
  });

  it('puts the label input near the midpoint of the new edge', () => {
    const { container } = setup();
    const a = centre(rectOf(container, 'user'));
    const b = centre(rectOf(container, 'ext'));
    connect(container, 'user', b);
    const input = relInput(container)!;
    const left = parseFloat(input.style.left) + parseFloat(input.style.width) / 2;
    const top = parseFloat(input.style.top) + parseFloat(input.style.height) / 2;
    // Stub CTM and viewBox origin are identity-ish at zoom 1; allow for the viewBox offset.
    const svg = svgOf(container);
    const [vx, vy] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(left).toBeCloseTo((a.x + b.x) / 2 - vx, 0);
    expect(top).toBeCloseTo((a.y + b.y) / 2 - vy, 0);
  });

  it('reports one add-relationship with the default label when confirmed as is', () => {
    const { container, onEdit, onPositionChange } = setup();
    connectAndConfirm(container, 'user', centre(rectOf(container, 'ext')));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({
      kind: 'add-relationship',
      sourceId: 'user',
      targetId: 'ext',
      label: 'Uses',
    });
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('reports the label the user typed', () => {
    const { container, onEdit } = setup();
    connectAndConfirm(container, 'user', centre(rectOf(container, 'ext')), 'Sends invoices to');
    expect(onEdit.mock.calls[0][0]).toEqual({
      kind: 'add-relationship',
      sourceId: 'user',
      targetId: 'ext',
      label: 'Sends invoices to',
    });
    expect(relInput(container)).toBeNull();
  });

  it('falls back to "Uses" when the label is confirmed empty', () => {
    const { container, onEdit } = setup();
    connectAndConfirm(container, 'user', centre(rectOf(container, 'ext')), '   ');
    expect(onEdit.mock.calls[0][0]).toMatchObject({ label: 'Uses' });
  });

  it('reports nothing on Escape or blur, and leaves no stuck state', () => {
    const { container, onEdit } = setup();
    connect(container, 'user', centre(rectOf(container, 'ext')));
    fireEvent.keyDown(relInput(container)!, { key: 'Escape' });
    expect(relInput(container)).toBeNull();
    expect(q(container, '[data-pending-relationship]')).toBeNull();

    connect(container, 'user', centre(rectOf(container, 'ext')));
    fireEvent.blur(relInput(container)!);
    expect(relInput(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    // A new connect works afterwards.
    connectAndConfirm(container, 'user', centre(rectOf(container, 'ext')));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('is exclusive with other gestures while the label input is open', () => {
    const { container } = setup();
    connect(container, 'user', centre(rectOf(container, 'ext')));
    expect(q(container, '[data-connect-handle]')).toBeNull(); // handles hidden
    rightClick(container, { x: 900, y: 900 });
    expect(menuOf(container)).toBeNull();
  });

  it('targets the element inside a boundary, not the boundary', () => {
    const { container, onEdit } = setup();
    connectAndConfirm(container, 'user', centre(rectOf(container, 'api')));
    expect(onEdit.mock.calls[0][0]).toMatchObject({ targetId: 'api' });
  });

  it('draws a rubber band while connecting', () => {
    const { container } = setup();
    fireEvent.pointerDown(q(container, '[data-connect-handle="user"]')!, { pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(q(container, '[data-connect-line]')).not.toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 9999, clientY: 9999 });
    expect(q(container, '[data-connect-line]')).toBeNull();
  });

  it('reports nothing when released on empty canvas, on a boundary, or on the source', () => {
    const { container, onEdit } = setup();
    connect(container, 'user', { x: 5000, y: 5000 });
    const b = rectOf(container, 'b');
    connect(container, 'user', { x: b.x + 5, y: b.y + 5 }); // boundary-only area
    connect(container, 'user', centre(rectOf(container, 'user')));
    expect(relInput(container)).toBeNull(); // no label input either
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('reports nothing on pointercancel and leaves nothing stuck', () => {
    const { container, onEdit } = setup();
    fireEvent.pointerDown(q(container, '[data-connect-handle="user"]')!, { pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(q(container, '[data-connect-line]')).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('offers no connect handle on boundaries', () => {
    const { container } = setup();
    expect(q(container, '[data-connect-handle="b"]')).toBeNull();
    expect(q(container, '[data-connect-handle="user"]')).not.toBeNull();
  });

  it('is distinct from move-drag: dragging a node moves it and creates no relationship', () => {
    const { container, onEdit, onPositionChange } = setup();
    const area = q(container, '[data-node-id="user"]')!;
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 160, clientY: 140 });
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('cannot start a move-drag while a connect gesture is active', () => {
    const { container, onPositionChange } = setup();
    fireEvent.pointerDown(q(container, '[data-connect-handle="user"]')!, { pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerDown(q(container, '[data-node-id="ext"]')!, { pointerId: 2, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 400, clientY: 400 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 400, clientY: 400 });
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('cannot start a connect while a move-drag is active', () => {
    const { container, onEdit } = setup();
    fireEvent.pointerDown(q(container, '[data-node-id="user"]')!, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(q(container, '[data-connect-handle="ext"]')!, { pointerId: 2, clientX: 1, clientY: 1 });
    expect(q(container, '[data-connect-line]')).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('gating', () => {
  it('shows no add or connect affordance outside edit mode', () => {
    const { container, onEdit } = setup({ isEditMode: false });
    expect(q(container, '[data-connect-handle]')).toBeNull();
    // The browser's own context menu is left alone, and ours never opens.
    expect(rightClick(container, { x: 900, y: 900 })).toBe(true);
    expect(menuOf(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('shows no add or connect affordance without an onEdit callback', () => {
    // liminis-editor passes isEditMode for dragging alone; it must not grow dead buttons.
    const { container } = setup({ onEdit: undefined });
    expect(q(container, '[data-connect-handle]')).toBeNull();
    expect(rightClick(container, { x: 900, y: 900 })).toBe(true);
    expect(menuOf(container)).toBeNull();
    // Dragging still works there.
    expect(container.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
  });

  it('keeps the DOM identical to before when editing is not enabled', () => {
    const { container } = setup({ onEdit: undefined });
    const root = container.firstElementChild!;
    expect(root.firstElementChild!.tagName.toLowerCase()).toBe('svg');
  });

  it('drops an open menu and a pending relationship when edit mode is switched off', () => {
    const diagram = parseC4(SOURCE).diagram!;
    const props = { diagram, isDarkMode: false, manualPositions: {}, onPositionChange: vi.fn(), onEdit: vi.fn() };
    const { container, rerender } = render(<C4InteractiveRenderer {...props} isEditMode />);
    rightClick(container, { x: 900, y: 900 });
    expect(menuOf(container)).not.toBeNull();
    rerender(<C4InteractiveRenderer {...props} isEditMode={false} />);
    expect(menuOf(container)).toBeNull();

    rerender(<C4InteractiveRenderer {...props} isEditMode />);
    connect(container, 'user', centre(rectOf(container, 'ext')));
    expect(relInput(container)).not.toBeNull();
    rerender(<C4InteractiveRenderer {...props} isEditMode={false} />);
    expect(relInput(container)).toBeNull();
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('drops a half-finished add when edit mode is switched off', () => {
    const diagram = parseC4(SOURCE).diagram!;
    const onEdit = vi.fn();
    const props = { diagram, isDarkMode: false, manualPositions: {}, onPositionChange: vi.fn(), onEdit };
    const { container, rerender } = render(<C4InteractiveRenderer {...props} isEditMode />);
    place(container, 'system', { x: 900, y: 900 });
    expect(labelInput(container)).not.toBeNull();
    rerender(<C4InteractiveRenderer {...props} isEditMode={false} />);
    expect(labelInput(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('pinned positions (FR-027)', () => {
  const positionsOf = (diagram: ReturnType<typeof parseC4>['diagram'], positions?: Positions) =>
    Object.fromEntries(layoutC4Diagram(diagram!, undefined, positions).nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  it('pins every visible node so re-laying out reproduces the pre-edit layout', () => {
    const { container, diagram, onEdit } = setup();
    const before = positionsOf(diagram);
    connectAndConfirm(container, 'user', centre(rectOf(container, 'ext')));
    const { positions } = onEdit.mock.calls[0][1];
    for (const id of diagram.elements.map((e) => e.id)) expect(positions[id]).toBeDefined();
    expect(positionsOf(diagram, positions)).toEqual(before);
  });

  it('keeps existing manual positions untouched and pins only the rest', () => {
    const manual = { user: { x: 12.5, y: 33.25 } };
    const { container, diagram, onEdit } = setup({ manualPositions: manual });
    connectAndConfirm(container, 'user', centre(rectOf(container, 'ext')));
    const { positions } = onEdit.mock.calls[0][1];
    expect(positions.user).toEqual({ x: 12.5, y: 33.25 });
    // Everything now has a position, and laying out with them is a fixed point.
    for (const id of diagram.elements.map((e) => e.id)) expect(positions[id]).toBeDefined();
    const once = positionsOf(diagram, positions);
    expect(positionsOf(diagram, once)).toEqual(once);
  });

  it('reports the new element together with the pinned positions', () => {
    const { container, diagram, onEdit } = setup();
    place(container, 'system', { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    const { positions } = onEdit.mock.calls[0][1];
    expect(Object.keys(positions).sort()).toEqual([...diagram.elements.map((e) => e.id), 'system'].sort());
  });

  it('pins the legend only if the host already positioned it', () => {
    const none = setup();
    connectAndConfirm(none.container, 'user', centre(rectOf(none.container, 'ext')));
    expect(none.onEdit.mock.calls[0][1].positions).not.toHaveProperty('__legend__');

    const withLegend = setup({ manualPositions: { __legend__: { x: 1, y: 2 } } });
    connectAndConfirm(withLegend.container, 'user', centre(rectOf(withLegend.container, 'ext')));
    expect(withLegend.onEdit.mock.calls[0][1].positions.__legend__).toEqual({ x: 1, y: 2 });
  });
});

// =============================================================================
// add boundary
// =============================================================================

function chooseBoundary(c: HTMLElement, kind: string) {
  fireEvent.click(q(c, `[data-boundary-kind="${kind}"]`)!);
}
function placeBoundary(c: HTMLElement, kind: string, p: { x: number; y: number }, target?: Element) {
  rightClick(c, p, target);
  chooseBoundary(c, kind);
}

describe('add boundary', () => {
  it('lists the boundary kinds in their own labelled group, apart from the element kinds', () => {
    const { container } = setup();
    rightClick(container, { x: 900, y: 900 });
    const menu = menuOf(container)!;
    expect(menu.getAttribute('aria-label')).toBe('Add to diagram');
    const groups = Array.from(menu.querySelectorAll('[role="group"]'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Elements', 'Boundaries']);
    const boundaries = groups[1];
    expect(Array.from(boundaries.querySelectorAll('[data-boundary-kind]')).map((b) => b.getAttribute('data-boundary-kind'))).toEqual([
      'systemBoundary',
      'containerBoundary',
      'boundary',
    ]);
    expect(Array.from(boundaries.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent)).toEqual([
      'System boundary',
      'Container boundary',
      'Boundary',
    ]);
    // Element kinds are untouched and none of them is a boundary item.
    expect(groups[0].querySelectorAll('[data-kind]')).toHaveLength(7);
    expect(groups[0].querySelector('[data-boundary-kind]')).toBeNull();
  });

  it('arrow keys move through both groups and wrap', () => {
    const { container } = setup();
    rightClick(container, { x: 900, y: 900 });
    const menu = menuOf(container)!;
    fireEvent.keyDown(menu, { key: 'ArrowUp' }); // wraps from first to last
    expect(document.activeElement).toBe(q(container, '[data-boundary-kind="boundary"]'));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(q(container, '[data-boundary-kind="containerBoundary"]'));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(q(container, '[data-kind="componentDb"]'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(q(container, '[data-boundary-kind="systemBoundary"]'));
  });

  it('places at the clicked point, names inline, and reports one add-boundary edit', () => {
    const { container, onEdit } = setup();
    placeBoundary(container, 'containerBoundary', { x: 900, y: 900 });

    expect(menuOf(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(q(container, '[data-pending-boundary]')).not.toBeNull();
    expect(q(container, '[data-pending-element]')).toBeNull();
    const input = labelInput(container)!;
    expect(input.getAttribute('aria-label')).toBe('Boundary label');
    expect(input.value).toBe('Container boundary');
    fireEvent.change(input, { target: { value: 'API Application' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({
      kind: 'add-boundary',
      boundaryKind: 'containerBoundary',
      label: 'API Application',
      alias: 'api_application',
    });
    // Centred on the click (240x160 empty boundary).
    expect(ctx.positions.api_application).toEqual({ x: 780, y: 820 });
    expect(labelInput(container)).toBeNull();
    expect(q(container, '[data-pending-boundary]')).toBeNull();
  });

  it('falls back to the per-kind placeholder when the label is confirmed empty', () => {
    const { container, onEdit } = setup();
    placeBoundary(container, 'systemBoundary', { x: 900, y: 900 });
    const input = labelInput(container)!;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toEqual({
      kind: 'add-boundary',
      boundaryKind: 'systemBoundary',
      label: 'System boundary',
      alias: 'system_boundary',
    });
  });

  it('reports nothing on Escape or blur, and leaves no stuck state', () => {
    const { container, onEdit } = setup();
    placeBoundary(container, 'boundary', { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(q(container, '[data-pending-boundary]')).toBeNull();
    placeBoundary(container, 'boundary', { x: 900, y: 900 });
    fireEvent.blur(labelInput(container)!);
    expect(onEdit).not.toHaveBeenCalled();
    // Gestures work again.
    rightClick(container, { x: 900, y: 900 });
    expect(menuOf(container)).not.toBeNull();
  });

  it('is top level on empty canvas and nested in the boundary it was opened in', () => {
    const { container, onEdit } = setup();
    placeBoundary(container, 'boundary', { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).not.toHaveProperty('parent');

    const b = rectOf(container, 'b');
    placeBoundary(container, 'containerBoundary', { x: b.x + b.width - 10, y: b.y + b.height - 10 }, q(container, '[data-node-id="b"]')!);
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[1][0]).toMatchObject({ kind: 'add-boundary', parent: 'b' });
  });

  it('clamps a nested boundary into its parent content area so the parent does not move', () => {
    const { container, onEdit } = setup();
    const b = rectOf(container, 'b');
    placeBoundary(container, 'boundary', { x: b.x + 5, y: b.y + 5 }, q(container, '[data-node-id="b"]')!);
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    const pos = onEdit.mock.calls[0][1].positions.boundary;
    expect(pos.x).toBeGreaterThanOrEqual(b.x + 40);
    expect(pos.y).toBeGreaterThanOrEqual(b.y + 55);
  });

  it('opening the menu inside an empty boundary resolves it as the parent, innermost first', () => {
    const diagram = parseC4(`System_Boundary(outer, "Outer") {
  Container_Boundary(inner, "Inner") {
  }
}
Person(u, "U")`).diagram!;
    const { container, onEdit } = setup({ diagram });
    const inner = rectOf(container, 'inner');
    const outer = rectOf(container, 'outer');
    expect(inner.width).toBeGreaterThan(0);
    expect(inner.height).toBeGreaterThan(0);
    place(container, 'component', centre(inner), q(container, '[data-node-id="inner"]')!);
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toMatchObject({ kind: 'add-element', parent: 'inner' });

    placeBoundary(container, 'boundary', centre(inner), q(container, '[data-node-id="inner"]')!);
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[1][0]).toMatchObject({ kind: 'add-boundary', parent: 'inner' });

    // Inside the outer box but outside the inner one: the outer is the parent.
    placeBoundary(container, 'boundary', { x: outer.x + 3, y: outer.y + 3 }, q(container, '[data-node-id="outer"]')!);
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[2][0]).toMatchObject({ parent: 'outer' });
  });

  it('pins every laid-out node, lets host positions win, and keys the new alias at the click', () => {
    const manual = { user: { x: 12.5, y: 33.25 } };
    const { container, diagram, onEdit } = setup({ manualPositions: manual });
    placeBoundary(container, 'boundary', { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    const { positions } = onEdit.mock.calls[0][1];
    expect(positions.user).toEqual({ x: 12.5, y: 33.25 });
    expect(positions.boundary).toEqual({ x: 780, y: 820 });
    expect(Object.keys(positions).sort()).toEqual([...diagram.elements.map((e) => e.id), 'boundary'].sort());
  });

  it('offers no connect handle on a new or empty boundary', () => {
    const diagram = parseC4('Boundary(lone, "Lone") {\n}\nPerson(u, "U")').diagram!;
    const { container } = setup({ diagram });
    expect(q(container, '[data-connect-handle="lone"]')).toBeNull();
    expect(q(container, '[data-connect-handle="u"]')).not.toBeNull();
  });

  it('is gated like elements: no menu without onEdit or outside edit mode', () => {
    for (const overrides of [{ onEdit: undefined }, { isEditMode: false }]) {
      const { container } = setup(overrides);
      rightClick(container, { x: 900, y: 900 });
      expect(menuOf(container)).toBeNull();
    }
  });

  it('is exclusive with other gestures while the boundary is being named', () => {
    const { container, onEdit } = setup();
    placeBoundary(container, 'boundary', { x: 900, y: 900 });
    rightClick(container, { x: 50, y: 900 });
    expect(menuOf(container)).toBeNull();
    // Connect handles are withdrawn while the label input is open.
    expect(q(container, '[data-connect-handle]')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('closes the menu on Escape, reporting nothing', () => {
    const { container, onEdit } = setup();
    rightClick(container, { x: 900, y: 900 });
    expect(menuOf(container)).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menuOf(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
