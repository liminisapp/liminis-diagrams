import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useC4ConnectDrag } from './useC4ConnectDrag';

// happy-dom has no SVG geometry: identity CTM, as in C4InteractiveRenderer.test.tsx.
// That covers the gesture pipeline, not the coordinate maths.
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

function Harness(props: {
  onConnect: (id: string, p: { x: number; y: number }) => void;
  enabled?: boolean;
  canStart?: () => boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { connectSourceId, connectPointer, startConnect } = useC4ConnectDrag({
    svgRef,
    enabled: props.enabled ?? true,
    canStart: props.canStart,
    onConnect: props.onConnect,
  });
  return (
    <svg ref={svgRef} data-source={connectSourceId ?? ''} data-x={connectPointer?.x ?? ''}>
      <circle data-handle="a" onPointerDown={(e) => startConnect('a', e)} />
    </svg>
  );
}

const setup = (props: Partial<Parameters<typeof Harness>[0]> = {}) => {
  const onConnect = vi.fn();
  const utils = render(<Harness onConnect={onConnect} {...props} />);
  const svg = utils.container.querySelector('svg')!;
  const handle = utils.container.querySelector('[data-handle]')!;
  return { onConnect, svg, handle };
};

describe('useC4ConnectDrag', () => {
  it('reports the release point on pointerup and returns to idle', () => {
    const { onConnect, svg, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 5, clientY: 5 });
    expect(svg.getAttribute('data-source')).toBe('a');
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 60 });
    expect(svg.getAttribute('data-x')).toBe('50');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 70, clientY: 80 });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith('a', { x: 70, y: 80 });
    expect(svg.getAttribute('data-source')).toBe('');
  });

  it('reports nothing on pointercancel and leaves no stuck state', () => {
    const { onConnect, svg, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(onConnect).not.toHaveBeenCalled();
    expect(svg.getAttribute('data-source')).toBe('');
    // A later stray pointerup does nothing.
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 9, clientY: 9 });
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('ignores a second finger: it can neither start, move nor end the gesture', () => {
    const { onConnect, svg, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 99, clientY: 99 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 77, clientY: 77 });
    expect(svg.getAttribute('data-x')).toBe('5');
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 77, clientY: 77 });
    expect(onConnect).not.toHaveBeenCalled();
    expect(svg.getAttribute('data-source')).toBe('a');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 6, clientY: 6 });
    expect(onConnect).toHaveBeenCalledWith('a', { x: 6, y: 6 });
  });

  it('does nothing when disabled or when canStart refuses', () => {
    const a = setup({ enabled: false });
    fireEvent.pointerDown(a.handle, { pointerId: 1, clientX: 1, clientY: 1 });
    expect(a.svg.getAttribute('data-source')).toBe('');

    const b = setup({ canStart: () => false });
    fireEvent.pointerDown(b.handle, { pointerId: 1, clientX: 1, clientY: 1 });
    expect(b.svg.getAttribute('data-source')).toBe('');
  });
});
