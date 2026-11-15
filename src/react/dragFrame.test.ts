import { describe, it, expect, afterEach } from 'vitest';
import { findScrollContainerRect, isInsideGrowthMargin, scaleDiffers, GROWTH_CAP_MARGIN_PX } from './dragFrame';

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
