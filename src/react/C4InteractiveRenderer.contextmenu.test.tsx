import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import type { JSX } from 'react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import type { C4InteractiveRendererProps } from './C4InteractiveRenderer';
import type { C4ContextMenuRequest } from './menuItems';
import { C4_ADDABLE_BOUNDARY_KINDS, C4_ADDABLE_ELEMENT_KINDS } from '../core/alias';
import { parseC4 } from '../core/parser';
import type { C4Edit } from '../core/edit';

/**
 * The host-owned context menu (`onContextMenu`). As in the edit tests, happy-dom has
 * no SVG geometry, so the CTM is stubbed as identity (client px === SVG units).
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
type Edit = [C4Edit, { positions: Positions }];

const diagram = parseC4(SOURCE).diagram!;

function setup(overrides: Partial<C4InteractiveRendererProps> = {}, hooked = true) {
  const onEdit = vi.fn<(edit: C4Edit, ctx: { positions: Positions }) => void>();
  const onPositionChange = vi.fn();
  const onContextMenu = vi.fn<(r: C4ContextMenuRequest) => void>();
  const props: C4InteractiveRendererProps = {
    diagram,
    isDarkMode: false,
    isEditMode: true,
    manualPositions: {},
    onPositionChange,
    onEdit,
    ...(hooked ? { onContextMenu } : {}),
    ...overrides,
  };
  const utils = render(<C4InteractiveRenderer {...props} />);
  const rerenderWith = (next: Partial<C4InteractiveRendererProps>) =>
    utils.rerender(<C4InteractiveRenderer {...props} {...next} />);
  return { ...utils, onEdit, onPositionChange, onContextMenu, rerenderWith };
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const svgOf = (c: HTMLElement) => q(c, 'svg[data-diagram]')!;
const menuOf = (c: HTMLElement) => q(c, '[data-c4-menu]');
const labelInput = (c: HTMLElement) => q(c, '[data-c4-label-input]') as HTMLInputElement | null;
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

function rightClick(c: HTMLElement, p: { x: number; y: number }, target?: Element) {
  return fireEvent.contextMenu(target ?? svgOf(c), { clientX: p.x, clientY: p.y });
}
function pressDown(c: HTMLElement, p: { x: number; y: number }, pointerId = 1, target?: Element) {
  fireEvent.pointerDown(target ?? svgOf(c), {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: p.x,
    clientY: p.y,
  });
}
function longPress(c: HTMLElement, p: { x: number; y: number }, pointerId = 1, target?: Element) {
  pressDown(c, p, pointerId, target);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}
function confirmLabel(c: HTMLElement, value?: string) {
  const input = labelInput(c)!;
  if (value !== undefined) fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const ALL_IDS = [
  ...C4_ADDABLE_ELEMENT_KINDS.map((k) => `add:element:${k}`),
  ...C4_ADDABLE_BOUNDARY_KINDS.map((k) => `add:boundary:${k}`),
];
const LABELS = [
  'Person',
  'System',
  'Container',
  'Component',
  'System DB',
  'Container DB',
  'Component DB',
  'System boundary',
  'Container boundary',
  'Boundary',
];

describe('onContextMenu: right-click', () => {
  it('calls the hook once with the point, pointerId null and every item, and draws no menu', () => {
    const { container, onContextMenu } = setup();
    rightClick(container, { x: 900, y: 900 });

    expect(menuOf(container)).toBeNull();
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const req = onContextMenu.mock.calls[0][0];
    expect(req).toMatchObject({ clientX: 900, clientY: 900, pointerId: null });
    expect(req.items.map((i) => i.id)).toEqual(ALL_IDS);
    expect(req.items.map((i) => i.label)).toEqual(LABELS);
    expect(req.items.map((i) => i.group)).toEqual([
      ...C4_ADDABLE_ELEMENT_KINDS.map(() => 'element'),
      ...C4_ADDABLE_BOUNDARY_KINDS.map(() => 'boundary'),
    ]);
    expect(req.items.every((i) => typeof i.select === 'function')).toBe(true);
  });

  it('labels match the built-in menu', () => {
    const builtIn = setup({}, false);
    rightClick(builtIn.container, { x: 900, y: 900 });
    const builtInLabels = Array.from(menuOf(builtIn.container)!.querySelectorAll('[role="menuitem"]')).map(
      (b) => b.textContent,
    );
    expect(builtInLabels).toEqual(LABELS);

    const hooked = setup();
    rightClick(hooked.container, { x: 900, y: 900 });
    const hookLabels = hooked.onContextMenu.mock.calls[0][0].items.map((i) => i.label);
    expect(hookLabels).toEqual(builtInLabels);
  });

  it('suppresses the browser menu and stops an ancestor onContextMenu', () => {
    const ancestor = vi.fn();
    const onContextMenu = vi.fn();
    const Host = (): JSX.Element => (
      <div onContextMenu={ancestor}>
        <C4InteractiveRenderer
          diagram={diagram}
          isDarkMode={false}
          isEditMode
          manualPositions={{}}
          onPositionChange={vi.fn()}
          onEdit={vi.fn()}
          onContextMenu={onContextMenu}
        />
      </div>
    );
    const { container } = render(<Host />);
    const notPrevented = rightClick(container, { x: 900, y: 900 });
    expect(notPrevented).toBe(false); // fireEvent returns false when preventDefault() was called
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(ancestor).not.toHaveBeenCalled();
  });

  it('without the prop: the ancestor still sees the event and the built-in menu opens', () => {
    const ancestor = vi.fn();
    const Host = (): JSX.Element => (
      <div onContextMenu={ancestor}>
        <C4InteractiveRenderer
          diagram={diagram}
          isDarkMode={false}
          isEditMode
          manualPositions={{}}
          onPositionChange={vi.fn()}
          onEdit={vi.fn()}
        />
      </div>
    );
    const { container } = render(<Host />);
    rightClick(container, { x: 900, y: 900 });
    expect(ancestor).toHaveBeenCalledTimes(1);
    expect(menuOf(container)).not.toBeNull();
  });

  it('clears a selected element', () => {
    const { container, onContextMenu } = setup();
    const api = rectOf(container, 'api');
    const target = q(container, '[data-node-id="api"]')!;
    fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 1, clientY: 1 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
    rightClick(container, centre(api), target);
    expect(q(container, '[data-c4-action-bar]')).toBeNull();
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe('onContextMenu: no items where the diagram has none', () => {
  it('right-click on a node gives items: []', () => {
    const { container, onContextMenu } = setup();
    const p = centre(rectOf(container, 'ext'));
    rightClick(container, p, q(container, '[data-node-id="ext"]')!);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].items).toEqual([]);
    expect(menuOf(container)).toBeNull();
  });

  it('right-click on a relationship label gives items: []', () => {
    const { container, onContextMenu } = setup();
    const label = q(container, '[data-rel-index]');
    expect(label).not.toBeNull();
    rightClick(container, { x: 50, y: 50 }, label!);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].items).toEqual([]);
  });

  it('right-click on a connect handle gives items: []', () => {
    const { container, onContextMenu } = setup();
    const handle = q(container, '[data-connect-handle]')!;
    rightClick(container, { x: 10, y: 10 }, handle);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].items).toEqual([]);
  });

  it('edit mode off: still called, with items: [], and the event is stopped', () => {
    const ancestor = vi.fn();
    const onContextMenu = vi.fn();
    const { container } = render(
      <div onContextMenu={ancestor}>
        <C4InteractiveRenderer
          diagram={diagram}
          isDarkMode={false}
          isEditMode={false}
          manualPositions={{}}
          onPositionChange={vi.fn()}
          onContextMenu={onContextMenu}
        />
      </div>,
    );
    rightClick(container, { x: 900, y: 900 });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0]).toMatchObject({ clientX: 900, clientY: 900, pointerId: null, items: [] });
    expect(ancestor).not.toHaveBeenCalled();
  });

  it('edit mode without onEdit: items: []', () => {
    const { container, onContextMenu } = setup({ onEdit: undefined });
    rightClick(container, { x: 900, y: 900 });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].items).toEqual([]);
  });

  it('an unmeasurable SVG still reaches the host, with no items', () => {
    const proto = window.SVGSVGElement?.prototype as unknown as Record<string, unknown>;
    proto.getScreenCTM = () => null;
    const { container, onContextMenu } = setup();
    rightClick(container, { x: 900, y: 900 });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].items).toEqual([]);
  });
});

describe('onContextMenu: swallowed states', () => {
  it('a right-click during a move-drag is swallowed without a call', () => {
    const { container, onContextMenu } = setup();
    const node = q(container, '[data-node-id="ext"]')!;
    const p = centre(rectOf(container, 'ext'));
    fireEvent.pointerDown(node, { pointerId: 1, clientX: p.x, clientY: p.y });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: p.x + 30, clientY: p.y + 30 });
    const notPrevented = rightClick(container, { x: 900, y: 900 });
    expect(notPrevented).toBe(false);
    expect(onContextMenu).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x + 30, clientY: p.y + 30 });
  });

  it('a right-click during a connect is swallowed without a call', () => {
    const { container, onContextMenu } = setup();
    const handle = q(container, '[data-connect-handle="user"]')!;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 500, clientY: 500 });
    const notPrevented = rightClick(container, { x: 900, y: 900 });
    expect(notPrevented).toBe(false);
    expect(onContextMenu).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 5, clientY: 5 });
  });

  it('a right-click while a label input is open is handled like any other', () => {
    const { container, onContextMenu } = setup();
    rightClick(container, { x: 900, y: 900 });
    act(() => onContextMenu.mock.calls[0][0].items[1].select());
    expect(labelInput(container)).not.toBeNull();
    rightClick(container, { x: 950, y: 950 });
    expect(onContextMenu).toHaveBeenCalledTimes(2);
  });

  it('select() is a no-op while a label input is open, so the first add is not replaced', () => {
    const { container, onContextMenu, onEdit } = setup();
    rightClick(container, { x: 900, y: 900 });
    const first = onContextMenu.mock.calls[0][0];
    act(() => first.items[0].select());
    const input = labelInput(container)!;
    fireEvent.change(input, { target: { value: 'First' } });

    // A non-modal host menu opened over the open input and picked another kind.
    rightClick(container, { x: 300, y: 300 });
    act(() => onContextMenu.mock.calls[1][0].items[2].select());

    expect(container.querySelectorAll('[data-c4-label-input]')).toHaveLength(1);
    expect(labelInput(container)!.value).toBe('First');
    confirmLabel(container);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe('onContextMenu: long-press', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls the hook once with pointerId set and the same items', () => {
    const { container, onContextMenu } = setup();
    longPress(container, { x: 900, y: 900 }, 7);
    expect(menuOf(container)).toBeNull();
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const req = onContextMenu.mock.calls[0][0];
    expect(req).toMatchObject({ clientX: 900, clientY: 900, pointerId: 7 });
    expect(req.items.map((i) => i.id)).toEqual(ALL_IDS);
  });

  it('on a boundary: drops the move-drag without reporting, and offers boundary-scoped items', () => {
    const { container, onContextMenu, onPositionChange, onEdit } = setup();
    const b = rectOf(container, 'b');
    const p = { x: b.x + 5, y: b.y + 5 };
    longPress(container, p, 1, q(container, '[data-node-id="b"]')!);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x, clientY: p.y });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();

    act(() => onContextMenu.mock.calls[0][0].items.find((i) => i.id === 'add:element:component')!.select());
    confirmLabel(container);
    expect(onEdit.mock.calls[0][0]).toMatchObject({ kind: 'add-element', parent: 'b' });
  });

  it('is not enabled outside edit mode', () => {
    const { container, onContextMenu } = setup({ isEditMode: false });
    longPress(container, { x: 900, y: 900 });
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('a native contextmenu right after a long-press is the same gesture: one call', () => {
    const { container, onContextMenu } = setup();
    longPress(container, { x: 900, y: 900 }, 3);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const notPrevented = rightClick(container, { x: 900, y: 900 });
    expect(notPrevented).toBe(false);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    // Well after, a real right-click is not suppressed.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rightClick(container, { x: 900, y: 900 });
    expect(onContextMenu).toHaveBeenCalledTimes(2);
  });

  it('two right-clicks in a row are both delivered', () => {
    const { container, onContextMenu } = setup();
    rightClick(container, { x: 900, y: 900 });
    rightClick(container, { x: 910, y: 910 });
    expect(onContextMenu).toHaveBeenCalledTimes(2);
  });
});

describe('onContextMenu: select() parity with the built-in menu', () => {
  /** Drive the built-in menu for one kind at a point, return the reported edit. */
  function viaBuiltIn(group: 'element' | 'boundary', kind: string, p: { x: number; y: number }, target?: Element) {
    const { container, onEdit } = setup({}, false);
    fireEvent.contextMenu(target ?? svgOf(container), { clientX: p.x, clientY: p.y });
    const attr = group === 'element' ? 'data-kind' : 'data-boundary-kind';
    fireEvent.click(q(container, `[${attr}="${kind}"]`)!);
    confirmLabel(container, 'Thing');
    return onEdit.mock.calls[0] as Edit;
  }
  function viaHook(id: string, p: { x: number; y: number }, targetId?: string) {
    const { container, onEdit, onContextMenu } = setup();
    const target = targetId ? q(container, `[data-node-id="${targetId}"]`)! : undefined;
    fireEvent.contextMenu(target ?? svgOf(container), { clientX: p.x, clientY: p.y });
    act(() => onContextMenu.mock.calls[0][0].items.find((i) => i.id === id)!.select());
    confirmLabel(container, 'Thing');
    return onEdit.mock.calls[0] as Edit;
  }

  const kinds = [
    ...C4_ADDABLE_ELEMENT_KINDS.map((k) => ['element', k] as const),
    ...C4_ADDABLE_BOUNDARY_KINDS.map((k) => ['boundary', k] as const),
  ];

  it.each(kinds)('top level: %s %s', (group, kind) => {
    const p = { x: 900, y: 900 };
    expect(viaHook(`add:${group}:${kind}`, p)).toEqual(viaBuiltIn(group, kind, p));
  });

  it.each(kinds)('inside boundary b: %s %s', (group, kind) => {
    const probe = setup();
    const b = rectOf(probe.container, 'b');
    probe.unmount();
    const p = { x: b.x + 5, y: b.y + 5 };
    const target = (c: HTMLElement) => q(c, '[data-node-id="b"]')!;
    const hook = (() => {
      const { container, onEdit, onContextMenu } = setup();
      fireEvent.contextMenu(target(container), { clientX: p.x, clientY: p.y });
      act(() => onContextMenu.mock.calls[0][0].items.find((i) => i.id === `add:${group}:${kind}`)!.select());
      confirmLabel(container, 'Thing');
      return onEdit.mock.calls[0] as Edit;
    })();
    const builtIn = (() => {
      const { container, onEdit } = setup({}, false);
      fireEvent.contextMenu(target(container), { clientX: p.x, clientY: p.y });
      const attr = group === 'element' ? 'data-kind' : 'data-boundary-kind';
      fireEvent.click(q(container, `[${attr}="${kind}"]`)!);
      confirmLabel(container, 'Thing');
      return onEdit.mock.calls[0] as Edit;
    })();
    expect(hook).toEqual(builtIn);
    expect(hook[0]).toMatchObject({ parent: 'b' });
  });

  it('a nested boundary near the parent top-left is clamped inside it, as in the built-in menu', () => {
    const probe = setup();
    const b = rectOf(probe.container, 'b');
    probe.unmount();
    const p = { x: b.x + 2, y: b.y + 2 };
    const { container, onEdit, onContextMenu } = setup();
    fireEvent.contextMenu(q(container, '[data-node-id="b"]')!, { clientX: p.x, clientY: p.y });
    act(() => onContextMenu.mock.calls[0][0].items.find((i) => i.id === 'add:boundary:boundary')!.select());
    confirmLabel(container, 'Inner');
    const { positions } = onEdit.mock.calls[0][1];
    expect(positions.inner.x).toBeGreaterThan(b.x);
    expect(positions.inner.y).toBeGreaterThan(b.y);
  });
});

describe('onContextMenu: select() after things changed', () => {
  it('a vanished parent places at top level without throwing', () => {
    const { container, onContextMenu, onEdit, rerenderWith } = setup();
    const b = rectOf(container, 'b');
    fireEvent.contextMenu(q(container, '[data-node-id="b"]')!, { clientX: b.x + 5, clientY: b.y + 5 });
    const item = onContextMenu.mock.calls[0][0].items.find((i) => i.id === 'add:element:component')!;
    const without = parseC4(`Person(user, "User")\nSystem(ext, "Ext")`).diagram!;
    rerenderWith({ diagram: without });
    expect(() => act(() => item.select())).not.toThrow();
    confirmLabel(container, 'Thing');
    const [edit] = onEdit.mock.calls[0];
    expect(edit).toMatchObject({ kind: 'add-element' });
    expect(edit).not.toHaveProperty('parent');
  });

  it('is a no-op once edit mode is off', () => {
    const { container, onContextMenu, onEdit, rerenderWith } = setup();
    rightClick(container, { x: 900, y: 900 });
    const item = onContextMenu.mock.calls[0][0].items[0];
    rerenderWith({ isEditMode: false });
    expect(() => act(() => item.select())).not.toThrow();
    expect(labelInput(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('does not throw after unmount', () => {
    const { container, onContextMenu, unmount } = setup();
    rightClick(container, { x: 900, y: 900 });
    const item = onContextMenu.mock.calls[0][0].items[0];
    unmount();
    expect(() => act(() => item.select())).not.toThrow();
  });

  it('keeps no state when select() is never called', () => {
    const { container, onContextMenu, onEdit } = setup();
    rightClick(container, { x: 900, y: 900 });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(labelInput(container)).toBeNull();
    expect(menuOf(container)).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('onContextMenu: reverting', () => {
  it('setting the hook to undefined restores the built-in menu', () => {
    const { container, onContextMenu, rerenderWith } = setup();
    rerenderWith({ onContextMenu: undefined });
    rightClick(container, { x: 900, y: 900 });
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(menuOf(container)).not.toBeNull();
  });

  it('supplying the hook while the built-in menu is open closes it', () => {
    const { container, rerenderWith } = setup({}, false);
    rightClick(container, { x: 900, y: 900 });
    expect(menuOf(container)).not.toBeNull();
    rerenderWith({ onContextMenu: vi.fn() });
    expect(menuOf(container)).toBeNull();
  });
});
