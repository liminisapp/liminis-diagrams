import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useC4DiagramDrag } from './useC4DiagramDrag';

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

type Props = Omit<Parameters<typeof useC4DiagramDrag>[0], 'svgRef' | 'enabled'>;

function Harness(props: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { draggedNodeId, startNodeDrag } = useC4DiagramDrag({ svgRef, enabled: true, ...props });
  return (
    <svg ref={svgRef} data-dragging={draggedNodeId ?? ''}>
      <rect data-node="a" onPointerDown={(e) => startNodeDrag('a', 0, 0, e)} />
    </svg>
  );
}

function setup(props: Props = {}) {
  const utils = render(<Harness {...props} />);
  const svg = utils.container.querySelector('svg')!;
  const node = utils.container.querySelector('[data-node]')!;
  fireEvent.pointerDown(node, { pointerId: 1, clientX: 0, clientY: 0 });
  return { svg };
}

describe('useC4DiagramDrag: callback info', () => {
  it('passes the pointer point and altKey of the release event to onNodeDragEnd', () => {
    const onNodeDragEnd = vi.fn();
    setup({ onNodeDragEnd });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 20, altKey: true });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 30, clientY: 40, altKey: false });
    expect(onNodeDragEnd).toHaveBeenCalledTimes(1);
    const [id, x, y, info] = onNodeDragEnd.mock.calls[0];
    expect([id, x, y]).toEqual(['a', 10, 20]);
    expect(info).toMatchObject({ point: { x: 30, y: 40 }, clientX: 30, clientY: 40, altKey: false });
  });

  it('reads altKey true when ⌥ is held at release', () => {
    const onNodeDragEnd = vi.fn();
    setup({ onNodeDragEnd });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1, clientY: 1, altKey: true });
    expect(onNodeDragEnd.mock.calls[0][3].altKey).toBe(true);
  });

  it('passes info on onNodeDrag too', () => {
    const onNodeDrag = vi.fn();
    setup({ onNodeDrag });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 5, clientY: 6, altKey: true });
    expect(onNodeDrag.mock.calls[0][3]).toMatchObject({ point: { x: 5, y: 6 }, altKey: true });
  });
});

describe('useC4DiagramDrag: cancel semantics', () => {
  it('without onNodeDragCancel, pointercancel still reports as an end (unchanged)', () => {
    const onNodeDragEnd = vi.fn();
    const { svg } = setup({ onNodeDragEnd });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(onNodeDragEnd).toHaveBeenCalledTimes(1);
    expect(svg.getAttribute('data-dragging')).toBe('');
  });

  it('without onNodeDragCancel, Escape does nothing', () => {
    const { svg } = setup({ onNodeDragEnd: vi.fn() });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(svg.getAttribute('data-dragging')).toBe('a');
  });

  it('with onNodeDragCancel, pointercancel cancels and does not end', () => {
    const onNodeDragEnd = vi.fn();
    const onNodeDragCancel = vi.fn();
    const { svg } = setup({ onNodeDragEnd, onNodeDragCancel });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(onNodeDragCancel).toHaveBeenCalledWith('a');
    expect(onNodeDragEnd).not.toHaveBeenCalled();
    expect(svg.getAttribute('data-dragging')).toBe('');
  });

  it('with onNodeDragCancel, Escape cancels the drag and a later pointerup reports nothing', () => {
    const onNodeDragEnd = vi.fn();
    const onNodeDragCancel = vi.fn();
    const { svg } = setup({ onNodeDragEnd, onNodeDragCancel });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onNodeDragCancel).toHaveBeenCalledWith('a');
    expect(svg.getAttribute('data-dragging')).toBe('');
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onNodeDragEnd).not.toHaveBeenCalled();
    expect(onNodeDragCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores a cancel from a pointer that does not own the drag', () => {
    const onNodeDragCancel = vi.fn();
    const { svg } = setup({ onNodeDragCancel });
    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(onNodeDragCancel).not.toHaveBeenCalled();
    expect(svg.getAttribute('data-dragging')).toBe('a');
  });

  it('ignores other keys', () => {
    const onNodeDragCancel = vi.fn();
    setup({ onNodeDragCancel });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onNodeDragCancel).not.toHaveBeenCalled();
  });
});
