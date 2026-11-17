import { describe, it, expect, afterEach } from 'vitest';
import {
  findScrollContainerRect,
  isInsideGrowthMargin,
  scaleDiffers,
  originOffset,
  originShift,
  GROWTH_CAP_MARGIN_PX,
} from './dragFrame';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isInsideGrowthMargin', () => {
  const rect = { left: 100, top: 100, right: 900, bottom: 700 };
  it('is false well inside the rect', () => {
    expect(isInsideGrowthMargin(rect, 500, 400, GROWTH_CAP_MARGIN_PX)).toBe(false);
  });
  it.each([
    [120, 400],
    [880, 400],
    [500, 120],
    [500, 680],
  ])('is true within the margin of an edge: %s,%s', (x, y) => {
    expect(isInsideGrowthMargin(rect, x, y, GROWTH_CAP_MARGIN_PX)).toBe(true);
  });
  it('is true outside the rect', () => {
    expect(isInsideGrowthMargin(rect, 5000, 400, GROWTH_CAP_MARGIN_PX)).toBe(true);
    expect(isInsideGrowthMargin(rect, -20, 400, GROWTH_CAP_MARGIN_PX)).toBe(true);
  });
  it('is false exactly at the margin boundary', () => {
    expect(isInsideGrowthMargin(rect, 100 + GROWTH_CAP_MARGIN_PX, 400, GROWTH_CAP_MARGIN_PX)).toBe(false);
  });
});

describe('scaleDiffers', () => {
  it('ignores float noise and detects a real change', () => {
    expect(scaleDiffers(0.5, 0.5 + 1e-9)).toBe(false);
    expect(scaleDiffers(0.5, 0.49)).toBe(true);
  });
});

describe('findScrollContainerRect', () => {
  it('returns the nearest clipping ancestor, clamped to the viewport', () => {
    const pane = document.createElement('div');
    pane.style.overflow = 'auto';
    pane.getBoundingClientRect = () => ({ left: 10, top: 20, right: 600, bottom: 500 }) as DOMRect;
    const wrapper = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.appendChild(svg);
    pane.appendChild(wrapper);
    document.body.appendChild(pane);
    expect(findScrollContainerRect(svg)).toEqual({ left: 10, top: 20, right: 600, bottom: 500 });
  });

  it('falls back to the viewport with no clipping ancestor', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);
    expect(findScrollContainerRect(svg)).toEqual({
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    });
  });
});

describe('originOffset / originShift (#110)', () => {
  const f = (viewBoxX: number, viewBoxY: number, scale = 1) => ({ viewBoxX, viewBoxY, scale });

  it('originOffset is -viewBox * scale, with no negative zero', () => {
    expect(originOffset(f(-20, -10, 0.5))).toEqual({ x: 10, y: 5 });
    expect(Object.is(originOffset(f(0, 0, 2)).x, 0)).toBe(true);
  });

  it('reports top and left growth as a positive (right/down) shift', () => {
    expect(originShift(f(0, 0), f(-30, -40))).toEqual({ dx: 30, dy: 40 });
  });

  it('reports shrink with the opposite sign', () => {
    expect(originShift(f(-30, -40), f(-10, 0))).toEqual({ dx: -20, dy: -40 });
  });

  it('reports one axis only when only that axis grew', () => {
    expect(originShift(f(0, 0), f(0, -25))).toEqual({ dx: 0, dy: 25 });
  });

  it('is null for a frame that only changed at the bottom/right', () => {
    expect(originShift(f(-10, -10), f(-10, -10))).toBeNull();
  });

  it('multiplies by the rendered scale', () => {
    expect(originShift(f(0, 0, 0.5), f(-30, -40, 0.5))).toEqual({ dx: 15, dy: 20 });
  });

  it('uses each commit\'s own scale: a pure scale change with viewBox != 0 is a real shift', () => {
    expect(originShift(f(-40, -40, 1), f(-40, -40, 0.5))).toEqual({ dx: -20, dy: -20 });
  });

  it('keeps fractional values unrounded', () => {
    const s = originShift(f(0, 0, 0.3), f(-1.5, -0.7, 0.3))!;
    expect(s.dx).toBeCloseTo(0.45, 10);
    expect(s.dy).toBeCloseTo(0.21, 10);
  });
});
