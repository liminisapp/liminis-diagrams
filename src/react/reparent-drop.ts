/**
 * Pure rules for dropping a dragged element or boundary somewhere new.
 *
 * Kept free of React so the table of outcomes can be tested directly.
 */

import { BOUNDARY_HEADER_HEIGHT, BOUNDARY_PADDING } from '../core/layout';
import type { LayoutNode, Point } from '../core/types';
import { findBoundaryAt } from './hit-test';

/** Ids of `rootId` and everything nested under it, found through `element.parent`. */
export function subtreeIds(nodes: LayoutNode[], rootId: string): Set<string> {
  const parentOf = new Map(nodes.map((n) => [n.id, n.element.parent]));
  const ids = new Set<string>();
  for (const node of nodes) {
    let cur: string | undefined = node.id;
    for (let hops = 0; cur !== undefined && hops < 1000; hops++) {
      if (cur === rootId) {
        ids.add(node.id);
        break;
      }
      cur = parentOf.get(cur);
    }
  }
  return ids;
}

/**
 * The innermost boundary under `point` that may receive `draggedId`: never the
 * dragged item itself or anything nested inside it. `nodes` should be a layout
 * snapshot from before the drag began; hit-testing the live layout would find
 * the item's own parent almost every time, since a boundary grows to contain
 * whatever is dragged over it.
 */
export function findDropTarget(nodes: LayoutNode[], draggedId: string, point: Point): LayoutNode | null {
  const excluded = subtreeIds(nodes, draggedId);
  return findBoundaryAt(
    nodes.filter((n) => !excluded.has(n.id)),
    point,
  );
}

export interface ReparentDecision {
  /** Destination boundary alias; undefined means the top level */
  parent: string | undefined;
}

/**
 * What a release should report, given the dragged item's current parent `P`, the
 * drop target `T` and the ⌥ state at release:
 *
 * - T exists and T ≠ P: reparent into T (plain or ⌥; a plain drop onto an
 *   ancestor of P therefore lifts the item one or more levels).
 * - ⌥ with no T and a P: reparent to the top level.
 * - anything else: no reparent, only the position change.
 */
export function decideReparent(args: {
  draggedParent: string | undefined;
  target: string | undefined;
  altKey: boolean;
}): ReparentDecision | null {
  const { draggedParent, target, altKey } = args;
  if (target !== undefined) return target !== draggedParent ? { parent: target } : null;
  if (altKey && draggedParent !== undefined) return { parent: undefined };
  return null;
}

/**
 * Keep an item dropped into a boundary inside its content area, so the boundary
 * does not grow up or left and shift its own origin (as `handleSelectKind` does
 * for a new nested boundary).
 */
export function clampIntoBoundary(target: Pick<LayoutNode, 'x' | 'y'>, x: number, y: number): Point {
  return {
    x: Math.max(x, target.x + BOUNDARY_PADDING),
    y: Math.max(y, target.y + BOUNDARY_HEADER_HEIGHT),
  };
}
