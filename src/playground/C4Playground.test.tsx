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
    const addBoundary = (kind: string, at: { x: number; y: number }, label: string, target?: Element) => {
      fireEvent.contextMenu(target ?? c.querySelector('svg[data-diagram]')!, { clientX: at.x, clientY: at.y });
      fireEvent.click(c.querySelector(`[data-boundary-kind="${kind}"]`)!);
      const input = c.querySelector<HTMLInputElement>('[data-c4-label-input]')!;
      fireEvent.change(input, { target: { value: label } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };
    return { c, source, rects, add, addBoundary };
  }

  /** `after` is `before` with exactly one contiguous block of two lines inserted: nothing else changed. */
  function insertedBlock(before: string, after: string): string[] {
    const b = before.split('\n');
    const a = after.split('\n');
    expect(a.length).toBe(b.length + 2);
    const at = a.findIndex((line, i) => line !== b[i]);
    expect(a.filter((_, i) => i < at || i >= at + 2)).toEqual(b);
    return a.slice(at, at + 2);
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

  it('adds a top-level boundary as one two-line block, where it was placed, without moving others', () => {
    const { source, rects, addBoundary } = setup();
    const before = source();
    const rectsBefore = rects();
    addBoundary('containerBoundary', { x: 900, y: 900 }, 'API Application');

    expect(insertedBlock(before, source())).toEqual(['Container_Boundary(api_application, "API Application") {', '}']);
    const after = rects();
    for (const [id, pos] of Object.entries(rectsBefore)) expect(after[id]).toEqual(pos);
    // Centred on the tap point (240x160 empty boundary).
    expect(after.api_application).toEqual(['780', '820']);
  });

  it('adds a boundary, then an element inside it, with the existing flow', () => {
    const { c, source, add, addBoundary } = setup();
    addBoundary('systemBoundary', { x: 900, y: 900 }, 'Billing');
    const box = c.querySelector('[data-node-id="billing"]')!;
    expect(Number(box.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(box.getAttribute('height'))).toBeGreaterThan(0);

    const before = source();
    const x = Number(box.getAttribute('x')) + Number(box.getAttribute('width')) / 2;
    const y = Number(box.getAttribute('y')) + Number(box.getAttribute('height')) / 2;
    add('component', { x, y }, 'Invoice', box);
    expect(insertedLine(before, source())).toBe('  Component(invoice, "Invoice")');
    const lines = source().split('\n');
    const open = lines.indexOf('System_Boundary(billing, "Billing") {');
    expect(open).toBeGreaterThan(-1);
    expect(lines[open + 1]).toBe('  Component(invoice, "Invoice")');
    expect(lines[open + 2]).toBe('}');
  });

  it('adds a boundary inside a boundary, indented like its sibling', () => {
    const { c, source, addBoundary } = setup();
    const before = source();
    const b = c.querySelector('[data-node-id="b"]')!;
    addBoundary(
      'containerBoundary',
      { x: Number(b.getAttribute('x')) + Number(b.getAttribute('width')) - 10, y: Number(b.getAttribute('y')) + Number(b.getAttribute('height')) - 10 },
      'Inner',
      b,
    );
    expect(insertedBlock(before, source())).toEqual(['  Container_Boundary(inner, "Inner") {', '  }']);
  });

  it('renders a hand-written empty boundary as a box that accepts children', () => {
    cleanup();
    measureAs(800, 600);
    const { container: c } = render(<C4Playground source={'Boundary(lone, "Lone") {\n}\nPerson(p, "P")'} />);
    const box = c.querySelector('[data-node-id="lone"]')!;
    expect(Number(box.getAttribute('height'))).toBeGreaterThan(55);
    const x = Number(box.getAttribute('x')) + 20;
    const y = Number(box.getAttribute('y')) + Number(box.getAttribute('height')) - 20;
    fireEvent.contextMenu(box, { clientX: x, clientY: y });
    fireEvent.click(c.querySelector('[data-kind="system"]')!);
    fireEvent.keyDown(c.querySelector('[data-c4-label-input]')!, { key: 'Enter' });
    const text = c.querySelector<HTMLTextAreaElement>('.c4-playground__source')!.value;
    expect(text.split('\n').slice(0, 3)).toEqual(['Boundary(lone, "Lone") {', '  System(system, "System")', '}']);
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

  /** The lines of `before` and `after` that differ; they must be the same length. */
  function changedLines(before: string, after: string): [string, string][] {
    const b = before.split('\n');
    const a = after.split('\n');
    expect(a.length).toBe(b.length);
    return b.flatMap((line, i): [string, string][] => (line === a[i] ? [] : [[line, a[i]]]));
  }

  it('renames an element by double-click: one line, only the label, position kept', () => {
    const { c, source, rects } = setup();
    const before = source();
    const rectsBefore = rects();
    fireEvent.doubleClick(c.querySelector('[data-node-id="api"]')!);
    const input = c.querySelector<HTMLInputElement>('[data-c4-label-input]')!;
    expect(input.value).toBe('API');
    fireEvent.change(input, { target: { value: 'Gateway' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(changedLines(before, source())).toEqual([
      ['  Container(api, "API", "Go")', '  Container(api, "Gateway", "Go")'],
    ]);
    // Text and positions arrive in one update: nothing moved, and the new label is drawn.
    expect(rects()).toEqual(rectsBefore);
    expect(c.querySelector('svg')!.textContent).toContain('Gateway');
  });

  it('renames a relationship by double-click, keeping its direction variant and technology', () => {
    const { c, source, rects } = setup();
    const before = source();
    const rectsBefore = rects();
    fireEvent.doubleClick(c.querySelector('[data-rel-index="0"]')!);
    const input = c.querySelector<HTMLInputElement>('[aria-label="Relationship label"]')!;
    expect(input.value).toBe('Uses'); // not "Uses [HTTPS]"
    fireEvent.change(input, { target: { value: 'Calls' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(changedLines(before, source())).toEqual([
      ['Rel_D(user, api, "Uses", "HTTPS")', 'Rel_D(user, api, "Calls", "HTTPS")'],
    ]);
    expect(source()).toContain("' people");
    expect(rects()).toEqual(rectsBefore);
    expect(c.querySelector('svg')!.textContent).toContain('Calls');
  });

  it('renames twice in a row: the second edit is built from the updated source', () => {
    const { c, source } = setup();
    for (const label of ['One', 'Two']) {
      fireEvent.doubleClick(c.querySelector('[data-rel-index="0"]')!);
      const input = c.querySelector<HTMLInputElement>('[aria-label="Relationship label"]')!;
      fireEvent.change(input, { target: { value: label } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(source()).toContain('Rel_D(user, api, "Two", "HTTPS")');
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
