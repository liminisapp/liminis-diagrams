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
});
