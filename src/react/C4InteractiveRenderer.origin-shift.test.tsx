import { useLayoutEffect, useRef, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import { parseC4 } from '../core/parser';
import { installSvgGeometry, type HostLayout, type SvgGeometry } from './test-utils/svgGeometry';

/**
 * #110: `holdOrigin={false}` and `onOriginShift`. A host that opts out of the
 * renderer's origin-holding CSS transform absorbs the origin shift itself, here by
 * scrolling a container by the reported amounts. The geometry stub computes the CTM
 * live from the rendered `<svg>` and the modelled host scroll, so a wrong shift, or a
 * wrong pointer mapping, shows up as the origin or the node moving on screen.
 */

const SOURCE = `Person(user, "User", "End user")
System(web, "Web", "React")
System(api, "API", "Go")
System(ext, "External", "Elsewhere")
Rel(user, web, "Uses")
Rel(web, api, "Calls")
Rel(api, ext, "Calls")`;

const BOUNDARY_SOURCE = `System_Boundary(b, "Boundary") {
  Container(web, "Web", "React")
  Container(api, "API", "Go")
}
Person(user, "User", "End user")
Rel(user, web, "Uses")`;

let geo: SvgGeometry;
afterEach(() => geo?.restore());

const flush = (ms = 40) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const settle = async () => {
  for (let i = 0; i < 12; i++) await flush();
};

type Positions = Record<string, { x: number; y: number }>;
type Size = { width: number; height: number };
type Shift = { dx: number; dy: number };

const PANE = { width: 800, height: 700 };

function FitHost({ children }: { children: (zoom: number, onFrameChange: (s: Size) => void) => React.ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const fit = (size: Size) => setZoom(Math.min(1, PANE.width / size.width, PANE.height / size.height));
  useLayoutEffect(() => {
    const vb = ref.current!.querySelector('svg')!.getAttribute('viewBox')!.split(/\s+/).map(Number);
    fit({ width: vb[2], height: vb[3] });
  }, []);
  return <div ref={ref}>{children(zoom, fit)}</div>;
}

function Host({
  source,
  fit,
  ...rest
}: { source: string; fit?: boolean } & Record<string, unknown>) {
  const [manual, setManual] = useState<Positions>({});
  const [diagram] = useState(() => parseC4(source).diagram!);
  const renderer = (extra: Record<string, unknown>) => (
    <C4InteractiveRenderer
      diagram={diagram}
      isDarkMode={false}
      isEditMode
      manualPositions={manual}
      onPositionChange={(p: Positions) => setManual(p)}
      {...rest}
      {...extra}
    />
  );
  if (!fit) return renderer({});
  return <FitHost>{(zoom, onFrameChange) => renderer({ zoom, onFrameChange })}</FitHost>;
}

interface SetupOptions {
  host?: HostLayout;
  source?: string;
  /** Props for the renderer. `holdOrigin={false}` unless overridden. */
  props?: Record<string, unknown>;
  fit?: boolean;
}

function setup({ host = { mode: 'top-left' }, source = SOURCE, props = {}, fit }: SetupOptions = {}) {
  geo = installSvgGeometry(host);
  const utils = render(<Host source={source} fit={fit} holdOrigin={false} {...props} />);
  const container = utils.container;
  container.style.overflow = 'auto';
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: PANE.width, bottom: PANE.height, width: PANE.width, height: PANE.height }) as DOMRect;
  const svg = container.querySelector('svg')!;
  const rerender = (extra: Record<string, unknown>) =>
    utils.rerender(<Host source={source} fit={fit} holdOrigin={false} {...props} {...extra} />);
  return { ...utils, svg, rerender };
}

const hit = (c: HTMLElement, id: string) => c.querySelector(`[data-node-id="${id}"]`)!;
const origin = (svg: SVGSVGElement) => {
  const m = geo.ctm(svg);
  return { x: m.e, y: m.f };
};

function grab(c: HTMLElement, id: string) {
  const start = geo.nodeScreenPos(c, id);
  const grabAt = { x: start.x + 10, y: start.y + 10 };
  const svg = c.querySelector('svg') as unknown as SVGSVGElement;
  const offsetSvg = 10 / geo.ctm(svg).a;
  fireEvent.pointerDown(hit(c, id), { pointerId: 1, clientX: grabAt.x, clientY: grabAt.y });
  const to = async (dx: number, dy: number) => {
    fireEvent.pointerMove(window, { pointerId: 1, clientX: grabAt.x + dx, clientY: grabAt.y + dy });
    await flush();
  };
  const release = async (dx: number, dy: number) => {
    fireEvent.pointerUp(window, { pointerId: 1, clientX: grabAt.x + dx, clientY: grabAt.y + dy });
    await flush();
  };
  return { start, grabAt, offsetSvg, to, release };
}

/** The grabbed point of the node is within 1px of the pointer, at the current scale. */
function expectFollowsPointer(
  c: HTMLElement,
  id: string,
  g: { grabAt: { x: number; y: number }; offsetSvg: number },
  dx: number,
  dy: number,
) {
  const svg = c.querySelector('svg') as unknown as SVGSVGElement;
  const now = geo.nodeScreenPos(c, id);
  const a = geo.ctm(svg).a;
  expect(Math.abs(now.x + g.offsetSvg * a - (g.grabAt.x + dx)), 'x').toBeLessThanOrEqual(1);
  expect(Math.abs(now.y + g.offsetSvg * a - (g.grabAt.y + dy)), 'y').toBeLessThanOrEqual(1);
}

/**
 * Records every write of `transform` to the svg's inline style, including `''`.
 * Wraps the style object's own property, so it sees writes that never reach the DOM.
 */
function spyOnTransform(svg: SVGSVGElement) {
  const writes: string[] = [];
  const style = svg.style;
  const wrapped = new Proxy(style, {
    set(target, prop, value) {
      if (prop === 'transform') writes.push(String(value));
      return Reflect.set(target, prop, value);
    },
    get(target, prop) {
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  Object.defineProperty(svg, 'style', { configurable: true, get: () => wrapped });
  return writes;
}

/** A host that scrolls its container by the reported shift (scaled by `exactness`). */
function scrollingHost(getSvg: () => SVGSVGElement, exactness = 1) {
  let scrollLeft = 0;
  let scrollTop = 0;
  const shifts: Shift[] = [];
  const origins: { x: number; y: number }[] = [];
  const onOriginShift = (s: Shift) => {
    shifts.push(s);
    scrollLeft += s.dx * exactness;
    scrollTop += s.dy * exactness;
    geo.setHost({ mode: 'top-left', scrollLeft, scrollTop });
    origins.push(origin(getSvg()));
  };
  return { onOriginShift, shifts, origins };
}

describe('holdOrigin={false}: no transform', () => {
  it.each([
    ['up', 0, -300],
    ['left', -300, 0],
    ['down', 0, 600],
    ['right', 600, 0],
    ['up-left', -300, -300],
  ])('never writes a transform while dragging %s, nor after release', async (_d, dx, dy) => {
    const onOriginShift = vi.fn();
    const { container, svg } = setup({ props: { onOriginShift } });
    const writes = spyOnTransform(svg);
    const g = grab(container, 'web');
    for (const f of [0.25, 0.5, 1]) {
      await g.to(dx * f, dy * f);
      expect(svg.style.transform).toBe('');
      expect(svg.getAttribute('style') ?? '').not.toContain('transform');
    }
    await g.release(dx, dy);
    await flush();
    expect(svg.style.transform).toBe('');
    expect(writes).toEqual([]);
  });

  it('never writes a transform on cancel either', async () => {
    const { container, svg } = setup({ props: { onOriginShift: vi.fn(), onEdit: vi.fn() } });
    const writes = spyOnTransform(svg);
    const g = grab(container, 'web');
    await g.to(-300, -300);
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(writes).toEqual([]);
  });

  it('the svg box is the whole drawing: its size follows the viewBox', async () => {
    const { container, svg } = setup({ props: { onOriginShift: vi.fn() } });
    const g = grab(container, 'web');
    await g.to(-300, -300);
    const [vx, vy, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(vx).toBeLessThan(0);
    expect(vy).toBeLessThan(0);
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(w, 6);
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(h, 6);
    await g.release(-300, -300);
  });

  it('is allowed without a callback', async () => {
    const { container, svg } = setup();
    const writes = spyOnTransform(svg);
    const g = grab(container, 'web');
    await g.to(-300, -300);
    await g.release(-300, -300);
    expect(writes).toEqual([]);
  });
});

describe('default (holdOrigin omitted)', () => {
  it('still holds the origin with a transform and never calls onOriginShift', async () => {
    const onOriginShift = vi.fn();
    geo = installSvgGeometry({ mode: 'top-left' });
    const { container } = render(
      <Host source={SOURCE} onOriginShift={onOriginShift} />,
    );
    const svg = container.querySelector('svg')!;
    const g = grab(container, 'web');
    await g.to(-300, -300);
    expect(svg.style.transform).not.toBe('');
    await g.release(-300, -300);
    expect(svg.style.transform).toBe('');
    expect(onOriginShift).not.toHaveBeenCalled();
  });
});

describe('onOriginShift values', () => {
  /** Drives the drag and checks every reported shift against the measured origin move. */
  async function driveAndMeasure(zoom: number, moves: [number, number][], scrolls = false, extra: Record<string, unknown> = {}) {
    const shifts: Shift[] = [];
    const measured: Shift[] = [];
    let svgRef: SVGSVGElement | null = null;
    let prev = { x: 0, y: 0 };
    let scrollLeft = 0;
    let scrollTop = 0;
    const onOriginShift = (s: Shift) => {
      shifts.push(s);
      const now = origin(svgRef!);
      measured.push({ dx: now.x - prev.x, dy: now.y - prev.y });
      if (scrolls) {
        scrollLeft += s.dx;
        scrollTop += s.dy;
        geo.setHost({ mode: 'top-left', scrollLeft, scrollTop });
        prev = origin(svgRef!);
      } else prev = now;
    };
    const { container, svg } = setup({ props: { onOriginShift, zoom, ...extra } });
    svgRef = svg;
    prev = origin(svgRef);
    const g = grab(container, 'web');
    for (const [dx, dy] of moves) await g.to(dx, dy);
    return { shifts, measured, g, container };
  }

  it.each([1, 0.5])('top and left growth match the measured origin movement at scale %s', async (zoom) => {
    const { shifts, measured, g } = await driveAndMeasure(zoom, [
      [0, -100],
      [-120, -100],
      [-120, -300],
      [-300, -300],
    ]);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.length).toBe(measured.length);
    shifts.forEach((s, i) => {
      expect(s.dx).toBeCloseTo(measured[i].dx, 6);
      expect(s.dy).toBeCloseTo(measured[i].dy, 6);
      expect(s.dx).toBeGreaterThanOrEqual(0);
      expect(s.dy).toBeGreaterThanOrEqual(0);
    });
    await g.release(-300, -300);
  });

  it('values are in rendered px: half the size at half scale', async () => {
    const full = await driveAndMeasure(1, [[0, -300]]);
    const totalFull = full.shifts.reduce((a, s) => a + s.dy, 0);
    await full.g.release(0, -300);
    document.body.innerHTML = '';
    geo.restore();
    const half = await driveAndMeasure(0.5, [[0, -150]]);
    const totalHalf = half.shifts.reduce((a, s) => a + s.dy, 0);
    expect(totalFull).toBeGreaterThan(0);
    expect(totalHalf).toBeGreaterThan(0);
    // The same 300 user units of drag (150 rendered px at half scale) grow the frame by
    // the same user-space amount, which is half as many rendered px.
    expect(totalHalf / totalFull).toBeCloseTo(0.5, 1);
    await half.g.release(0, -150);
  });

  it('shrink reports the opposite sign and the total returns to zero', async () => {
    const { shifts, g } = await driveAndMeasure(
      1,
      [
        [-200, -200],
        [0, 0],
      ],
      true,
    );
    const grow = shifts.filter((s) => s.dx > 0 || s.dy > 0);
    const shrink = shifts.filter((s) => s.dx < 0 || s.dy < 0);
    expect(grow.length).toBeGreaterThan(0);
    expect(shrink.length).toBeGreaterThan(0);
    expect(shifts.reduce((a, s) => a + s.dx, 0)).toBeCloseTo(0, 6);
    expect(shifts.reduce((a, s) => a + s.dy, 0)).toBeCloseTo(0, 6);
    await g.release(0, 0);
  });

  it('is per commit, not cumulative', async () => {
    const { shifts, g } = await driveAndMeasure(1, [
      [0, -100],
      [0, -200],
      [0, -300],
    ]);
    // Each report is the increment (about 100px), never the running total (100, 200, 300).
    expect(Math.max(...shifts.map((s) => s.dy))).toBeLessThan(150);
    await g.release(0, -300);
  });

  it('does not fire for bottom/right-only growth', async () => {
    const { shifts, g } = await driveAndMeasure(1, [
      [300, 0],
      [300, 400],
      [700, 700],
    ]);
    expect(shifts).toEqual([]);
    await g.release(700, 700);
  });

  it('does not fire outside a drag, nor for a press and release without moving', async () => {
    const onOriginShift = vi.fn();
    const { container, rerender } = setup({ props: { onOriginShift } });
    rerender({ zoom: 0.5 });
    rerender({ zoom: 1 });
    await flush();
    expect(onOriginShift).not.toHaveBeenCalled();
    const g = grab(container, 'web');
    await g.release(0, 0);
    expect(onOriginShift).not.toHaveBeenCalled();
  });

  it('release after a drag reports nothing extra', async () => {
    const { shifts, g } = await driveAndMeasure(1, [[-200, -200]]);
    const before = shifts.length;
    await g.release(-200, -200);
    await flush();
    expect(shifts.length).toBe(before);
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['pointercancel', () => fireEvent.pointerCancel(window, { pointerId: 1 })],
  ])('%s reports the reverse shift so the host can restore its scroll', async (_n, cancel) => {
    // Cancel semantics need `onEdit` (editing on): `canEdit`.
    const { shifts } = await driveAndMeasure(1, [[-200, -200]], true, { onEdit: vi.fn() });
    const grown = shifts.length;
    expect(grown).toBeGreaterThan(0);
    cancel();
    await flush();
    expect(shifts.length).toBeGreaterThan(grown);
    const last = shifts[shifts.length - 1];
    expect(Math.min(last.dx, last.dy)).toBeLessThan(0);
    expect(Math.max(last.dx, last.dy)).toBeLessThanOrEqual(0);
    expect(shifts.reduce((a, s) => a + s.dx, 0)).toBeCloseTo(0, 6);
    expect(shifts.reduce((a, s) => a + s.dy, 0)).toBeCloseTo(0, 6);
  });
});

describe('a host that scrolls by the reported shift', () => {
  it.each([
    ['up', 0, -300],
    ['left', -300, 0],
    ['up-left', -300, -300],
  ])('keeps the origin still and the node under the pointer: %s', async (_d, dx, dy) => {
    let svgRef: SVGSVGElement | null = null;
    const host = scrollingHost(() => svgRef!);
    const { container, svg } = setup({ props: { onOriginShift: host.onOriginShift } });
    svgRef = svg;
    const origin0 = origin(svgRef);
    const g = grab(container, 'web');
    for (const f of [0.2, 0.4, 0.7, 1]) {
      await g.to(dx * f, dy * f);
      const o = origin(svgRef);
      expect(o.x).toBeCloseTo(origin0.x, 6);
      expect(o.y).toBeCloseTo(origin0.y, 6);
      expectFollowsPointer(container, 'web', g, dx * f, dy * f);
    }
    expect(host.shifts.length).toBeGreaterThan(0);
    // Every origin measured inside the callback, i.e. in the same commit, is unmoved.
    for (const o of host.origins) {
      expect(o.x).toBeCloseTo(origin0.x, 6);
      expect(o.y).toBeCloseTo(origin0.y, 6);
    }
    // Release: no jump.
    await g.release(dx, dy);
    const o = origin(svgRef);
    expect(o.x).toBeCloseTo(origin0.x, 6);
    expect(o.y).toBeCloseTo(origin0.y, 6);
    expectFollowsPointer(container, 'web', g, dx, dy);
  });

  it('works at a non-1 rendered scale', async () => {
    let svgRef: SVGSVGElement | null = null;
    const host = scrollingHost(() => svgRef!);
    const { container, svg } = setup({ props: { onOriginShift: host.onOriginShift, zoom: 0.5 } });
    svgRef = svg;
    const origin0 = origin(svgRef);
    const g = grab(container, 'web');
    for (const f of [0.3, 0.6, 1]) {
      await g.to(-150 * f, -150 * f);
      const o = origin(svgRef);
      expect(o.x).toBeCloseTo(origin0.x, 6);
      expect(o.y).toBeCloseTo(origin0.y, 6);
      expectFollowsPointer(container, 'web', g, -150 * f, -150 * f);
    }
    await g.release(-150, -150);
  });

  it('cancel restores the scroll: the origin ends where it started', async () => {
    let svgRef: SVGSVGElement | null = null;
    const host = scrollingHost(() => svgRef!);
    const { container, svg } = setup({ props: { onOriginShift: host.onOriginShift, onEdit: vi.fn() } });
    svgRef = svg;
    const origin0 = origin(svgRef);
    const g = grab(container, 'web');
    await g.to(-300, -300);
    expect(host.shifts.length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    const o = origin(svgRef);
    expect(o.x).toBeCloseTo(origin0.x, 6);
    expect(o.y).toBeCloseTo(origin0.y, 6);
  });

  it('an inexact host (scrolls 90% of the shift) is followed by the live mapping', async () => {
    let svgRef: SVGSVGElement | null = null;
    const host = scrollingHost(() => svgRef!, 0.9);
    const { container, svg } = setup({ props: { onOriginShift: host.onOriginShift } });
    svgRef = svg;
    const g = grab(container, 'web');
    await g.to(-300, -300);
    await settle();
    // The origin is not held exactly, yet the node is back under the stationary pointer.
    expectFollowsPointer(container, 'web', g, -300, -300);
    await g.release(-300, -300);
  });

  it('a host that does not compensate stays bounded: a held pointer settles', async () => {
    const onOriginShift = vi.fn();
    const { container, svg } = setup({ props: { onOriginShift } });
    const g = grab(container, 'web');
    await g.to(-300, -300);
    await settle();
    expect(onOriginShift).toHaveBeenCalled();
    // No real pointer events since: nothing may keep growing the frame on its own.
    const frame = svg.getAttribute('viewBox');
    await settle();
    expect(svg.getAttribute('viewBox')).toBe(frame);
    await g.release(-300, -300);
  });

  it('a re-parent drop still finds its target (ADR-99 §7)', async () => {
    let svgRef: SVGSVGElement | null = null;
    const host = scrollingHost(() => svgRef!);
    const onEdit = vi.fn();
    const { container, svg } = setup({
      source: BOUNDARY_SOURCE,
      props: { onOriginShift: host.onOriginShift, onEdit },
    });
    svgRef = svg;
    const boundary = geo.nodeScreenPos(container, 'b');
    const user = geo.nodeScreenPos(container, 'user');
    const g = grab(container, 'user');
    const dx = boundary.x + 60 - (user.x + 10);
    const dy = boundary.y + 60 - (user.y + 10);
    await g.to(dx, dy);
    await settle();
    await g.release(dx, dy);
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reparent', id: 'user', parent: 'b' }),
      expect.anything(),
    );
  });
});

describe('zoom-to-fit and the growth cap', () => {
  const NEAR_EDGE = (g: { grabAt: { x: number } }) => 790 - g.grabAt.x;

  it('a scrolling host in zoom-to-fit keeps the node under the pointer', async () => {
    let svgRef: SVGSVGElement | null = null;
    const host = scrollingHost(() => svgRef!);
    const { container, svg } = setup({ fit: true, props: { onOriginShift: host.onOriginShift } });
    svgRef = svg;
    const g = grab(container, 'web');
    await g.to(-200, -200);
    await settle();
    expectFollowsPointer(container, 'web', g, -200, -200);
    await g.to(-300, -300);
    await settle();
    expectFollowsPointer(container, 'web', g, -300, -300);
    await g.release(-300, -300);
  });

  it('reports nothing while growth is capped', async () => {
    const shifts: Shift[] = [];
    const { container } = setup({ fit: true, props: { onOriginShift: (s: Shift) => shifts.push(s) } });
    const g = grab(container, 'web');
    for (const x of [400, 600, 700]) {
      await g.to(x - g.grabAt.x, 0);
      await settle();
    }
    await g.to(NEAR_EDGE(g), 0);
    await settle();
    const count = shifts.length;
    // Pulling further out inside the margin changes nothing: the frame is held.
    await g.to(NEAR_EDGE(g), -200);
    await settle();
    await g.to(NEAR_EDGE(g), -300);
    await settle();
    expect(shifts.length).toBe(count);
    await g.release(NEAR_EDGE(g), -300);
  });
});
