import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import { parseC4 } from '../core/parser';
import { layoutC4Diagram } from '../core/layout';
import type { C4Edit } from '../core/edit';
import { LONG_PRESS_DELAY_MS } from './hooks/useC4LongPress';

/**
 * Touch: tap an element to select it; the action bar offers Rename and, for a
 * nested node, Move out. Identity-CTM stub as in the other renderer tests.
 */

const SOURCE = `Person(user, "User")
System_Boundary(a, "A") {
  Container_Boundary(inner, "Inner") {
    Component(deep, "Deep", "Go")
  }
  Container(web, "Web", "React")
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
  return { ...utils, autoLayout, onEdit, onPositionChange };
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const hit = (c: HTMLElement, id: string) => q(c, `[data-node-id="${id}"]`)!;
const rectOf = (c: HTMLElement, id: string) => {
  const r = hit(c, id);
  return {
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    width: Number(r.getAttribute('width')),
    height: Number(r.getAttribute('height')),
  };
};
const centre = (c: HTMLElement, id: string) => {
  const r = rectOf(c, id);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const bar = (c: HTMLElement) => q(c, '[data-c4-action-bar]');
const action = (c: HTMLElement, name: string) => q(c, `[data-c4-action-bar] [data-action="${name}"]`) as HTMLElement | null;
const selected = (c: HTMLElement) => q(c, '[data-selected]')?.getAttribute('data-selected') ?? null;

function touchDown(target: Element, p: { x: number; y: number }, pointerId = 1) {
  fireEvent.pointerDown(target, { pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX: p.x, clientY: p.y });
}
function touchUp(p: { x: number; y: number }, pointerId = 1) {
  fireEvent.pointerUp(window, { pointerId, pointerType: 'touch', clientX: p.x, clientY: p.y });
}
function tap(c: HTMLElement, id: string) {
  const p = centre(c, id);
  touchDown(hit(c, id), p);
  touchUp(p);
}

describe('touch selection and the action bar', () => {
  it('a tap on a nested element selects it and shows Rename and Move out', () => {
    const { container, onPositionChange } = setup();
    tap(container, 'web');
    expect(selected(container)).toBe('web');
    expect(bar(container)).not.toBeNull();
    expect(action(container, 'rename')).not.toBeNull();
    expect(action(container, 'move-out')).not.toBeNull();
    // A tap is not a drag: no positions are written.
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('a top-level element has Rename and no Move out', () => {
    const { container } = setup();
    tap(container, 'user');
    expect(action(container, 'rename')).not.toBeNull();
    expect(action(container, 'move-out')).toBeNull();
  });

  it('a nested boundary offers Move out only; a top-level boundary offers nothing', () => {
    const { container } = setup();
    tap(container, 'inner');
    expect(action(container, 'rename')).toBeNull();
    expect(action(container, 'move-out')).not.toBeNull();
    tap(container, 'a');
    expect(bar(container)).toBeNull();
    expect(selected(container)).toBeNull();
  });

  it('Move out reports a top-level reparent with every position pinned and unchanged', () => {
    const { container, autoLayout, onEdit } = setup();
    tap(container, 'deep');
    fireEvent.click(action(container, 'move-out')!);
    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, ctx] = onEdit.mock.calls[0];
    expect(edit).toEqual({ kind: 'reparent', id: 'deep' });
    expect('parent' in edit).toBe(false);
    for (const n of autoLayout.nodes) expect(ctx.positions[n.id]).toEqual({ x: n.x, y: n.y });
    expect(bar(container)).toBeNull();
  });

  it('Move out matches the ⌥-drag out edit', () => {
    const { container, onEdit } = setup();
    const p = centre(container, 'web');
    fireEvent.pointerDown(hit(container, 'web'), { pointerId: 3, pointerType: 'mouse', button: 0, clientX: p.x, clientY: p.y });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 5000, clientY: 5000, altKey: true });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 5000, clientY: 5000, altKey: true });
    tap(container, 'web');
    fireEvent.click(action(container, 'move-out')!);
    expect(onEdit.mock.calls[0][0]).toEqual(onEdit.mock.calls[1][0]);
  });

  it('Rename opens the inline rename for that element and hides the bar', () => {
    const { container, onEdit } = setup();
    tap(container, 'web');
    fireEvent.click(action(container, 'rename')!);
    const input = q(container, '[data-c4-label-input]') as HTMLInputElement;
    expect(input.value).toBe('Web');
    expect(bar(container)).toBeNull();
    fireEvent.change(input, { target: { value: 'Site' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit.mock.calls[0][0]).toEqual({ kind: 'rename', target: { element: 'web' }, label: 'Site' });
  });

  it('a tap on empty canvas deselects', () => {
    const { container } = setup();
    tap(container, 'web');
    const svg = q(container, 'svg[data-diagram]')!;
    touchDown(svg, { x: 5000, y: 5000 }, 2);
    touchUp({ x: 5000, y: 5000 }, 2);
    expect(bar(container)).toBeNull();
    expect(selected(container)).toBeNull();
  });

  it('Escape deselects', () => {
    const { container } = setup();
    tap(container, 'web');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(bar(container)).toBeNull();
  });

  it('tapping another node moves the selection', () => {
    const { container } = setup();
    tap(container, 'web');
    tap(container, 'user');
    expect(selected(container)).toBe('user');
  });

  it('a drag does not select, and hides the bar while it runs', () => {
    const { container, onPositionChange } = setup();
    tap(container, 'user');
    const p = centre(container, 'user');
    touchDown(hit(container, 'user'), p);
    expect(bar(container)).toBeNull();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: p.x + 80, clientY: p.y + 80 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientX: p.x + 80, clientY: p.y + 80 });
    expect(bar(container)).toBeNull();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('a mouse click does not select (the bar is for touch and pen) and still reports positions', () => {
    const { container, onPositionChange } = setup();
    const p = centre(container, 'web');
    fireEvent.pointerDown(hit(container, 'web'), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: p.x, clientY: p.y });
    expect(bar(container)).toBeNull();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('a pen tap selects like a touch tap', () => {
    const { container } = setup();
    const p = centre(container, 'web');
    fireEvent.pointerDown(hit(container, 'web'), { pointerId: 1, pointerType: 'pen', button: 0, clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'pen', clientX: p.x, clientY: p.y });
    expect(bar(container)).not.toBeNull();
  });

  it('there is no selection without onEdit or outside edit mode', () => {
    for (const overrides of [{ onEdit: undefined }, { isEditMode: false }]) {
      const { container, onEdit } = setup(overrides);
      if (overrides.isEditMode !== false) tap(container, 'web');
      expect(bar(container)).toBeNull();
      expect(onEdit).not.toHaveBeenCalled();
    }
  });

  it('leaving edit mode clears the selection', () => {
    const diagram = parseC4(SOURCE).diagram!;
    const props = { diagram, isDarkMode: false, manualPositions: {}, onPositionChange: vi.fn(), onEdit: vi.fn() };
    const { container, rerender } = render(<C4InteractiveRenderer {...props} isEditMode />);
    tap(container, 'web');
    expect(bar(container)).not.toBeNull();
    rerender(<C4InteractiveRenderer {...props} isEditMode={false} />);
    expect(bar(container)).toBeNull();
    rerender(<C4InteractiveRenderer {...props} isEditMode />);
    expect(bar(container)).toBeNull();
  });

  it('the selected alias disappearing clears the selection', () => {
    const diagram = parseC4(SOURCE).diagram!;
    const without = parseC4(SOURCE.replace('  Container(web, "Web", "React")\n', '')).diagram!;
    const props = { isDarkMode: false, isEditMode: true, manualPositions: {}, onPositionChange: vi.fn(), onEdit: vi.fn() };
    const { container, rerender } = render(<C4InteractiveRenderer {...props} diagram={diagram} />);
    tap(container, 'web');
    expect(bar(container)).not.toBeNull();
    rerender(<C4InteractiveRenderer {...props} diagram={without} />);
    expect(bar(container)).toBeNull();
  });

  it('choosing an action opens no add menu and starts no connect or drag', () => {
    const { container, onEdit, onPositionChange } = setup();
    tap(container, 'web');
    const button = action(container, 'move-out')!;
    // The press on the bar must not reach the canvas.
    fireEvent.pointerDown(button, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 1, clientY: 1 });
    expect(q(container, '[data-c4-menu]')).toBeNull();
    expect(bar(container)).not.toBeNull();
    fireEvent.click(button);
    expect(q(container, '[data-c4-menu]')).toBeNull();
    expect(q(container, '[data-connect-line]')).toBeNull();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('starting the add menu hides the bar', () => {
    const { container } = setup();
    tap(container, 'web');
    fireEvent.contextMenu(q(container, 'svg[data-diagram]')!, { clientX: 5000, clientY: 5000 });
    expect(bar(container)).toBeNull();
  });
});

describe('touch long-press and drag on elements', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('press, pause and drag moves the element; it never becomes a rename', () => {
    const { container, onPositionChange } = setup();
    const p = centre(container, 'web');
    touchDown(hit(container, 'web'), p);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY_MS + 300);
    });
    expect(q(container, '[data-c4-label-input]')).toBeNull();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: p.x + 70, clientY: p.y + 70 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientX: p.x + 70, clientY: p.y + 70 });
    expect(q(container, '[data-c4-label-input]')).toBeNull();
    expect(onPositionChange).toHaveBeenCalledTimes(1);
  });

  it('a long-press on a boundary still opens the add menu', () => {
    const { container } = setup();
    const r = rectOf(container, 'a');
    touchDown(hit(container, 'a'), { x: r.x + 5, y: r.y + 5 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    });
    expect(q(container, '[data-c4-menu]')).not.toBeNull();
  });
});
