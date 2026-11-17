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

describe('useC4DiagramDrag: scale change and remap (#104)', () => {
  // A CTM stub with a real scale `a`, which the test can change mid-drag.
  let scale = 1;
  beforeEach(() => {
    scale = 1;
    const proto = window.SVGSVGElement?.prototype as unknown as Record<string, unknown>;
    const inverseOf = (a: number) => ({ a: 1 / a, e: 0, d: 1 / a, f: 0 });
    proto.getScreenCTM = function getScreenCTM() {
      return { a: scale, d: scale, e: 0, f: 0, inverse: () => inverseOf(scale) };
    };
    proto.createSVGPoint = function createSVGPoint() {
      return {
        x: 0,
        y: 0,
        matrixTransform(m: { a: number; e: number; d: number; f: number }) {
          return { x: m.a * this.x + m.e, y: m.d * this.y + m.f };
        },
      };
    };
  });

  it('keeps the locked mapping while the scale is unchanged', () => {
    const onNodeDrag = vi.fn();
    setup({ onNodeDrag });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onNodeDrag.mock.calls[0].slice(1, 3)).toEqual([100, 50]);
  });

  it('switches to the live mapping once the scale differs from the drag start', () => {
    const onNodeDrag = vi.fn();
    setup({ onNodeDrag });
    scale = 0.5;
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onNodeDrag.mock.calls[0].slice(1, 3)).toEqual([200, 100]);
  });

  it('ignores float noise in the scale', () => {
    const onNodeDrag = vi.fn();
    setup({ onNodeDrag });
    scale = 1 + 1e-9;
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onNodeDrag.mock.calls[0].slice(1, 3)).toEqual([100, 50]);
  });

  function RemapHarness({ onNodeDrag, expose }: { onNodeDrag: Props['onNodeDrag']; expose: (r: () => boolean) => void }) {
    const svgRef = useRef<SVGSVGElement>(null);
    const { startNodeDrag, remapDrag } = useC4DiagramDrag({ svgRef, enabled: true, onNodeDrag });
    expose(remapDrag);
    return (
      <svg ref={svgRef}>
        <rect data-node="a" onPointerDown={(e) => startNodeDrag('a', 0, 0, e)} />
      </svg>
    );
  }

  it('remapDrag re-reports the last pointer position only when it changed', () => {
    const onNodeDrag = vi.fn();
    let remap: () => boolean = () => false;
    const { container } = render(<RemapHarness onNodeDrag={onNodeDrag} expose={(r) => (remap = r)} />);
    fireEvent.pointerDown(container.querySelector('[data-node]')!, { pointerId: 1, clientX: 0, clientY: 0 });
    // Nothing to remap before the pointer has moved.
    expect(remap()).toBe(false);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onNodeDrag).toHaveBeenCalledTimes(1);
    // Same mapping: nothing changed, nothing reported.
    expect(remap()).toBe(false);
    expect(onNodeDrag).toHaveBeenCalledTimes(1);
    // The scale changed under a stationary pointer.
    scale = 0.5;
    expect(remap()).toBe(true);
    expect(onNodeDrag).toHaveBeenCalledTimes(2);
    const [, x, y, info] = onNodeDrag.mock.calls[1];
    expect([x, y]).toEqual([200, 100]);
    expect(info.synthetic).toBe(true);
    // Settled again.
    expect(remap()).toBe(false);
  });

  it('remapDrag is a no-op after the drag ends', () => {
    const onNodeDrag = vi.fn();
    let remap: () => boolean = () => false;
    const { container } = render(<RemapHarness onNodeDrag={onNodeDrag} expose={(r) => (remap = r)} />);
    fireEvent.pointerDown(container.querySelector('[data-node]')!, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 50 });
    scale = 0.5;
    expect(remap()).toBe(false);
  });
});

describe('useC4DiagramDrag: liveMapping (#110)', () => {
  // A CTM stub whose translation `e`/`f` the test can change mid-drag (a host that scrolls).
  let tx = 0;
  let ty = 0;
  beforeEach(() => {
    tx = 0;
    ty = 0;
    const proto = window.SVGSVGElement?.prototype as unknown as Record<string, unknown>;
    proto.getScreenCTM = function getScreenCTM() {
      const t = { x: tx, y: ty };
      return { a: 1, d: 1, e: t.x, f: t.y, inverse: () => ({ a: 1, d: 1, e: -t.x, f: -t.y }) };
    };
    proto.createSVGPoint = function createSVGPoint() {
      return {
        x: 0,
        y: 0,
        matrixTransform(m: { a: number; e: number; d: number; f: number }) {
          return { x: m.a * this.x + m.e, y: m.d * this.y + m.f };
        },
      };
    };
  });

  it('keeps the locked mapping by default when the translation changes mid-drag', () => {
    const onNodeDrag = vi.fn();
    setup({ onNodeDrag });
    ty = 30; // the host scrolled
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onNodeDrag.mock.calls[0].slice(1, 3)).toEqual([100, 50]);
  });

  it('follows a mid-drag change of the translation with liveMapping', () => {
    const onNodeDrag = vi.fn();
    setup({ onNodeDrag, liveMapping: true });
    ty = 30;
    tx = -10;
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onNodeDrag.mock.calls[0].slice(1, 3)).toEqual([110, 20]);
  });
});
