import { describe, it, expect } from 'vitest';
import { parseC4 } from '../core/parser';
import { layoutC4Diagram } from '../core/layout';
import { findBoundaryAt, findElementAt } from './hit-test';

const SRC = `Person(u, "U")
System_Boundary(outer, "Outer") {
  Container_Boundary(inner, "Inner") {
    Component(c, "C")
  }
  Container(d, "D")
}`;

function nodes() {
  return layoutC4Diagram(parseC4(SRC).diagram!).nodes;
}
const centre = (n: { x: number; y: number; width: number; height: number }) => ({
  x: n.x + n.width / 2,
  y: n.y + n.height / 2,
});

describe('hit-test', () => {
  it('finds the deepest non-boundary node, never a boundary', () => {
    const ns = nodes();
    const c = ns.find((n) => n.id === 'c')!;
    expect(findElementAt(ns, centre(c))?.id).toBe('c');
    const inner = ns.find((n) => n.id === 'inner')!;
    // The corner of a boundary is boundary-only: no element target there.
    expect(findElementAt(ns, { x: inner.x + 2, y: inner.y + 2 })).toBeNull();
  });

  it('finds the deepest boundary containing a point', () => {
    const ns = nodes();
    const c = ns.find((n) => n.id === 'c')!;
    expect(findBoundaryAt(ns, centre(c))?.id).toBe('inner');
    const d = ns.find((n) => n.id === 'd')!;
    expect(findBoundaryAt(ns, centre(d))?.id).toBe('outer');
  });

  it('returns null for empty canvas and for a point outside every boundary', () => {
    const ns = nodes();
    expect(findElementAt(ns, { x: -5000, y: -5000 })).toBeNull();
    expect(findBoundaryAt(ns, { x: -5000, y: -5000 })).toBeNull();
    const u = ns.find((n) => n.id === 'u')!;
    expect(findBoundaryAt(ns, centre(u))).toBeNull();
    expect(findElementAt(ns, centre(u))?.id).toBe('u');
  });

  describe('empty boundaries', () => {
    const EMPTY_SRC = `System_Boundary(outer, "Outer") {
  Container_Boundary(inner, "Inner") {
  }
}
Boundary(lone, "Lone") {
}
Person(u, "U")`;
    const emptyNodes = (positions?: Record<string, { x: number; y: number }>) =>
      layoutC4Diagram(parseC4(EMPTY_SRC).diagram!, undefined, positions).nodes;

    it('an empty boundary is a click target', () => {
      const ns = emptyNodes();
      const lone = ns.find((n) => n.id === 'lone')!;
      expect(findBoundaryAt(ns, centre(lone))?.id).toBe('lone');
      expect(findElementAt(ns, centre(lone))).toBeNull();
    });

    it('prefers the innermost of nested boundaries, even when the inner one is empty', () => {
      for (const ns of [emptyNodes(), emptyNodes({ outer: { x: 50, y: 50 }, inner: { x: 90, y: 105 } })]) {
        const inner = ns.find((n) => n.id === 'inner')!;
        expect(findBoundaryAt(ns, centre(inner))?.id).toBe('inner');
        // Inside the outer box but outside the inner one: the outer wins.
        const outer = ns.find((n) => n.id === 'outer')!;
        expect(findBoundaryAt(ns, { x: outer.x + 3, y: outer.y + 3 })?.id).toBe('outer');
      }
    });

    it('does not claim a point on an element', () => {
      const ns = emptyNodes();
      const u = ns.find((n) => n.id === 'u')!;
      expect(findBoundaryAt(ns, centre(u))).toBeNull();
    });
  });
});
