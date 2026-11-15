import { useLayoutEffect, useRef, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import { parseC4 } from '../core/parser';
import {
  installSvgGeometry,
  type HostLayout,
  type SvgGeometry,
  type SvgGeometryOptions,
} from './test-utils/svgGeometry';

/**
 * Geometry tests for ADR-100 as amended by #104: the SVG frame (viewBox and
 * rendered size) grows live while a node is dragged past an edge, and the diagram
 * must not move on screen under the pointer.
 *
 * At a fixed zoom the renderer holds the diagram origin still with a CSS
 * `transform: translate(...)` measured after each frame update. In zoom-to-fit the
 * scale changes live, and the pointer is mapped through the current matrix. These
 * tests use a CTM stub computed live from the rendered `<svg>` attributes, a
 * modelled host container and the CSS transform (`test-utils/svgGeometry.ts`), so
 * — unlike an identity stub — they fail if the content moves on screen.
 */

// Top-level leaves only: the layout's overlap resolution pushes a leaf that a
// growing *boundary* runs into, which is layout behaviour and not what these
// tests are about. Leaf-over-leaf overlap is left alone, so nothing but the
// dragged node moves.
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

const CENTRED: HostLayout = { mode: 'centred', paneWidth: 1400, paneHeight: 1000 };
const CENTRED_X: HostLayout = { mode: 'centred-x', paneWidth: 1400 };
let geo: SvgGeometry;

afterEach(() => geo?.restore());

const flush = (ms = 40) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** Lets a fit-mode remap converge: each pass takes an animation frame. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};

type Positions = Record<string, { x: number; y: number }>;
type Size = { width: number; height: number };

const PANE = { width: 800, height: 700 };

/**
 * A zoom-to-fit host like the playground's: the zoom is `min(1, pane / frame)`,
 * re-measured from the `onFrameChange` callback, which fires in the layout phase.
 */
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

/**
 * Stands in for a real host, which persists the reported positions and passes
 * them back as `manualPositions`. Without that round trip an empty
 * `manualPositions` reads as "reset to auto layout" and drops the drag.
 */
function Host({
  source,
  onReport,
  fit,
  ...rest
}: { source: string; onReport: (p: Positions) => void; fit?: boolean } & Record<string, unknown>) {
  const [manual, setManual] = useState<Positions>({});
  const [diagram] = useState(() => parseC4(source).diagram!);
  const renderer = (extra: Record<string, unknown>) => (
    <C4InteractiveRenderer
      diagram={diagram}
      isDarkMode={false}
      isEditMode
      manualPositions={manual}
      onPositionChange={(p: Positions) => {
        onReport(p);
        setManual(p);
      }}
      {...rest}
      {...extra}
    />
  );
  if (!fit) return renderer({});
  return <FitHost>{(zoom, onFrameChange) => renderer({ zoom, onFrameChange })}</FitHost>;
}

interface SetupOptions {
  overrides?: Record<string, unknown>;
  source?: string;
  geoOptions?: SvgGeometryOptions;
}

function setup(host: HostLayout, { overrides = {}, source = SOURCE, geoOptions }: SetupOptions = {}) {
  geo = installSvgGeometry(host, geoOptions);
  const onPositionChange = vi.fn();
  const utils = render(<Host source={source} onReport={onPositionChange} {...overrides} />);
  const container = utils.container;
  // The scroll container the growth cap measures: the pane of a real host.
  container.style.overflow = 'auto';
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: PANE.width, bottom: PANE.height, width: PANE.width, height: PANE.height }) as DOMRect;
  const svg = container.querySelector('svg')!;
  const frame = () => ({
    viewBox: svg.getAttribute('viewBox'),
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
  });
  const setZoom = (zoom: number) =>
    utils.rerender(<Host source={source} onReport={onPositionChange} {...overrides} zoom={zoom} />);
  return { ...utils, svg, frame, onPositionChange, setZoom };
}

const hit = (c: HTMLElement, id: string) => c.querySelector(`[data-node-id="${id}"]`)!;

/** Press `id` 10 px inside its top-left corner; returns helpers to move/release. */
function grab(c: HTMLElement, id: string, extra: Record<string, unknown> = {}) {
  const start = geo.nodeScreenPos(c, id);
  const grabAt = { x: start.x + 10, y: start.y + 10 };
  const svg = c.querySelector('svg') as unknown as SVGSVGElement;
  // The grab point's offset inside the node, in SVG units: fixed for the drag.
  const offsetSvg = 10 / geo.ctm(svg).a;
  fireEvent.pointerDown(hit(c, id), { pointerId: 1, clientX: grabAt.x, clientY: grabAt.y, ...extra });
  const to = async (dx: number, dy: number) => {
    fireEvent.pointerMove(window, { pointerId: 1, clientX: grabAt.x + dx, clientY: grabAt.y + dy, ...extra });
    await flush();
  };
  const release = async (dx: number, dy: number) => {
    fireEvent.pointerUp(window, { pointerId: 1, clientX: grabAt.x + dx, clientY: grabAt.y + dy, ...extra });
    await flush();
  };
  return { start, grabAt, offsetSvg, to, release };
}

/** The dragged node's screen position must equal `start + delta` (within 1px). */
function expectUnderPointer(c: HTMLElement, id: string, start: { x: number; y: number }, dx: number, dy: number) {
  const now = geo.nodeScreenPos(c, id);
  expect(Math.abs(now.x - (start.x + dx))).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - (start.y + dy))).toBeLessThanOrEqual(1);
}

/**
 * For a changing scale: the point of the node that was grabbed (a fixed offset in
 * SVG units, drawn at the *current* scale) is within 1px of the pointer.
 */
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

function expectOthersStill(
  c: HTMLElement,
  before: Record<string, { x: number; y: number }>,
  moving: string[],
) {
  const now = geo.allScreenPositions(c);
  for (const [id, pos] of Object.entries(before)) {
    if (moving.includes(id)) continue;
    expect(Math.abs(now[id].x - pos.x), `${id} x`).toBeLessThanOrEqual(1);
    expect(Math.abs(now[id].y - pos.y), `${id} y`).toBeLessThanOrEqual(1);
  }
}

const vbSize = (f: { viewBox: string | null }) => {
  const [, , w, h] = f.viewBox!.split(' ').map(Number);
  return { w, h };
};

describe.each<[string, HostLayout, SvgGeometryOptions?]>([
  ['centred pane (both axes)', CENTRED],
  ['playground: centred horizontally, top-pinned', CENTRED_X],
  ['top-left host', { mode: 'top-left' }],
  ['pre-scrolled top-left host', { mode: 'top-left', scrollLeft: 30, scrollTop: 45 }],
  ['an engine whose getScreenCTM ignores the transform', CENTRED_X, { ctmIncludesTransform: false }],
])('live growth at 100%% zoom — %s', (_name, host, geoOptions) => {
  it.each([
    ['up', 0, -400],
    ['left', -400, 0],
    ['right', 700, 0],
    ['down', 0, 700],
    ['diagonally up-left', -400, -400],
    ['diagonally down-right', 700, 700],
  ])('keeps the node under the pointer and other nodes still: %s', async (_d, dx, dy) => {
    const { container, frame } = setup(host, { geoOptions });
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web');

    for (const f of [0.1, 0.25, 0.5, 0.75, 1]) {
      await g.to(dx * f, dy * f);
      expectUnderPointer(container, 'web', g.start, dx * f, dy * f);
      expectOthersStill(container, before, ['web']);
    }
    // The frame grew during the drag, not only on release.
    expect(frame()).not.toEqual(frameBefore);
    const grown = vbSize(frame());
    const was = vbSize(frameBefore);
    expect(grown.w * grown.h).toBeGreaterThan(was.w * was.h);
    await g.release(dx, dy);
  });
});

describe('growth and the compensation', () => {
  it('right growth under horizontal centring does not shift the content left', async () => {
    const { container, svg } = setup(CENTRED_X);
    const before = geo.allScreenPositions(container);
    const g = grab(container, 'web');
    await g.to(700, 0);
    // The centring shift is real (the SVG's own box moved) and is cancelled.
    expect(geo.transformOf(svg).x).toBeGreaterThan(0);
    expectOthersStill(container, before, ['web']);
    await g.release(700, 0);
  });

  it('a held pointer gives a stable position and frame', async () => {
    const { container, frame } = setup(CENTRED_X);
    const g = grab(container, 'web');
    await g.to(-300, -300);
    const first = geo.nodeScreenPos(container, 'web');
    const grown = frame();
    for (let i = 0; i < 5; i++) {
      await g.to(-300, -300);
      expect(geo.nodeScreenPos(container, 'web')).toEqual(first);
      expect(frame()).toEqual(grown);
    }
    await g.release(-300, -300);
  });

  it('does not oscillate crossing the original edge back and forth', async () => {
    const { container } = setup(CENTRED_X);
    const g = grab(container, 'web');
    for (const dy of [-50, -400, -50, -400, 100, -400]) {
      await g.to(0, dy);
      expectUnderPointer(container, 'web', g.start, 0, dy);
    }
    await g.release(0, -400);
  });

  it('the frame shrinks back live when the node is dragged back inside', async () => {
    const { container, frame, svg } = setup(CENTRED_X);
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(-400, -400);
    expect(frame()).not.toEqual(frameBefore);
    await g.to(0, 0);
    expect(frame()).toEqual(frameBefore);
    expect(geo.transformOf(svg)).toEqual({ x: 0, y: 0 });
    await g.release(0, 0);
  });
});

describe('release', () => {
  it('drops the transform and keeps the grown frame', async () => {
    const { container, svg, frame } = setup(CENTRED_X);
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(-400, -400);
    const during = frame();
    expect(svg.style.transform).not.toBe('');

    await g.release(-400, -400);
    expect(svg.style.transform).toBe('');
    const after = frame();
    expect(after).not.toEqual(frameBefore);
    expect(after).toEqual(during);
    const [vx, vy] = after.viewBox!.split(' ').map(Number);
    expect(vx).toBeLessThan(0);
    expect(vy).toBeLessThan(0);
    await flush();
    expect(frame()).toEqual(after);
    expect(svg.style.overflow).not.toBe('visible');
  });

  it('draws past the frame (overflow visible) only while dragging', async () => {
    const { container, svg } = setup(CENTRED_X);
    const g = grab(container, 'web');
    await g.to(-400, -400);
    expect(svg.style.overflow).toBe('visible');
    await g.release(-400, -400);
    expect(svg.style.overflow).not.toBe('visible');
  });

  it('a press and release without moving leaves everything where it was', async () => {
    const { container, svg, frame } = setup(CENTRED_X, { source: BOUNDARY_SOURCE });
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'b');
    await g.release(0, 0);
    expectOthersStill(container, before, []);
    expect(frame()).toEqual(frameBefore);
    expect(svg.style.transform).toBe('');
  });
});

describe('cancel (when editing)', () => {
  it.each([
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['pointercancel', () => fireEvent.pointerCancel(window, { pointerId: 1 })],
  ])('%s restores the pre-drag frame and removes the transform', async (_n, cancel) => {
    const onEdit = vi.fn();
    const { container, svg, frame, onPositionChange } = setup(CENTRED_X, { overrides: { onEdit } });
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(-400, -400);
    await g.to(700, 700);
    expect(frame()).not.toEqual(frameBefore);
    expect(svg.style.transform).not.toBe('');

    cancel();
    await flush();
    expect(frame()).toEqual(frameBefore);
    expect(svg.style.transform).toBe('');
    expect(svg.style.overflow).not.toBe('visible');
    expectOthersStill(container, before, []);
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('without editing, pointercancel is a drag end: the transform is gone and the frame is final', async () => {
    const { container, svg, frame } = setup(CENTRED_X);
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(-400, -400);
    expect(svg.style.transform).not.toBe('');
    fireEvent.pointerCancel(window, { pointerId: 1 });
    await flush();
    expect(svg.style.transform).toBe('');
    expect(frame()).not.toEqual(frameBefore);
  });
});

describe('zoom', () => {
  it.each([0.5, 2])('keeps the node under the pointer at zoom %s', async (zoom) => {
    const { container, frame } = setup(CENTRED_X, { overrides: { zoom } });
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web');
    for (const f of [0.5, 1]) {
      // A screen delta of 300px is 300/zoom SVG units.
      await g.to(-300 * f, -300 * f);
      expectUnderPointer(container, 'web', g.start, -300 * f, -300 * f);
      expectOthersStill(container, before, ['web']);
    }
    expect(frame()).not.toEqual(frameBefore);
    await g.release(-300, -300);
  });

  it('follows a zoom change mid-drag: the node comes back under the pointer', async () => {
    const { container, setZoom } = setup(CENTRED_X, { overrides: { zoom: 1 } });
    const g = grab(container, 'web');
    await g.to(-100, -100);
    setZoom(2);
    await settle();
    expectFollowsPointer(container, 'web', g, -100, -100);
    await g.release(-100, -100);
  });
});

describe('zoom-to-fit: the scale changes live', () => {
  const FIT_HOST: HostLayout = { mode: 'top-left' };
  const fitSetup = (extra: SetupOptions = {}) =>
    setup(FIT_HOST, { ...extra, overrides: { fit: true, ...extra.overrides } });
  const scaleOf = (svg: SVGSVGElement) => geo.ctm(svg).a;

  it('keeps the dragged node under the pointer on every move while the scale changes', async () => {
    const { container, svg } = fitSetup();
    const g = grab(container, 'web');
    const scales = new Set<number>([scaleOf(svg)]);
    for (const dx of [50, 120, 200, 280, 340]) {
      await g.to(dx, dx / 2);
      await settle();
      scales.add(scaleOf(svg));
      expectFollowsPointer(container, 'web', g, dx, dx / 2);
    }
    // The scale really did change: otherwise this tests nothing.
    expect(scales.size).toBeGreaterThan(1);
    await g.release(340, 170);
  });

  it('works for a boundary and its children', async () => {
    const { container, svg } = fitSetup({ source: BOUNDARY_SOURCE });
    const g = grab(container, 'b');
    const a0 = scaleOf(svg);
    await g.to(250, 150);
    await settle();
    expectFollowsPointer(container, 'b', g, 250, 150);
    expect(scaleOf(svg)).not.toBeCloseTo(a0, 4);
    await g.release(250, 150);
  });

  it('a re-parent drop still finds its target (ADR-99 §7)', async () => {
    const onEdit = vi.fn();
    const { container } = fitSetup({ source: BOUNDARY_SOURCE, overrides: { onEdit } });
    const boundary = geo.nodeScreenPos(container, 'b');
    const user = geo.nodeScreenPos(container, 'user');
    const g = grab(container, 'user');
    // Release well inside the boundary, in the screen space of the drag.
    const dx = boundary.x + 60 - (user.x + 10);
    const dy = boundary.y + 60 - (user.y + 10);
    await g.to(dx, dy);
    await settle();
    await g.release(dx, dy);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reparent', id: 'user', parent: 'b' }), expect.anything());
  });

  describe('the feedback cap', () => {
    // The pane is 800px wide and the margin 48px: a pointer past x=752 is capped.
    const NEAR_EDGE = (g: { grabAt: { x: number } }) => 790 - g.grabAt.x;

    it('growth is bounded and settles with the pointer near the container edge', async () => {
      const { container, svg, frame } = fitSetup();
      const g = grab(container, 'web');
      // Approach the edge from inside first, as a user would.
      for (const x of [400, 600, 700]) {
        await g.to(x - g.grabAt.x, 0);
        await settle();
      }
      const frames: string[] = [];
      const scales: number[] = [];
      for (let i = 0; i < 10; i++) {
        await g.to(NEAR_EDGE(g), 0);
        await settle();
        frames.push(JSON.stringify(frame()));
        scales.push(scaleOf(svg));
        // The node still follows the pointer while growth is paused.
        expectFollowsPointer(container, 'web', g, NEAR_EDGE(g), 0);
      }
      // Settled: the last held moves change nothing.
      expect(new Set(frames.slice(-5)).size).toBe(1);
      expect(new Set(scales.slice(-5).map((v) => v.toFixed(6))).size).toBe(1);
      // No runaway: the scale stays well above zero.
      expect(Math.min(...scales)).toBeGreaterThan(0.2);
      await g.release(NEAR_EDGE(g), 0);
    });

    it('growth resumes once the pointer is back outside the margin', async () => {
      const { container, svg, frame } = fitSetup();
      const g = grab(container, 'web');
      for (const x of [400, 600, 700]) {
        await g.to(x - g.grabAt.x, 0);
        await settle();
      }
      for (let i = 0; i < 3; i++) {
        await g.to(NEAR_EDGE(g), 0);
        await settle();
      }
      const paused = frame();
      // Back inside the pane, and further down: the frame grows again.
      await g.to(600 - g.grabAt.x, 600 - g.grabAt.y);
      await settle();
      expect(frame()).not.toEqual(paused);
      expectFollowsPointer(container, 'web', g, 600 - g.grabAt.x, 600 - g.grabAt.y);
      expect(scaleOf(svg)).toBeGreaterThan(0.2);
      await g.release(600 - g.grabAt.x, 600 - g.grabAt.y);
    });

    it('a held pointer outside the pane stays bounded too', async () => {
      const { container, svg } = fitSetup();
      const g = grab(container, 'web');
      for (const x of [400, 700]) {
        await g.to(x - g.grabAt.x, 0);
        await settle();
      }
      for (let i = 0; i < 6; i++) {
        await g.to(1200 - g.grabAt.x, 0);
        await settle();
      }
      expect(scaleOf(svg)).toBeGreaterThan(0.2);
      await g.release(1200 - g.grabAt.x, 0);
    });

    it('release and cancel clear the pause and the transform', async () => {
      const onEdit = vi.fn();
      const { container, svg, frame } = fitSetup({ overrides: { onEdit } });
      const frameBefore = frame();
      const g = grab(container, 'web');
      for (const x of [400, 700, 790]) {
        await g.to(x - g.grabAt.x, 0);
        await settle();
      }
      fireEvent.keyDown(window, { key: 'Escape' });
      await settle();
      expect(svg.style.transform).toBe('');
      expect(frame()).toEqual(frameBefore);
    });
  });
});

describe('other drags', () => {
  it('a boundary drags with its children, staying under the pointer', async () => {
    const { container, frame } = setup(CENTRED_X, { source: BOUNDARY_SOURCE });
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'b');
    await g.to(-300, -500);
    expectUnderPointer(container, 'b', g.start, -300, -500);
    for (const child of ['web', 'api']) {
      const now = geo.nodeScreenPos(container, child);
      expect(Math.abs(now.x - (before[child].x - 300))).toBeLessThanOrEqual(1);
      expect(Math.abs(now.y - (before[child].y - 500))).toBeLessThanOrEqual(1);
    }
    expectOthersStill(container, before, ['b', 'web', 'api']);
    expect(frame()).not.toEqual(frameBefore);
    await g.release(-300, -500);
  });

  it('touch behaves the same as mouse', async () => {
    const { container, frame } = setup(CENTRED_X);
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web', { pointerType: 'touch' });
    await g.to(-300, -400);
    expectUnderPointer(container, 'web', g.start, -300, -400);
    expectOthersStill(container, before, ['web']);
    expect(frame()).not.toEqual(frameBefore);
    await g.release(-300, -400);
  });
});
