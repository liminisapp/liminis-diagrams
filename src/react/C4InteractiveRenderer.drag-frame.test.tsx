import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { C4InteractiveRenderer } from './C4InteractiveRenderer';
import { parseC4 } from '../core/parser';
import { installSvgGeometry, type HostLayout, type SvgGeometry } from './test-utils/svgGeometry';

/**
 * Regression tests for issue #100 (ADR-100): dragging a node past the top or
 * left edge must keep it under the pointer and must not move any other node.
 *
 * The SVG's frame (viewBox + rendered size) is frozen for the whole drag and
 * recomputed once on release. These tests use a CTM stub that is computed live
 * from the rendered `<svg>` attributes and a modelled host container
 * (`test-utils/svgGeometry.ts`), so — unlike an identity stub — they fail if the
 * frame changes mid-drag in a centring pane.
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
let geo: SvgGeometry;

afterEach(() => geo?.restore());

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });

type Positions = Record<string, { x: number; y: number }>;

/**
 * Stands in for a real host, which persists the reported positions and passes
 * them back as `manualPositions`. Without that round trip an empty
 * `manualPositions` reads as "reset to auto layout" and drops the drag.
 */
function Host({
  source,
  onReport,
  ...rest
}: { source: string; onReport: (p: Positions) => void } & Record<string, unknown>) {
  const [manual, setManual] = useState<Positions>({});
  const [diagram] = useState(() => parseC4(source).diagram!);
  return (
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
    />
  );
}

function setup(host: HostLayout, overrides: Record<string, unknown> = {}, source = SOURCE) {
  geo = installSvgGeometry(host);
  const onPositionChange = vi.fn();
  const utils = render(<Host source={source} onReport={onPositionChange} {...overrides} />);
  const container = utils.container;
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
  fireEvent.pointerDown(hit(c, id), { pointerId: 1, clientX: grabAt.x, clientY: grabAt.y, ...extra });
  const to = async (dx: number, dy: number) => {
    fireEvent.pointerMove(window, { pointerId: 1, clientX: grabAt.x + dx, clientY: grabAt.y + dy, ...extra });
    await flush();
  };
  const release = async (dx: number, dy: number) => {
    fireEvent.pointerUp(window, { pointerId: 1, clientX: grabAt.x + dx, clientY: grabAt.y + dy, ...extra });
    await flush();
  };
  return { start, grabAt, to, release };
}

/** The dragged node's screen position must equal `start + delta` (within 1px). */
function expectUnderPointer(c: HTMLElement, id: string, start: { x: number; y: number }, dx: number, dy: number) {
  const now = geo.nodeScreenPos(c, id);
  expect(Math.abs(now.x - (start.x + dx))).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - (start.y + dy))).toBeLessThanOrEqual(1);
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

describe.each<[string, HostLayout]>([
  ['centred pane (playground before #100)', CENTRED],
  ['top-left host', { mode: 'top-left' }],
  ['pre-scrolled top-left host', { mode: 'top-left', scrollLeft: 30, scrollTop: 45 }],
])('dragging past the top-left edge — %s', (_name, host) => {
  it.each([
    ['up', 0, -400],
    ['left', -400, 0],
    ['diagonally up-left', -400, -400],
  ])('keeps the node under the pointer and other nodes still: %s', async (_d, dx, dy) => {
    const { container, frame } = setup(host);
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web');

    for (const f of [0.1, 0.25, 0.5, 0.75, 1]) {
      await g.to(dx * f, dy * f);
      expectUnderPointer(container, 'web', g.start, dx * f, dy * f);
      expectOthersStill(container, before, ['web']);
      // The frame is frozen for the whole drag.
      expect(frame()).toEqual(frameBefore);
    }
    await g.release(dx, dy);
  });
});

describe('feedback loop (FR-007 / FR-012)', () => {
  it('a held pointer gives a stable position and a frozen frame', async () => {
    const { container, frame } = setup(CENTRED);
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(-300, -300);
    const first = geo.nodeScreenPos(container, 'web');
    for (let i = 0; i < 5; i++) {
      await g.to(-300, -300);
      const now = geo.nodeScreenPos(container, 'web');
      expect(now).toEqual(first);
      expect(frame()).toEqual(frameBefore);
    }
    await g.release(-300, -300);
  });

  it('does not oscillate crossing the original edge back and forth', async () => {
    const { container, frame } = setup(CENTRED);
    const frameBefore = frame();
    const g = grab(container, 'web');
    for (const dy of [-50, -400, -50, -400, 100, -400]) {
      await g.to(0, dy);
      expectUnderPointer(container, 'web', g.start, 0, dy);
      expect(frame()).toEqual(frameBefore);
    }
    await g.release(0, -400);
  });
});

describe('release (FR-009)', () => {
  it('recomputes the frame once, to contain the dragged node', async () => {
    const { container, svg, frame } = setup(CENTRED);
    const frameBefore = frame();
    const g = grab(container, 'web');
    const seen = new Set<string>();
    for (const f of [0.25, 0.5, 1]) {
      await g.to(-400 * f, -400 * f);
      seen.add(JSON.stringify(frame()));
    }
    expect(seen).toEqual(new Set([JSON.stringify(frameBefore)]));

    await g.release(-400, -400);
    const after = frame();
    expect(after).not.toEqual(frameBefore);
    const [vx, vy] = after.viewBox!.split(' ').map(Number);
    expect(vx).toBeLessThan(0);
    expect(vy).toBeLessThan(0);
    // No further change once the drag is over.
    await flush();
    expect(frame()).toEqual(after);
    expect(svg.style.overflow).not.toBe('visible');
  });

  it('draws the dragged node past the frozen edges (overflow visible) only while dragging', async () => {
    const { container, svg } = setup(CENTRED);
    const g = grab(container, 'web');
    await g.to(-400, -400);
    expect(svg.style.overflow).toBe('visible');
    await g.release(-400, -400);
    expect(svg.style.overflow).not.toBe('visible');
  });

  it('shrinks back once when dragged back to the interior before release', async () => {
    const { container, frame } = setup(CENTRED);
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(-400, -400);
    await g.to(0, 0);
    await g.release(0, 0);
    expect(frame()).toEqual(frameBefore);
  });

  it('thaws on pointercancel', async () => {
    const { container, svg, frame } = setup(CENTRED);
    const g = grab(container, 'web');
    await g.to(-400, -400);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    await flush();
    expect(svg.style.overflow).not.toBe('visible');
    const [vx, vy] = frame().viewBox!.split(' ').map(Number);
    // Consistent with the node's final position, which is outside the old bounds.
    expect(Math.min(vx, vy)).toBeLessThanOrEqual(0);
  });
});

describe('zoom (FR-005)', () => {
  it.each([0.5, 2])('keeps the node under the pointer at zoom %s', async (zoom) => {
    const { container, frame } = setup(CENTRED, { zoom });
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web');
    for (const f of [0.5, 1]) {
      // A screen delta of 300px is 300/zoom SVG units.
      await g.to(-300 * f, -300 * f);
      expectUnderPointer(container, 'web', g.start, -300 * f, -300 * f);
      expectOthersStill(container, before, ['web']);
      expect(frame()).toEqual(frameBefore);
    }
    await g.release(-300, -300);
  });

  it('ignores a zoom change mid-drag until release', async () => {
    const { container, frame, setZoom } = setup(CENTRED, { zoom: 1 });
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(-100, -100);
    setZoom(2);
    expect(frame()).toEqual(frameBefore);
    await g.release(-100, -100);
    expect(frame().width).not.toBe(frameBefore.width);
  });
});

describe('other drags', () => {
  it('a boundary drags with its children, staying under the pointer', async () => {
    const { container, frame } = setup(CENTRED, {}, BOUNDARY_SOURCE);
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
    expect(frame()).toEqual(frameBefore);
    await g.release(-300, -500);
  });

  it('keeps working past the bottom and right edges', async () => {
    const { container, frame } = setup(CENTRED);
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web');
    await g.to(700, 700);
    expectUnderPointer(container, 'web', g.start, 700, 700);
    expectOthersStill(container, before, ['web']);
    expect(frame()).toEqual(frameBefore);
    await g.release(700, 700);
    // The canvas grows once on release.
    const [, , w, h] = frame().viewBox!.split(' ').map(Number);
    const [, , w0, h0] = frameBefore.viewBox!.split(' ').map(Number);
    expect(w).toBeGreaterThan(w0);
    expect(h).toBeGreaterThan(h0);
  });

  it('touch behaves the same as mouse', async () => {
    const { container, frame } = setup(CENTRED);
    const before = geo.allScreenPositions(container);
    const frameBefore = frame();
    const g = grab(container, 'web', { pointerType: 'touch' });
    await g.to(-300, -400);
    expectUnderPointer(container, 'web', g.start, -300, -400);
    expectOthersStill(container, before, ['web']);
    expect(frame()).toEqual(frameBefore);
    await g.release(-300, -400);
  });
});
