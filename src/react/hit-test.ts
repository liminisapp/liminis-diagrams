/**
 * Geometric hit-testing against laid-out nodes.
 *
 * Done in SVG coordinates against the layout rather than via DOM hit-testing:
 * nodes overlap by design (children sit over their boundary), so what counts as
 * "the target" is a rule about nesting, not about paint order.
 *
 * `layout.nodes` is a flat list of every node in absolute coordinates, parents
 * before their children.
 */

import type { LayoutNode, Point } from '../core/types';
import { isBoundary } from '../core/types';

function contains(node: LayoutNode, p: Point): boolean {
  return p.x >= node.x && p.x <= node.x + node.width && p.y >= node.y && p.y <= node.y + node.height;
}

function depthOf(node: LayoutNode, byId: Map<string, LayoutNode>): number {
  let depth = 0;
  let parent = node.element.parent;
  while (parent !== undefined && depth < 1000) {
    depth++;
    parent = byId.get(parent)?.element.parent;
  }
  return depth;
}

/** The deepest node (by nesting) satisfying `accept` that contains the point. */
function deepestAt(nodes: LayoutNode[], p: Point, accept: (n: LayoutNode) => boolean): LayoutNode | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: LayoutNode | null = null;
  let bestDepth = -1;
  for (const node of nodes) {
    if (!accept(node) || !contains(node, p)) continue;
    const depth = depthOf(node, byId);
    // `>=`: among equals, the later node is painted on top.
    if (depth >= bestDepth) {
      best = node;
      bestDepth = depth;
    }
  }
  return best;
}

/** The deepest non-boundary node containing the point: a valid connect target. */
export function findElementAt(nodes: LayoutNode[], p: Point): LayoutNode | null {
  return deepestAt(nodes, p, (n) => !isBoundary(n.element));
}

/** The deepest boundary node containing the point: the parent for a placement. */
export function findBoundaryAt(nodes: LayoutNode[], p: Point): LayoutNode | null {
  return deepestAt(nodes, p, (n) => isBoundary(n.element));
}
