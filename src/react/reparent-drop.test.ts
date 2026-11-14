import { describe, it, expect } from 'vitest';
import { parseC4 } from '../core/parser';
import { BOUNDARY_HEADER_HEIGHT, BOUNDARY_PADDING, layoutC4Diagram } from '../core/layout';
import { clampIntoBoundary, decideReparent, findDropTarget, subtreeIds } from './reparent-drop';

const SRC = `Person(u, "U")
System_Boundary(outer, "Outer") {
  Container_Boundary(inner, "Inner") {
    Component(c, "C")
  }
  Container(d, "D")
}
System_Boundary(other, "Other") {
  Container(e, "E")
}`;

const nodes = () => layoutC4Diagram(parseC4(SRC).diagram!).nodes;
const get = (ns: ReturnType<typeof nodes>, id: string) => ns.find((n) => n.id === id)!;
const centre = (n: { x: number; y: number; width: number; height: number }) => ({
  x: n.x + n.width / 2,
  y: n.y + n.height / 2,
});

describe('subtreeIds', () => {
  it('includes the root and every descendant, nothing else', () => {
    expect([...subtreeIds(nodes(), 'outer')].sort()).toEqual(['c', 'd', 'inner', 'outer']);
    expect([...subtreeIds(nodes(), 'd')]).toEqual(['d']);
  });
});

describe('findDropTarget', () => {
  it('returns the innermost boundary under the point', () => {
    const ns = nodes();
    expect(findDropTarget(ns, 'u', centre(get(ns, 'c')))?.id).toBe('inner');
    expect(findDropTarget(ns, 'u', centre(get(ns, 'd')))?.id).toBe('outer');
  });

  it('returns null over empty canvas', () => {
    expect(findDropTarget(nodes(), 'u', { x: -500, y: -500 })).toBeNull();
  });

  it('never returns the dragged boundary or its descendants', () => {
    const ns = nodes();
    // Over the dragged boundary's own child: skip `inner`, fall back to `outer`.
    expect(findDropTarget(ns, 'inner', centre(get(ns, 'c')))?.id).toBe('outer');
    // Over the dragged boundary: skip `outer` itself, nothing else contains the point.
    expect(findDropTarget(ns, 'outer', centre(get(ns, 'd')))).toBeNull();
    expect(findDropTarget(ns, 'outer', centre(get(ns, 'c')))).toBeNull();
  });

  it('does not exclude the dragged element\'s own parent', () => {
    const ns = nodes();
    expect(findDropTarget(ns, 'd', centre(get(ns, 'd')))?.id).toBe('outer');
  });
});

describe('decideReparent', () => {
  it.each([
    // [draggedParent, target, altKey, expected]
    [undefined, 'b', false, { parent: 'b' }],
    ['a', 'b', false, { parent: 'b' }],
    ['a', 'a', false, null],
    ['a', undefined, false, null],
    [undefined, undefined, false, null],
    ['a', 'b', true, { parent: 'b' }],
    ['a', 'a', true, null],
    ['a', undefined, true, { parent: undefined }],
    [undefined, undefined, true, null],
    [undefined, 'b', true, { parent: 'b' }],
  ] as const)('parent %s, target %s, alt %s', (draggedParent, target, altKey, expected) => {
    expect(decideReparent({ draggedParent, target, altKey })).toEqual(expected);
  });

  it('a plain drop onto an ancestor of the current parent reparents to that ancestor', () => {
    expect(decideReparent({ draggedParent: 'inner', target: 'outer', altKey: false })).toEqual({ parent: 'outer' });
  });
});

describe('clampIntoBoundary', () => {
  const target = { x: 100, y: 200 };
  it('pulls a position above or left of the content area inside it', () => {
    expect(clampIntoBoundary(target, 0, 0)).toEqual({
      x: 100 + BOUNDARY_PADDING,
      y: 200 + BOUNDARY_HEADER_HEIGHT,
    });
  });
  it('leaves a position already inside alone', () => {
    expect(clampIntoBoundary(target, 500, 600)).toEqual({ x: 500, y: 600 });
  });
});
