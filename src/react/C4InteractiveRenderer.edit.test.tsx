import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

function arm(c: HTMLElement, kind: string) {
  fireEvent.click(q(c, `[data-kind="${kind}"]`)!);
}
function tap(c: HTMLElement, p: { x: number; y: number }, pointerId = 1) {
  const layer = q(c, '[data-placement-layer]')!;
  fireEvent.pointerDown(layer, { pointerId, clientX: p.x, clientY: p.y });
  fireEvent.pointerUp(layer, { pointerId, clientX: p.x, clientY: p.y });
}
const labelInput = (c: HTMLElement) => q(c, '[data-c4-label-input]') as HTMLInputElement | null;

function connect(c: HTMLElement, fromId: string, to: { x: number; y: number }) {
  const handle = q(c, `[data-connect-handle="${fromId}"]`)!;
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1, clientY: 1 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe('add element', () => {
  it('places at the top level, names inline, and reports one add-element edit', () => {
    const { container, onEdit } = setup();
    arm(container, 'system');
    tap(container, { x: 900, y: 900 });

    expect(onEdit).not.toHaveBeenCalled(); // nothing until the label is confirmed
    expect(q(container, '[data-pending-element]')).not.toBeNull();
    const input = labelInput(container)!;
    expect(input.value).toBe('System'); // kind-appropriate placeholder
    fireEvent.change(input, { target: { value: 'Billing' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({ kind: 'add-element', elementKind: 'system', label: 'Billing', alias: 'billing' });
    // Placed so its centre is where the user tapped (240x80 node).
    expect(ctx.positions.billing).toEqual({ x: 780, y: 860 });
    expect(labelInput(container)).toBeNull();
    expect(q(container, '[data-pending-element]')).toBeNull();
  });

  it('uses a generated unique alias when the label collides with an existing one', () => {
    const { container, onEdit } = setup();
    arm(container, 'person');
    tap(container, { x: 900, y: 900 });
    const input = labelInput(container)!;
    fireEvent.change(input, { target: { value: 'User' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((onEdit.mock.calls[0][0] as { alias: string }).alias).toBe('user_2');
  });

  it('falls back to the placeholder when the label is confirmed empty', () => {
    const { container, onEdit } = setup();
    arm(container, 'containerDb');
    tap(container, { x: 900, y: 900 });
    const input = labelInput(container)!;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toMatchObject({ label: 'Database', alias: 'database' });
  });

  it('reports the enclosing boundary as parent when placed inside one', () => {
    const { container, onEdit } = setup();
    const b = rectOf(container, 'b');
    arm(container, 'component');
    tap(container, { x: b.x + 5, y: b.y + 5 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toMatchObject({ kind: 'add-element', elementKind: 'component', parent: 'b' });
  });

  it('omits parent when placed outside every boundary', () => {
    const { container, onEdit } = setup();
    arm(container, 'person');
    tap(container, { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).not.toHaveProperty('parent');
  });

  it('reports nothing on Escape, and leaves no stuck state', () => {
    const { container, onEdit } = setup();
    arm(container, 'system');
    tap(container, { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(labelInput(container)).toBeNull();
    expect(q(container, '[data-pending-element]')).toBeNull();
    expect(q(container, '[data-placement-layer]')).toBeNull();
    // A new add works afterwards.
    arm(container, 'system');
    expect(q(container, '[data-placement-layer]')).not.toBeNull();
  });

  it('reports nothing when the input loses focus', () => {
    const { container, onEdit } = setup();
    arm(container, 'system');
    tap(container, { x: 900, y: 900 });
    fireEvent.blur(labelInput(container)!);
    expect(onEdit).not.toHaveBeenCalled();
    expect(labelInput(container)).toBeNull();
  });

  it('abandons an add on pointercancel while armed and while naming', () => {
    const a = setup();
    arm(a.container, 'system');
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(q(a.container, '[data-placement-layer]')).toBeNull();

    const b = setup();
    arm(b.container, 'system');
    tap(b.container, { x: 900, y: 900 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(labelInput(b.container)).toBeNull();
    expect(b.onEdit).not.toHaveBeenCalled();
  });

  it('does not place when the pointer is cancelled between down and up', () => {
    const { container, onEdit } = setup();
    arm(container, 'system');
    const layer = q(container, '[data-placement-layer]')!;
    fireEvent.pointerDown(layer, { pointerId: 1, clientX: 900, clientY: 900 });
    fireEvent.pointerCancel(layer, { pointerId: 1 });
    expect(labelInput(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('Escape disarms a kind waiting for placement', () => {
    const { container } = setup();
    arm(container, 'system');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(q(container, '[data-placement-layer]')).toBeNull();
  });

  it('toggling the armed kind again disarms it', () => {
    const { container } = setup();
    arm(container, 'system');
    arm(container, 'system');
    expect(q(container, '[data-placement-layer]')).toBeNull();
  });
});

describe('connect', () => {
  it('reports one add-relationship when dragging from one element to another', () => {
    const { container, onEdit, onPositionChange } = setup();
    connect(container, 'user', centre(rectOf(container, 'ext')));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({
      kind: 'add-relationship',
      sourceId: 'user',
      targetId: 'ext',
      label: 'Uses',
    });
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('targets the element inside a boundary, not the boundary', () => {
    const { container, onEdit } = setup();
    connect(container, 'user', centre(rectOf(container, 'api')));
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
    expect(q(container, '[data-c4-palette]')).toBeNull();
    expect(q(container, '[data-connect-handle]')).toBeNull();
    expect(q(container, '[data-placement-layer]')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('shows no add or connect affordance without an onEdit callback', () => {
    // liminis-editor passes isEditMode for dragging alone; it must not grow dead buttons.
    const { container } = setup({ onEdit: undefined });
    expect(q(container, '[data-c4-palette]')).toBeNull();
    expect(q(container, '[data-connect-handle]')).toBeNull();
    // Dragging still works there.
    expect(container.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
  });

  it('keeps the DOM identical to before when editing is not enabled', () => {
    const { container } = setup({ onEdit: undefined });
    const root = container.firstElementChild!;
    expect(root.firstElementChild!.tagName.toLowerCase()).toBe('svg');
  });

  it('drops a half-finished add when edit mode is switched off', () => {
    const diagram = parseC4(SOURCE).diagram!;
    const onEdit = vi.fn();
    const props = { diagram, isDarkMode: false, manualPositions: {}, onPositionChange: vi.fn(), onEdit };
    const { container, rerender } = render(<C4InteractiveRenderer {...props} isEditMode />);
    arm(container, 'system');
    tap(container, { x: 900, y: 900 });
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
    connect(container, 'user', centre(rectOf(container, 'ext')));
    const { positions } = onEdit.mock.calls[0][1];
    for (const id of diagram.elements.map((e) => e.id)) expect(positions[id]).toBeDefined();
    expect(positionsOf(diagram, positions)).toEqual(before);
  });

  it('keeps existing manual positions untouched and pins only the rest', () => {
    const manual = { user: { x: 12.5, y: 33.25 } };
    const { container, diagram, onEdit } = setup({ manualPositions: manual });
    connect(container, 'user', centre(rectOf(container, 'ext')));
    const { positions } = onEdit.mock.calls[0][1];
    expect(positions.user).toEqual({ x: 12.5, y: 33.25 });
    // Everything now has a position, and laying out with them is a fixed point.
    for (const id of diagram.elements.map((e) => e.id)) expect(positions[id]).toBeDefined();
    const once = positionsOf(diagram, positions);
    expect(positionsOf(diagram, once)).toEqual(once);
  });

  it('reports the new element together with the pinned positions', () => {
    const { container, diagram, onEdit } = setup();
    arm(container, 'system');
    tap(container, { x: 900, y: 900 });
    fireEvent.keyDown(labelInput(container)!, { key: 'Enter' });
    const { positions } = onEdit.mock.calls[0][1];
    expect(Object.keys(positions).sort()).toEqual([...diagram.elements.map((e) => e.id), 'system'].sort());
  });

  it('pins the legend only if the host already positioned it', () => {
    const none = setup();
    connect(none.container, 'user', centre(rectOf(none.container, 'ext')));
    expect(none.onEdit.mock.calls[0][1].positions).not.toHaveProperty('__legend__');

    const withLegend = setup({ manualPositions: { __legend__: { x: 1, y: 2 } } });
    connect(withLegend.container, 'user', centre(rectOf(withLegend.container, 'ext')));
    expect(withLegend.onEdit.mock.calls[0][1].positions.__legend__).toEqual({ x: 1, y: 2 });
  });
});
