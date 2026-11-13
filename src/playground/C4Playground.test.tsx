import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import C4Playground from './C4Playground';

/**
 * The playground had no tests at all while it lived as five copies in five
 * documentation sites — every behaviour here was verified by driving a browser
 * by hand. Moving it into the package is what makes them possible, so they are
 * the first thing to add.
 *
 * jsdom reports every element as 0×0 and implements no ResizeObserver, so both
 * are supplied: the fit calculation is arithmetic over measurements, and the
 * measurements are the part jsdom cannot provide.
 */

const SOURCE = 'Person(u, "You")\nSystem(a, "App")\nRel(u, a, "Uses")';

/** Pretend the pane is `paneWidth` wide and the diagram `diagramWidth` units. */
function measureAs(paneWidth: number, paneHeight: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.classList?.contains('c4-playground__canvas') ? paneWidth : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.classList?.contains('c4-playground__canvas') ? paneHeight : 0;
    },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  measureAs(0, 0);
});

/** Render fresh at a given pane size. Measurements must be in place first: the
 *  fit is computed in a layout effect, before anything is returned here. */
function renderAt(paneWidth: number, paneHeight = 10_000, props = {}) {
  cleanup();
  measureAs(paneWidth, paneHeight);
  const { container } = render(<C4Playground source={SOURCE} {...props} />);
  const svg = container.querySelector('svg')!;
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return {
    container,
    naturalWidth: svg.viewBox.baseVal.width,
    scale: Number(svg.getAttribute('width')) / svg.viewBox.baseVal.width,
    readout: button('Zoom to fit').textContent,
    zoomOut: button('Zoom out'),
    fitButton: button('Zoom to fit'),
  };
}

describe('C4Playground zoom', () => {
  it('opens at the fitted scale, reported as 100%', () => {
    const { naturalWidth } = renderAt(10_000);
    // A pane half the diagram's width fits at half scale — and still reads
    // 100%, because 100% means "the whole diagram", not one unit per pixel.
    const half = renderAt(naturalWidth / 2);
    expect(half.scale).toBeCloseTo(0.5, 2);
    expect(half.readout).toBe('100%');
  });

  it('reports 100% at two different scales, which is the point', () => {
    const { naturalWidth } = renderAt(10_000);
    const cramped = renderAt(naturalWidth / 2);
    const roomy = renderAt(naturalWidth);
    expect(cramped.scale).toBeLessThan(roomy.scale);
    // Expanding a diagram into a bigger pane is not a zoom: both views show all
    // of it, so the number must not move.
    expect(cramped.readout).toBe(roomy.readout);
  });

  it('never scales a small diagram up to fill the pane', () => {
    const { naturalWidth } = renderAt(10_000);
    // Fitting is about seeing all of it, not filling space.
    expect(renderAt(naturalWidth * 4).scale).toBeLessThanOrEqual(1);
  });

  it('cannot zoom out below the fitted view', () => {
    // Once the whole diagram is visible, smaller only buys whitespace.
    expect(renderAt(200).zoomOut.disabled).toBe(true);
  });

  it('offers no reset while already fitted', () => {
    expect(renderAt(200).fitButton.disabled).toBe(true);
  });
});

describe('C4Playground fence meta', () => {
  it('static means static: no drag control at all', () => {
    const { container } = renderAt(800, 600, { readOnly: true, editable: false });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).not.toContain('Drag to reposition');
  });

  it('readOnly hides the source pane', () => {
    const { container } = renderAt(800, 600, { readOnly: true });
    expect(container.querySelector('.c4-playground__source')).toBeNull();
  });

  it('shows the source pane otherwise', () => {
    const { container } = renderAt(800, 600);
    expect(container.querySelector('.c4-playground__source')).not.toBeNull();
  });
});

describe('C4Playground theming', () => {
  it('takes isDarkMode as a prop rather than detecting it', () => {
    // The package has no idea how a host decides what "dark" means; the
    // renderer already takes a prop for exactly this reason. Nothing here
    // consults document.documentElement.
    const { container } = renderAt(800, 600, { isDarkMode: true });
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('C4Playground structural editing', () => {
  // The reference host: it applies each reported edit to its source and stores
  // the reported positions. These drive it end to end, and they mirror the
  // worked host example in the docs ("Adding elements and relationships").
  const EDIT_SOURCE = [
    "' people",
    'Person(user, "User")',
    'System_Boundary(b, "Backend") {',
    '  Container(api, "API", "Go")',
    '}',
    'System(ext, "Ext")',
    'Rel_D(user, api, "Uses", "HTTPS")',
  ].join('\n');

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

  function setup() {
    cleanup();
    measureAs(800, 600);
    const utils = render(<C4Playground source={EDIT_SOURCE} />);
    const c = utils.container;
    const source = () => c.querySelector<HTMLTextAreaElement>('.c4-playground__source')!.value;
    const rects = () =>
      Object.fromEntries(
        Array.from(c.querySelectorAll('[data-node-id]')).map((r) => [
          r.getAttribute('data-node-id')!,
          [r.getAttribute('x'), r.getAttribute('y')],
        ]),
      );
    const add = (kind: string, at: { x: number; y: number }, label: string, target?: Element) => {
      // Right-click the canvas (the boundary's own rect when inside one), pick a kind.
      fireEvent.contextMenu(target ?? c.querySelector('svg[data-diagram]')!, { clientX: at.x, clientY: at.y });
      fireEvent.click(c.querySelector(`[data-kind="${kind}"]`)!);
      const input = c.querySelector<HTMLInputElement>('[data-c4-label-input]')!;
      fireEvent.change(input, { target: { value: label } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };
    return { c, source, rects, add };
  }

  /** `after` is `before` with exactly one line inserted: nothing else changed. */
  function insertedLine(before: string, after: string): string {
    const b = before.split('\n');
    const a = after.split('\n');
    expect(a.length).toBe(b.length + 1);
    const at = a.findIndex((line, i) => line !== b[i]);
    expect(a.filter((_, i) => i !== at)).toEqual(b);
    return a[at];
  }

  it('adds a top-level element as one inserted line, where it was placed, without moving others', () => {
    const { source, rects, add } = setup();
    const before = source();
    const rectsBefore = rects();
    add('system', { x: 900, y: 900 }, 'Billing');

    expect(insertedLine(before, source())).toBe('System(billing, "Billing")');
    const after = rects();
    for (const [id, pos] of Object.entries(rectsBefore)) expect(after[id]).toEqual(pos);
    // Placed with its centre on the tap point (240x80).
    expect(after.billing).toEqual(['780', '860']);
  });

  it('adds an element inside a boundary, indented like its sibling', () => {
    const { c, source, add } = setup();
    const before = source();
    const b = c.querySelector('[data-node-id="b"]')!;
    add('component', { x: Number(b.getAttribute('x')) + 5, y: Number(b.getAttribute('y')) + 5 }, 'Cache', b);
    expect(insertedLine(before, source())).toBe('  Component(cache, "Cache")');
    const lines = source().split('\n');
    expect(lines.indexOf('  Component(cache, "Cache")')).toBe(lines.indexOf('}') - 1);
  });

  it('adds a relationship by dragging, keeping comments and Rel_D intact', () => {
    const { c, source, rects } = setup();
    const before = source();
    const r = rects();
    const ext = c.querySelector('[data-node-id="ext"]')!;
    const target = {
      x: Number(ext.getAttribute('x')) + Number(ext.getAttribute('width')) / 2,
      y: Number(ext.getAttribute('y')) + Number(ext.getAttribute('height')) / 2,
    };
    const handle = c.querySelector('[data-connect-handle="api"]')!;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: target.x, clientY: target.y });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: target.x, clientY: target.y });
    // Nothing is inserted until the relationship is labelled.
    expect(source()).toBe(before);
    const input = c.querySelector<HTMLInputElement>('[aria-label="Relationship label"]')!;
    expect(input.value).toBe('Uses');
    fireEvent.change(input, { target: { value: 'Calls' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(insertedLine(before, source())).toBe('Rel(api, ext, "Calls")');
    expect(source()).toContain("' people");
    expect(source()).toContain('Rel_D(user, api, "Uses", "HTTPS")');
    expect(rects()).toEqual(r); // nothing moved
  });

  it('shows the reason when an edit cannot be applied, and changes nothing', () => {
    cleanup();
    measureAs(800, 600);
    const { container: c } = render(
      <C4Playground source={'System_Boundary(b, "B") { }\nPerson(p, "P")'} />,
    );
    // A single-line `{ }` boundary cannot take a pure insertion; the point is
    // inside it, so the edit is refused and the source is untouched.
    const area = c.querySelector('[data-node-id="b"]')!;
    const p = { x: Number(area.getAttribute('x')) + 5, y: Number(area.getAttribute('y')) + 5 };
    fireEvent.contextMenu(area, { clientX: p.x, clientY: p.y });
    fireEvent.click(c.querySelector('[data-kind="person"]')!);
    fireEvent.keyDown(c.querySelector('[data-c4-label-input]')!, { key: 'Enter' });
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(c.querySelector<HTMLTextAreaElement>('.c4-playground__source')!.value).toBe(
      'System_Boundary(b, "B") { }\nPerson(p, "P")',
    );
  });
});
