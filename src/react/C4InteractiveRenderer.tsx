/**
 * C4InteractiveRenderer - Interactive SVG renderer with drag support
 *
 * Wraps the C4Renderer with drag-and-drop functionality for manual layout mode.
 * Maintains local position state during drag and recalculates edges in real-time.
 */

// React 19 removed the global `JSX` namespace; liminis-editor papered over that
// with an ambient `declare global` shim (src/ambient/jsx.d.ts). A published
// package cannot do that — the shim would either pollute every consumer's
// global scope or not ship at all, leaving our emitted .d.ts referencing an
// unresolvable `JSX.Element`. Importing the namespace keeps it local.
import type { JSX } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { C4RendererContent, computeLegendInfo, normaliseZoom } from './renderer';
import { BOUNDARY_HEADER_HEIGHT, BOUNDARY_PADDING, EMPTY_BOUNDARY_SIZE, layoutC4Diagram } from '../core/layout';
import type { LayoutResult, LayoutNode, C4Diagram, C4Element, Point } from '../core/types';
import { isBoundary } from '../core/types';
import {
  C4_BOUNDARY_DEFAULT_LABELS,
  C4_DEFAULT_LABELS,
  C4_DEFAULT_RELATIONSHIP_LABEL,
  generateC4Alias,
  placeholderLabelFor,
  type C4AddableBoundaryKind,
  type C4AddableElementKind,
} from '../core/alias';
import { sanitizeC4Text, type C4Edit, type C4RelationshipTarget } from '../core/edit';
import { estimateLabelSize } from '../core/edge-clipping';
import { useC4DiagramDrag, type C4DragInfo } from './hooks/useC4DiagramDrag';
import { useC4ConnectDrag } from './hooks/useC4ConnectDrag';
import {
  GROWTH_CAP_MARGIN_PX,
  MAX_REMAP_PASSES,
  originShift,
  findScrollContainerRect,
  isInsideGrowthMargin,
  scaleDiffers,
} from './dragFrame';
import { findBoundaryAt, findElementAt } from './hit-test';
import { clampIntoBoundary, decideReparent, findDropTarget } from './reparent-drop';
import { LONG_PRESS_MOVE_TOLERANCE, useC4LongPress } from './hooks/useC4LongPress';
import { ActionBar } from './ActionBar';
import { EditMenu } from './EditMenu';
import { buildMenuItems, type C4ContextMenuRequest, type EditMenuChoice } from './menuItems';
import { LabelInput } from './LabelInput';

/** Synthetic ID used to store legend position in manual positions map */
export const LEGEND_POSITION_ID = '__legend__';

/** Context the renderer reports alongside a structural edit. */
export interface C4EditContext {
  /**
   * The complete positions map the host should store, replacing its own.
   *
   * It is the host's current manual positions (untouched, so nothing that was
   * placed moves), plus the current position of every node that had none (so
   * adding a node cannot reshuffle the automatic layout), plus — for an added
   * element — the position the user placed it at, keyed by the new alias.
   */
  positions: Record<string, { x: number; y: number }>;
}

/** A native `contextmenu` this soon after a long-press is the same gesture (host menu path). */
const HOST_REQUEST_DEDUPE_MS = 750;

/** Default size of a freshly placed node, matching what layout gives new nodes. */
function defaultNodeSize(choice: EditMenuChoice): { width: number; height: number } {
  if (choice.group === 'boundary') return { ...EMPTY_BOUNDARY_SIZE };
  return choice.kind === 'person' ? { width: 120, height: 120 } : { width: 240, height: 80 };
}

/** The add-element context menu, open at a point on the canvas. */
interface MenuState {
  /** Where the menu was opened, in SVG space: the new element is placed here. */
  x: number;
  y: number;
  /** Enclosing boundary at that point, if any. */
  parent?: string;
  /** The pointer of the long-press that opened it; null for a `contextmenu` event. */
  pointerId: number | null;
}

/** A connection that has been released on a valid target and is waiting for its label. */
interface PendingRel {
  sourceId: string;
  targetId: string;
  /** Midpoint of the new edge, in SVG space: where the label input appears. */
  x: number;
  y: number;
}

/** A label being renamed in place. Nothing is reported until it is confirmed. */
type RenameState =
  | {
      kind: 'element';
      id: string;
      /** The node's rectangle, in SVG space: the input covers it. */
      x: number;
      y: number;
      width: number;
      height: number;
      /** What the input is prefilled with, and what "unchanged" means */
      current: string;
      /** Used when the confirmed label is empty */
      fallback: string;
    }
  | {
      kind: 'relationship';
      target: C4RelationshipTarget;
      /** Midpoint of the edge, in SVG space: where the input appears. */
      x: number;
      y: number;
      current: string;
    };

/** The boundary a drag would drop into, as drawn by the highlight. In SVG space. */
interface DropTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a long-press resolved to when it started. */
type PressTarget =
  | { kind: 'element'; id: string }
  | { kind: 'relationship'; index: number }
  | { kind: 'menu' };

/** The label argument as written: `label` without the ` [technology]` the parser appends. */
function rawRelationshipLabel(rel: { label: string; technology?: string }): string {
  const suffix = rel.technology ? ` [${rel.technology}]` : '';
  return suffix && rel.label.endsWith(suffix) ? rel.label.slice(0, -suffix.length) : rel.label;
}

/** An element or empty boundary that has been placed and is waiting for its label. */
type PendingAdd = {
  parent?: string;
  x: number;
  y: number;
  width: number;
  height: number;
} & (
  | { target: 'element'; kind: C4AddableElementKind }
  | { target: 'boundary'; kind: C4AddableBoundaryKind }
);

/** The placeholder label for a pending add. */
function pendingPlaceholder(p: PendingAdd): string {
  return p.target === 'boundary' ? C4_BOUNDARY_DEFAULT_LABELS[p.kind] : C4_DEFAULT_LABELS[p.kind];
}

export interface C4InteractiveRendererProps {
  /** Parsed C4 diagram */
  diagram: C4Diagram;
  /** Whether dark mode is enabled */
  isDarkMode: boolean;
  /** Whether edit mode (drag) is enabled */
  isEditMode: boolean;
  /** Current manual positions */
  manualPositions: Record<string, { x: number; y: number }>;
  /** Callback when positions change (during drag or on drag end) */
  onPositionChange: (positions: Record<string, { x: number; y: number }>) => void;
  /**
   * Called when the user adds an element or connects two elements. Providing it
   * (together with `isEditMode`) is what turns the add and connect affordances on;
   * without it the renderer behaves exactly as before.
   *
   * It also reports a `rename` when the user double-clicks an element (on touch:
   * taps it, then Rename in the action bar) or double-clicks (on touch,
   * long-presses) a relationship label and confirms a new one, and a `reparent`
   * when the user drops an element or boundary onto another boundary, ⌥-drags a
   * child out of its boundary, or (on touch) chooses Move out in the action bar.
   *
   * The renderer never applies the edit and never writes anywhere. The host
   * applies `edit` to its source text (see `applyC4Edit` in `./core`) and stores
   * `context.positions` — in the same update, so the diagram never renders the
   * new text against the old positions.
   */
  onEdit?: (edit: C4Edit, context: C4EditContext) => void;
  /**
   * Let the host own the context menu. When supplied, the renderer never draws its
   * own add-element menu; on a right-click or (in edit mode) a long-press it calls
   * this with the position and the diagram's actions at that point, so the host can
   * show **one** menu holding its own items and the diagram's.
   *
   * It is called for every right-click on the diagram, with `items: []` where the
   * diagram has nothing to offer (on a node, a relationship label, the legend, a
   * connect handle, outside edit mode, or in edit mode without `onEdit`), so the
   * host's own items stay reachable everywhere. The renderer handles the event once:
   * it calls `preventDefault()` and `stopPropagation()`, so a host handler on an
   * ancestor does not open a second menu. A right-click during a drag or a connect
   * is swallowed without a call.
   *
   * Calling `item.select()` is the same as picking that kind in the built-in menu at
   * the point the request was made: the renderer shows its label prompt and then
   * reports the edit through `onEdit`. The renderer keeps no menu state between the
   * request and `select()`; a host that closes its menu simply never calls it.
   *
   * Without this prop the built-in menu is used and propagation is unchanged.
   */
  onContextMenu?: (request: C4ContextMenuRequest) => void;
  /**
   * Scale factor for the rendered diagram. 1 is actual size; 2 draws it twice as
   * large. Defaults to 1, so a host that does not care is unaffected.
   *
   * This scales the SVG's rendered `width`/`height` and leaves the `viewBox`
   * alone, rather than applying a CSS transform. Three things follow, and they
   * are the reason for doing it this way:
   *
   *   - Dragging keeps working untouched. Screen coordinates are mapped through
   *     `getScreenCTM().inverse()`, and that matrix already carries the ratio
   *     between the viewBox and the rendered size — so a node still lands under
   *     the pointer at any zoom, with no arithmetic anywhere in the drag code.
   *   - The diagram genuinely occupies more space, so a scrolling container
   *     scrolls it. A CSS `transform` is painted after layout: the element still
   *     reports its unscaled size, and the overflow it appears to produce cannot
   *     be scrolled to.
   *   - Text stays sharp. It is re-rendered at the new scale rather than being a
   *     bitmap stretched over it.
   *
   * Controls are deliberately not included. What a zoom control should look like
   * is the host's business — this package renders diagrams.
   *
   * The one CSS `transform` this component ever sets is not the zoom mechanism:
   * during a node drag it translates the `<svg>` to hold the diagram origin still
   * on screen while the frame grows (ADR-100), and it is removed when the drag ends.
   * `holdOrigin={false}` turns even that off.
   */
  zoom?: number;
  /**
   * Called when the size of the frame (the viewBox width and height, in diagram
   * units) changes, from a layout effect — so a host that derives `zoom` from the
   * frame (zoom-to-fit) can re-measure and re-render before the browser paints.
   * During a node drag the frame grows live, and this is how a fitting host sees it.
   */
  onFrameChange?: (size: { width: number; height: number }) => void;
  /**
   * Whether the renderer holds the diagram origin still on screen during a node
   * drag (ADR-100) by translating the `<svg>` with a CSS `transform`. Default
   * `true`. A transform paints outside the svg's layout box, so a host whose
   * container clips (any `overflow` other than `visible`) cuts off the grown strip
   * at the top and left, including the dragged node, until release.
   *
   * With `false` the renderer never sets a `transform`: the svg's layout box is
   * always the whole drawing, so all four edges behave alike. The origin then moves
   * inside that box when the frame grows at the top or left, and the host must
   * absorb it (typically by scrolling its container) using `onOriginShift`. A host
   * that opts out and does not compensate sees the drawing shift on screen.
   */
  holdOrigin?: boolean;
  /**
   * With `holdOrigin={false}`: called from a layout effect, in the same commit as
   * the frame change and so before paint, whenever the diagram origin moves on
   * screen during a drag because the frame grew or shrank at the top or left. `dx`
   * and `dy` are CSS px at the current rendered scale (user-space shift times the
   * scale, so correct when host CSS shrinks the svg to fit) and are the
   * displacement since the previous commit, not a running total. Positive means
   * the origin moved right/down, so scrolling by the same amounts keeps it still.
   *
   * Not called for bottom/right-only changes, a zero shift, or outside a drag. A
   * cancelled drag (pointercancel, Escape) reports the reverse shift so the host
   * can undo its compensation. Never called while `holdOrigin` is `true`, where
   * the renderer's own transform already compensates.
   */
  onOriginShift?: (shift: { dx: number; dy: number }) => void;
}

/**
 * Collect all node IDs and their positions from the layout tree.
 */
function collectNodePositions(nodes: LayoutNode[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    positions[node.id] = { x: node.x, y: node.y };
    if (node.children) {
      Object.assign(positions, collectNodePositions(node.children));
    }
  }
  return positions;
}

/**
 * Build a map from element ID to all its descendant IDs (recursive).
 */
function collectDescendantIds(elements: C4Element[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  function getDescendants(element: C4Element): string[] {
    const ids: string[] = [];
    for (const child of element.children) {
      ids.push(child.id);
      ids.push(...getDescendants(child));
    }
    return ids;
  }

  function visit(element: C4Element): void {
    const descendants = getDescendants(element);
    if (descendants.length > 0) {
      map.set(element.id, descendants);
    }
    for (const child of element.children) {
      visit(child);
    }
  }

  for (const element of elements) {
    visit(element);
  }

  return map;
}

/**
 * Interactive C4 diagram renderer with drag support.
 *
 * When isEditMode is true, nodes can be dragged to new positions.
 * Edges and boundaries are recalculated in real-time during drag.
 */
export function C4InteractiveRenderer({
  diagram,
  isDarkMode,
  isEditMode,
  manualPositions,
  onPositionChange,
  onEdit,
  onContextMenu,
  zoom = 1,
  onFrameChange,
  holdOrigin = true,
  onOriginShift,
}: C4InteractiveRendererProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);

  // Live frame growth during a drag (ADR-100, amended by #104). `scale` is the
  // rendered scale; the drag-start value tells the cap whether it has changed.
  const scale = normaliseZoom(zoom);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const dragStartScaleRef = useRef(scale);
  // Growth is paused while the pointer is near the container edge in a drag whose
  // scale has changed (zoom-to-fit). See `GROWTH_CAP_MARGIN_PX`.
  const [growthCapped, setGrowthCapped] = useState(false);
  // Consecutive synthetic re-maps since the last real pointer move.
  const remapPassesRef = useRef(0);

  // Structural editing is on only with edit mode AND a callback to report to: a
  // host that passes isEditMode for dragging alone must not grow dead buttons.
  const canEdit = isEditMode && onEdit !== undefined;
  // Context menu for adding an element, open at a point on the canvas.
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Placed element waiting for its label; nothing reaches the host until confirmed.
  const [pending, setPending] = useState<PendingAdd | null>(null);
  // Released connection waiting for its label; likewise nothing is reported until confirmed.
  const [pendingRel, setPendingRel] = useState<PendingRel | null>(null);
  // Label being renamed in place; likewise nothing is reported until confirmed.
  const [renaming, setRenaming] = useState<RenameState | null>(null);

  // The node tapped on touch: it shows the action bar (Rename, Move out). Transient UI state,
  // never reported to the host.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Where the press in flight began, to tell a tap from a drag.
  const dragStartClientRef = useRef<{ x: number; y: number } | null>(null);
  // Boundary that would receive the current drag if released now (highlighted).
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Layout as it was when the drag began. Drop targets are found against this, not the
  // live layout: a boundary grows to contain whatever is dragged over it, so the live
  // layout always puts the pointer inside the item's own parent.
  const dragSnapshotRef = useRef<LayoutNode[] | null>(null);
  // Whether the pointer has moved since the drag began (a bare click must not re-parent).
  const dragMovedRef = useRef(false);

  // Local positions during drag (merged with persisted positions)
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  // Ref mirror of dragPositions — always current, avoids stale closure in handleNodeDragEnd
  const dragPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // rAF handle for throttling drag updates
  const rafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);

  // Track drag start position for computing delta (used to move children)
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Map from element ID to its descendant IDs (for moving children with boundary)
  const descendantMap = useMemo(() => {
    return collectDescendantIds(diagram.elements);
  }, [diagram.elements]);

  // Compute the auto-layout once for seeding positions on first drag
  const autoLayout = useMemo(() => {
    return layoutC4Diagram(diagram);
  }, [diagram]);

  // Merge persisted positions with drag positions
  const effectivePositions = useMemo(() => ({
    ...manualPositions,
    ...dragPositions,
  }), [manualPositions, dragPositions]);

  // Compute layout using effective positions
  const layout = useMemo(() => {
    const hasPositions = Object.keys(effectivePositions).length > 0;
    return layoutC4Diagram(diagram, undefined, hasPositions ? effectivePositions : undefined);
  }, [diagram, effectivePositions]);

  /**
   * Apply drag delta to a node and all its descendants.
   * Returns an object with updated positions for the node and its children.
   */
  const applyDragWithChildren = useCallback((
    nodeId: string,
    x: number,
    y: number,
    basePositions: Record<string, { x: number; y: number }>,
  ): Record<string, { x: number; y: number }> => {
    const updates: Record<string, { x: number; y: number }> = { [nodeId]: { x, y } };

    const childIds = descendantMap.get(nodeId);
    if (childIds && dragStartPosRef.current) {
      const dx = x - dragStartPosRef.current.x;
      const dy = y - dragStartPosRef.current.y;
      for (const childId of childIds) {
        const childPos = basePositions[childId];
        if (childPos) {
          updates[childId] = { x: childPos.x + dx, y: childPos.y + dy };
        }
      }
    }

    return updates;
  }, [descendantMap]);

  // Snapshot of positions at drag start (before any delta is applied to children)
  const dragStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // Helper to update both drag state and ref mirror
  const updateDragPositions = useCallback((
    updater: (prev: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>
  ) => {
    setDragPositions(prev => {
      const next = updater(prev);
      dragPositionsRef.current = next;
      return next;
    });
  }, []);

  // Handle real-time position updates during drag, throttled to rAF
  const handleNodeDrag = useCallback((nodeId: string, x: number, y: number, info?: C4DragInfo) => {
    dragMovedRef.current = true;
    if (info && !info.synthetic) remapPassesRef.current = 0;
    if (info && svgRef.current) {
      // The feedback cap: growing the frame shrinks the fit scale, which maps the
      // same pointer position further out. Stop growing near the container edge.
      // Inert at a fixed zoom, where the scale never changes.
      const capped =
        scaleDiffers(scaleRef.current, dragStartScaleRef.current) &&
        isInsideGrowthMargin(findScrollContainerRect(svgRef.current), info.clientX, info.clientY, GROWTH_CAP_MARGIN_PX);
      setGrowthCapped((prev) => (prev === capped ? prev : capped));
    }
    if (canEdit && info) {
      const snapshot = dragSnapshotRef.current;
      let next: DropTarget | null = null;
      if (snapshot && info.point && nodeId !== LEGEND_POSITION_ID) {
        const target = findDropTarget(snapshot, nodeId, info.point);
        const decision = decideReparent({
          draggedParent: diagram.elements.find((e) => e.id === nodeId)?.parent,
          target: target?.id,
          altKey: info.altKey,
        });
        if (target && decision?.parent === target.id) {
          next = { id: target.id, x: target.x, y: target.y, width: target.width, height: target.height };
        }
      }
      setDropTarget((prev) => (prev?.id === next?.id ? prev : next));
    }

    // On first move of a new drag, clear any stale positions from previous drag
    if (!dragStartPosRef.current && Object.keys(dragPositionsRef.current).length > 0) {
      dragPositionsRef.current = {};
      setDragPositions({});
    }

    pendingDragRef.current = { nodeId, x, y };

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingDragRef.current;
        if (pending) {
          updateDragPositions(prev => {
            // On first drag, seed all node positions from current layout
            // to prevent other nodes from jumping to default placement
            if (Object.keys(prev).length === 0 && Object.keys(manualPositions).length === 0) {
              const seeded = collectNodePositions(autoLayout.nodes);
              // Record start positions for delta calculation
              if (!dragStartPosRef.current) {
                dragStartPosRef.current = seeded[pending.nodeId] ?? { x: pending.x, y: pending.y };
                dragStartPositionsRef.current = { ...seeded };
              }
              const updates = applyDragWithChildren(pending.nodeId, pending.x, pending.y, dragStartPositionsRef.current);
              return { ...seeded, ...updates };
            }

            // Record start position on first move if not already set
            if (!dragStartPosRef.current) {
              const currentPos = { ...manualPositions, ...prev };
              dragStartPosRef.current = currentPos[pending.nodeId] ?? { x: pending.x, y: pending.y };
              dragStartPositionsRef.current = { ...currentPos };
            }

            const updates = applyDragWithChildren(pending.nodeId, pending.x, pending.y, dragStartPositionsRef.current);
            return { ...prev, ...updates };
          });
        }
      });
    }
  }, [canEdit, diagram.elements, manualPositions, autoLayout.nodes, applyDragWithChildren, updateDragPositions]);

  // Handle drag end - persist positions
  // Uses dragPositionsRef (not dragPositions state) to avoid stale closure race
  const handleNodeDragEnd = useCallback((nodeId: string, x: number, y: number, info?: C4DragInfo) => {
    setGrowthCapped(false);
    // Cancel any pending rAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // A touch or pen tap (the pointer barely moved) selects the node; it is not a drag, so no
    // positions are reported. A mouse click keeps reporting as before.
    const pressedAt = dragStartClientRef.current;
    dragStartClientRef.current = null;
    if (
      canEdit &&
      info &&
      pressedAt &&
      (info.pointerType === 'touch' || info.pointerType === 'pen') &&
      nodeId !== LEGEND_POSITION_ID &&
      Math.hypot(info.clientX - pressedAt.x, info.clientY - pressedAt.y) <= LONG_PRESS_MOVE_TOLERANCE
    ) {
      // Drop the jitter the drag preview may have applied within the tolerance.
      if (dragStartPosRef.current !== null) {
        dragPositionsRef.current = {};
        setDragPositions({});
      }
      pendingDragRef.current = null;
      dragStartPosRef.current = null;
      dragStartPositionsRef.current = {};
      dragSnapshotRef.current = null;
      dragMovedRef.current = false;
      setDropTarget(null);
      const node = layout.nodes.find((n) => n.id === nodeId);
      // Something to offer: Rename for an element, Move out for anything nested.
      const hasActions = node !== undefined && (!isBoundary(node.element) || node.element.parent !== undefined);
      setSelectedId(hasActions ? nodeId : null);
      return;
    }

    // Dropped over a different boundary, or ⌥-dragged out of its own: a re-parent. Decided at
    // release, against the pre-drag layout, so a child left outside its boundary is found there.
    const snapshot = dragSnapshotRef.current;
    const moved = dragMovedRef.current;
    dragSnapshotRef.current = null;
    dragMovedRef.current = false;
    setDropTarget(null);
    if (canEdit && moved && snapshot && info?.point && nodeId !== LEGEND_POSITION_ID) {
      const target = findDropTarget(snapshot, nodeId, info.point);
      const decision = decideReparent({
        draggedParent: diagram.elements.find((e) => e.id === nodeId)?.parent,
        target: target?.id,
        altKey: info.altKey,
      });
      if (decision) {
        // Pin every other node where the user saw it before the drag, so the old boundary
        // shrinks back and nothing else moves; the host's own positions stay as they are.
        const pinned = { ...collectNodePositions(snapshot), ...manualPositions };
        const base = dragStartPositionsRef.current;
        if (!dragStartPosRef.current) {
          dragStartPositionsRef.current = pinned;
          dragStartPosRef.current = pinned[nodeId] ?? { x, y };
        }
        // Keep a nested drop inside its new parent's content area so it does not shift its own origin.
        const at = target && decision.parent !== undefined ? clampIntoBoundary(target, x, y) : { x, y };
        const updates = applyDragWithChildren(nodeId, at.x, at.y, Object.keys(base).length > 0 ? base : pinned);
        const positions = { ...pinned, ...updates };
        // Show the result until the host's new positions arrive.
        dragPositionsRef.current = positions;
        setDragPositions(positions);
        dragStartPosRef.current = null;
        dragStartPositionsRef.current = {};
        onEdit?.(
          decision.parent === undefined ? { kind: 'reparent', id: nodeId } : { kind: 'reparent', id: nodeId, parent: decision.parent },
          { positions },
        );
        return;
      }
    }

    // Read latest drag positions from ref (immune to stale closure)
    const currentDragPositions = dragPositionsRef.current;

    // Merge all positions and persist
    const newPositions = {
      ...manualPositions,
      ...currentDragPositions,
    };

    // If this is the first drag, populate all other nodes with their current auto-layout positions
    if (Object.keys(manualPositions).length === 0) {
      const autoPositions = collectNodePositions(autoLayout.nodes);
      for (const [id, pos] of Object.entries(autoPositions)) {
        if (!newPositions[id]) {
          newPositions[id] = pos;
        }
      }
    }

    // Apply final position with children
    const basePositions = dragStartPositionsRef.current;
    const updates = applyDragWithChildren(nodeId, x, y, basePositions);
    Object.assign(newPositions, updates);

    onPositionChange(newPositions);
    // Don't clear dragPositions here — manualPositions hasn't absorbed the
    // new values yet (Lexical update listener is async). Clearing now would
    // cause effectivePositions to revert to stale manualPositions, producing
    // a visual snap-back. Instead, clear in the effect below when
    // manualPositions catches up.
    dragStartPosRef.current = null;
    dragStartPositionsRef.current = {};
  }, [canEdit, diagram.elements, layout.nodes, manualPositions, autoLayout.nodes, onPositionChange, onEdit, applyDragWithChildren]);

  /** Drop every trace of a drag in flight without reporting it. */
  const resetDragState = useCallback(() => {
    setGrowthCapped(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingDragRef.current = null;
    dragPositionsRef.current = {};
    setDragPositions({});
    dragStartPosRef.current = null;
    dragStartPositionsRef.current = {};
    dragSnapshotRef.current = null;
    dragMovedRef.current = false;
    dragStartClientRef.current = null;
    setDropTarget(null);
  }, []);

  // `pointercancel` and Escape abandon a drag: no edit, no position change. Opt-in to
  // the hook's cancel semantics only when editing, so a plain `isEditMode` is unchanged.
  const handleNodeDragCancel = useCallback(() => resetDragState(), [resetDragState]);

  // Set up drag hook (window-level listeners handle mousemove/mouseup)
  const { draggedNodeId, startNodeDrag, cancelDrag, remapDrag } = useC4DiagramDrag({
    svgRef,
    onNodeDrag: handleNodeDrag,
    onNodeDragEnd: handleNodeDragEnd,
    onNodeDragCancel: canEdit ? handleNodeDragCancel : undefined,
    enabled: isEditMode,
    // A host absorbing the origin shift itself scrolls by an amount the locked
    // matrix cannot know (rounding, clamping), so map through the live one.
    liveMapping: !holdOrigin,
  });

  // `onOriginShift` is wrapped so the outer component knows the host scrolled in
  // this commit (see the effect below). Only with the opt-out: otherwise the
  // callback is never called.
  const onOriginShiftRef = useRef(onOriginShift);
  onOriginShiftRef.current = onOriginShift;
  const shiftedRef = useRef(false);
  const handleOriginShift = useCallback((shift: { dx: number; dy: number }) => {
    // Remap only if the host moved the svg on screen inside its callback (scrolled).
    // A host that does nothing leaves the origin shifted; remapping then would chase
    // the shift and run away, the feedback #100 removed.
    const svg = svgRef.current;
    const before = svg?.getScreenCTM();
    onOriginShiftRef.current?.(shift);
    const after = svg?.getScreenCTM();
    if (before && after && (before.e !== after.e || before.f !== after.f)) shiftedRef.current = true;
  }, []);

  // The host absorbed an origin shift (scrolled) during this commit. If it scrolled
  // by exactly the shift the mapping is unchanged and `remapDrag` reports nothing;
  // if it scrolled differently the stationary pointer now maps to a different point,
  // and this brings the node back under it. Runs after the child's layout effects,
  // which is where the callback fires. Same `MAX_REMAP_PASSES` budget as zoom-to-fit.
  useLayoutEffect(() => {
    if (!shiftedRef.current) return;
    shiftedRef.current = false;
    if (draggedNodeId === null) return;
    if (remapPassesRef.current >= MAX_REMAP_PASSES) return;
    if (remapDrag()) remapPassesRef.current += 1;
  });

  // The rendered scale changed (zoom-to-fit re-fitting as the frame grew) under a
  // stationary pointer: re-map the pointer through the new matrix so the dragged
  // node comes back under it. Runs in the layout phase, after the child has
  // committed the new size and re-applied the origin hold. Each pass can change
  // the frame and so the scale again; it converges while the pointer is inside the
  // container, and `MAX_REMAP_PASSES` bounds it regardless.
  useLayoutEffect(() => {
    if (draggedNodeId === null) return;
    if (remapPassesRef.current >= MAX_REMAP_PASSES) return;
    if (remapDrag()) remapPassesRef.current += 1;
  }, [scale, draggedNodeId, remapDrag]);

  /**
   * Every node's position: the current layout for nodes without a manual
   * position, the host's own value for those with one (so those never move, and
   * never pick up rounding), then any extras. Read from the effective `layout`,
   * not `autoLayout`, so a partial host map or a "Reset layout" pins correctly.
   * Stateless on purpose: there is no "first edit" flag to get out of sync.
   */
  const buildPositions = (extra?: Record<string, { x: number; y: number }>) => ({
    ...collectNodePositions(layout.nodes),
    ...effectivePositions,
    ...extra,
  });

  // Mirrors for guards that run inside event handlers.
  const draggedNodeIdRef = useRef<string | null>(null);
  draggedNodeIdRef.current = draggedNodeId;
  const busyRef = useRef(false);
  busyRef.current = menu !== null || pending !== null || pendingRel !== null || renaming !== null;
  // Read by a host item's `select()`, which may run after this render has been replaced.
  const layoutNodesRef = useRef(layout.nodes);
  layoutNodesRef.current = layout.nodes;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const { connectSourceId, connectPointer, startConnect } = useC4ConnectDrag({
    svgRef,
    enabled: canEdit,
    // Move, connect, the menu and the label inputs are mutually exclusive.
    canStart: () => draggedNodeIdRef.current === null && !busyRef.current,
    onConnect: (sourceId, point) => {
      const target = findElementAt(layout.nodes, point);
      // Empty canvas, a boundary (no boundary relationships in this cut) or the
      // source itself (cannot be drawn as an edge): nothing to report.
      if (!target || target.id === sourceId) return;
      const source = layout.nodes.find((n) => n.id === sourceId);
      if (!source) return;
      // Name it before reporting: the label is fixed before the edit exists, so
      // the edit API needs nothing new. The input sits at the middle of the edge.
      setPendingRel({
        sourceId,
        targetId: target.id,
        x: Math.round((source.x + source.width / 2 + target.x + target.width / 2) / 2),
        y: Math.round((source.y + source.height / 2 + target.y + target.height / 2) / 2),
      });
    },
  });

  const guardedStartNodeDrag = useCallback(
    (nodeId: string, nodeX: number, nodeY: number, e: React.PointerEvent | React.MouseEvent) => {
      if (connectSourceId !== null) return;
      if (canEdit && draggedNodeIdRef.current === null) {
        dragSnapshotRef.current = layout.nodes;
        dragMovedRef.current = false;
        dragStartClientRef.current = { x: e.clientX, y: e.clientY };
      }
      // No overlay needs closing here: the menu closes on the outside pointerdown that
      // begins this drag and a label input on blur, so none is open to be misplaced
      // while the frame grows (they are siblings of the <svg>, not under its transform).
      if (draggedNodeIdRef.current === null) {
        dragStartScaleRef.current = scaleRef.current;
        remapPassesRef.current = 0;
        setGrowthCapped(false);
      }
      startNodeDrag(nodeId, nodeX, nodeY, e);
    },
    [canEdit, connectSourceId, layout.nodes, startNodeDrag],
  );

  // Edit mode (or the callback) going away drops any half-finished add.
  useEffect(() => {
    if (!canEdit) {
      setMenu(null);
      setPending(null);
      setPendingRel(null);
      setRenaming(null);
      setDropTarget(null);
      setSelectedId(null);
    }
  }, [canEdit]);

  // A host that takes over the menu must not be left with a built-in one still open
  // (it would hold `busyRef` true). Reverting to `undefined` needs nothing: the
  // handlers read the current prop.
  const hostOwnsMenu = onContextMenu !== undefined;
  useEffect(() => {
    if (hostOwnsMenu) setMenu(null);
  }, [hostOwnsMenu]);

  // The selected alias vanishing (the diagram changed under it) clears the selection.
  useEffect(() => {
    if (selectedId !== null && !diagram.elements.some((e) => e.id === selectedId)) setSelectedId(null);
  }, [diagram.elements, selectedId]);

  // Escape deselects. Listening only while something is selected keeps it out of the way of
  // the label inputs, the menu and a drag, which each handle their own Escape.
  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // No window-level pointercancel here on purpose. Once the element is placed no
  // gesture is in flight, so a cancel from an unrelated pointer (a palm, a system
  // gesture) must not discard the label being typed; Escape or blur cancel the
  // input. The menu does its own, scoped to the pointer that opened it.

  /** Open the menu at a client point, unless something that is not canvas is there. */
  const openMenuAt = useCallback(
    (clientX: number, clientY: number, pointerId: number | null) => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const p = pt.matrixTransform(ctm.inverse());
      setSelectedId(null);
      const next: MenuState = { x: p.x, y: p.y, pointerId };
      const parent = findBoundaryAt(layout.nodes, p)?.id;
      if (parent !== undefined) next.parent = parent;
      setMenu(next);
    },
    [layout.nodes],
  );

  /** A client point in SVG space, or null when the SVG is not measurable. */
  const toSvgPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  }, []);

  /**
   * What a press at this point means: a relationship label, an element, the add
   * menu (empty canvas or a boundary), or nothing (a handle or the legend).
   */
  const resolvePressTarget = useCallback(
    (target: EventTarget | null, clientX: number, clientY: number): PressTarget | null => {
      if (!(target instanceof Element)) return null;
      if (target.closest('[data-connect-handle]')) return null;
      if (target.closest(`[data-node-id="${LEGEND_POSITION_ID}"]`)) return null;
      const relHit = target.closest('[data-rel-index]');
      if (relHit) return { kind: 'relationship', index: Number(relHit.getAttribute('data-rel-index')) };
      const p = toSvgPoint(clientX, clientY);
      if (!p) return null;
      const element = findElementAt(layout.nodes, p);
      return element ? { kind: 'element', id: element.id } : { kind: 'menu' };
    },
    [layout.nodes, toSvgPoint],
  );

  /** Where the menu may open: empty canvas or inside a boundary, not on an element, handle, legend or relationship label. */
  const isMenuTarget = useCallback(
    (target: EventTarget | null, clientX: number, clientY: number): boolean =>
      resolvePressTarget(target, clientX, clientY)?.kind === 'menu',
    [resolvePressTarget],
  );

  const startRenameElement = (id: string) => {
    if (!canEdit || busyRef.current || connectSourceId !== null) return;
    if (draggedNodeIdRef.current !== null) return;
    const node = layout.nodes.find((n) => n.id === id);
    if (!node || isBoundary(node.element)) return;
    setSelectedId(null);
    setRenaming({
      kind: 'element',
      id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      current: node.element.name,
      fallback: placeholderLabelFor(node.element),
    });
  };

  const startRenameRelationship = (index: number, afterAbort = false) => {
    if (!canEdit || busyRef.current || connectSourceId !== null) return;
    if (!afterAbort && draggedNodeIdRef.current !== null) return;
    const rel = diagram.relationships[index];
    const edge = layout.edges.find((e) => e.relationshipIndex === index);
    if (!rel || !edge || edge.points.length < 2) return;
    setSelectedId(null);
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    setRenaming({
      kind: 'relationship',
      target: { index, sourceId: rel.sourceId, targetId: rel.targetId, label: rel.label },
      x: (first.x + last.x) / 2,
      y: (first.y + last.y) / 2,
      current: rawRelationshipLabel(rel),
    });
  };

  const handleConfirmRename = (value: string) => {
    if (!renaming) return;
    const state = renaming;
    setRenaming(null);
    const label =
      sanitizeC4Text(value) ||
      (state.kind === 'element' ? state.fallback : C4_DEFAULT_RELATIONSHIP_LABEL);
    // Nothing to say if it reads the same as it did.
    if (label === state.current) return;
    const target =
      state.kind === 'element' ? { element: state.id } : { relationship: state.target };
    onEdit?.({ kind: 'rename', target, label }, { positions: buildPositions() });
  };

  const abortMoveDrag = () => {
    if (draggedNodeIdRef.current === null) return;
    cancelDrag();
    resetDragState();
  };

  // What the press in flight resolved to when it started.
  const pressTargetRef = useRef<PressTarget | null>(null);

  const { onPointerDownCapture: onLongPressPointerDown } = useC4LongPress({
    enabled: canEdit,
    shouldStart: (e) => {
      pressTargetRef.current = null;
      if (draggedNodeIdRef.current !== null || busyRef.current) return false;
      const press = resolvePressTarget(e.target, e.clientX, e.clientY);
      // A press on an element is the start of a move-drag, and a pause before moving must not
      // turn it into a rename: touch renames from the action bar. Boundaries, empty canvas and
      // relationship labels keep their long-press.
      if (press?.kind === 'element') return false;
      pressTargetRef.current = press;
      return press !== null;
    },
    onLongPress: ({ clientX, clientY, pointerId }) => {
      const press = pressTargetRef.current;
      pressTargetRef.current = null;
      if (!press) return;
      // A press on a node or a boundary also started a move-drag on its hit rect.
      // The menu or the rename input takes the pointer over: drop that drag and
      // its preview without reporting it, so releasing the finger writes no
      // positions to the host.
      abortMoveDrag();
      if (press.kind === 'relationship') startRenameRelationship(press.index, true);
      else if (onContextMenu) requestHostMenuFrom('longpress', clientX, clientY, pointerId, true);
      else openMenuAt(clientX, clientY, pointerId);
    },
  });

  const handleActionRename = () => {
    if (selectedId !== null) startRenameElement(selectedId);
  };

  const handleActionMoveOut = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id === null || !canEdit) return;
    if (!diagram.elements.find((e) => e.id === id)?.parent) return;
    // Nothing moves on the canvas: every position is pinned as it is, and the item goes to the top level.
    onEdit?.({ kind: 'reparent', id }, { positions: buildPositions() });
  };

  // Any press on the canvas (a drag, a connect handle, a long-press) deselects, so the bar is
  // never stale; a tap on a node selects it again when it is released.
  const handlePointerDownCapture = (e: React.PointerEvent) => {
    setSelectedId(null);
    onLongPressPointerDown(e);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Edit mode only, and only where the menu exists: a read-only render, and a
    // host that passes isEditMode without onEdit, keep the browser's own menu.
    e.preventDefault();
    if (busyRef.current || draggedNodeIdRef.current !== null) return;
    if (!isMenuTarget(e.target, e.clientX, e.clientY)) return;
    openMenuAt(e.clientX, e.clientY, null);
  };

  /**
   * Place a new element or boundary centred on a point and start its label prompt.
   * Shared by the built-in menu and a host item's `select()`, so they cannot differ.
   */
  const startPendingAdd = (choice: EditMenuChoice, at: { x: number; y: number; parent?: string }) => {
    const size = defaultNodeSize(choice);
    let x = Math.round(at.x - size.width / 2);
    let y = Math.round(at.y - size.height / 2);
    if (choice.group === 'boundary' && at.parent !== undefined) {
      // Keep a new nested boundary inside its parent's content area. Left of or above it, the
      // parent would shift its own origin to contain the child, moving a node that already has a position.
      const parentNode = layoutNodesRef.current.find((n) => n.id === at.parent);
      if (parentNode) {
        x = Math.max(x, parentNode.x + BOUNDARY_PADDING);
        y = Math.max(y, parentNode.y + BOUNDARY_HEADER_HEIGHT);
      }
    }
    const next = { target: choice.group, kind: choice.kind, x, y, ...size } as PendingAdd;
    if (at.parent !== undefined) next.parent = at.parent;
    setPending(next);
  };

  const handleSelectKind = (choice: EditMenuChoice) => {
    if (!menu) return;
    setMenu(null);
    startPendingAdd(choice, menu);
  };

  // --- Host-owned context menu (`onContextMenu`) ---------------------------------
  // The last request and where it came from. A browser may fire a native
  // `contextmenu` after a long-press; without this the host would be asked twice for
  // one gesture. Transient bookkeeping, not menu state.
  const lastHostRequestRef = useRef<{ at: number; source: 'longpress' | 'contextmenu' } | null>(null);

  /** Hand the host a request. `menuPoint` is true where the diagram has add actions. */
  const requestHostMenu = (
    clientX: number,
    clientY: number,
    pointerId: number | null,
    menuPoint: boolean,
  ) => {
    if (!onContextMenu) return;
    setSelectedId(null);
    let items: C4ContextMenuRequest['items'] = [];
    const p = canEdit && menuPoint ? toSvgPoint(clientX, clientY) : null;
    if (p) {
      const parent = findBoundaryAt(layout.nodes, p)?.id;
      items = buildMenuItems((choice) => {
        // No-op once edit mode is off, or while a label or rename input is open: the built-in
        // menu cannot open then either, and a second overlay must not stack on the first.
        if (!canEditRef.current || busyRef.current) return;
        // The parent may have gone since the request: then it is a top-level add.
        const stillThere = parent !== undefined && layoutNodesRef.current.some((n) => n.id === parent);
        startPendingAdd(choice, stillThere ? { x: p.x, y: p.y, parent } : { x: p.x, y: p.y });
      });
    }
    onContextMenu({ clientX, clientY, pointerId, items });
  };

  /** Run a host request unless the other gesture of the same press just made one. */
  const requestHostMenuFrom = (
    source: 'longpress' | 'contextmenu',
    clientX: number,
    clientY: number,
    pointerId: number | null,
    menuPoint: boolean,
  ) => {
    const now = Date.now();
    const last = lastHostRequestRef.current;
    if (last && last.source !== source && now - last.at < HOST_REQUEST_DEDUPE_MS) return;
    lastHostRequestRef.current = { at: now, source };
    requestHostMenu(clientX, clientY, pointerId, menuPoint);
  };

  const handleHostContextMenu = (e: React.MouseEvent) => {
    // One handler for the whole diagram: the host's own handler on an ancestor must not fire.
    e.preventDefault();
    e.stopPropagation();
    // A drag or a connect in flight swallows it. Open label inputs do not: the host's
    // menu is not ours to gate.
    if (draggedNodeIdRef.current !== null || connectSourceId !== null) return;
    const menuPoint = isMenuTarget(e.target, e.clientX, e.clientY);
    requestHostMenuFrom('contextmenu', e.clientX, e.clientY, null, menuPoint);
  };

  const handleConfirmLabel = (value: string) => {
    if (!pending) return;
    const label = sanitizeC4Text(value) || pendingPlaceholder(pending);
    const alias = generateC4Alias(
      label,
      diagram.elements.map((e) => e.id),
      pending.kind,
    );
    const edit: C4Edit =
      pending.target === 'boundary'
        ? { kind: 'add-boundary', boundaryKind: pending.kind, label, alias }
        : { kind: 'add-element', elementKind: pending.kind, label, alias };
    if (pending.parent !== undefined) edit.parent = pending.parent;
    const positions = buildPositions({ [alias]: { x: pending.x, y: pending.y } });
    setPending(null);
    onEdit?.(edit, { positions });
  };

  const handleConfirmRelLabel = (value: string) => {
    if (!pendingRel) return;
    const label = sanitizeC4Text(value) || C4_DEFAULT_RELATIONSHIP_LABEL;
    const { sourceId, targetId } = pendingRel;
    setPendingRel(null);
    onEdit?.(
      { kind: 'add-relationship', sourceId, targetId, label },
      { positions: buildPositions() },
    );
  };

  // Clear drag positions once manualPositions has absorbed the persisted values.
  // We verify absorption by comparing values — this avoids both:
  // - Clearing mid-drag (draggedNodeId guard)
  // - Clearing before Lexical propagates (value comparison)
  useEffect(() => {
    if (draggedNodeId || Object.keys(dragPositionsRef.current).length === 0) return;

    // Reset case: manualPositions was cleared (e.g., "Reset to Auto Layout")
    if (Object.keys(manualPositions).length === 0) {
      dragPositionsRef.current = {};
      setDragPositions({});
      return;
    }

    // Normal case: only clear once manualPositions contains the drag values
    const absorbed = Object.entries(dragPositionsRef.current).every(
      ([id, pos]) => {
        const mp = manualPositions[id];
        return mp?.x === pos.x && mp?.y === pos.y;
      }
    );
    if (absorbed) {
      dragPositionsRef.current = {};
      setDragPositions({});
    }
  }, [manualPositions, draggedNodeId]);

  // Compute legend info for hit area and position override
  const legendInfo = useMemo(() => computeLegendInfo(layout), [layout]);
  const legendPositionOverride = useMemo(() => {
    const pos = effectivePositions[LEGEND_POSITION_ID];
    return pos ?? null;
  }, [effectivePositions]);

  // Render with interactive wrappers
  return (
    <C4InteractiveSvg
      layout={layout}
      isDarkMode={isDarkMode}
      isEditMode={isEditMode}
      draggedNodeId={draggedNodeId}
      svgRef={svgRef}
      onNodeMouseDown={guardedStartNodeDrag}
      legendInfo={legendInfo}
      legendPositionOverride={legendPositionOverride}
      zoom={zoom}
      growthCapped={growthCapped}
      onFrameChange={onFrameChange}
      holdOrigin={holdOrigin}
      onOriginShift={holdOrigin ? undefined : handleOriginShift}
      onHostContextMenu={onContextMenu ? handleHostContextMenu : undefined}
      editing={
        canEdit
          ? {
              menu: hostOwnsMenu ? null : menu,
              pending,
              pendingRel,
              renaming,
              connectSourceId,
              connectPointer,
              dropTarget,
              selectedId,
              onLongPressPointerDown: handlePointerDownCapture,
              onActionRename: handleActionRename,
              onActionMoveOut: handleActionMoveOut,
              onContextMenu: handleContextMenu,
              onSelectKind: handleSelectKind,
              onCloseMenu: () => setMenu(null),
              onStartConnect: startConnect,
              onConfirmLabel: handleConfirmLabel,
              onCancelLabel: () => setPending(null),
              onConfirmRelLabel: handleConfirmRelLabel,
              onCancelRelLabel: () => setPendingRel(null),
              onRenameElement: startRenameElement,
              onRenameRelationship: startRenameRelationship,
              onConfirmRename: handleConfirmRename,
              onCancelRename: () => setRenaming(null),
            }
          : null
      }
    />
  );
}

interface C4InteractiveSvgProps {
  layout: LayoutResult;
  isDarkMode: boolean;
  isEditMode: boolean;
  draggedNodeId: string | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onNodeMouseDown: (
    nodeId: string,
    nodeX: number,
    nodeY: number,
    e: React.PointerEvent | React.MouseEvent,
  ) => void;
  legendInfo: { x: number; y: number; width: number; height: number } | null;
  legendPositionOverride: { x: number; y: number } | null;
  /** Scale factor applied to the rendered size; the viewBox is unchanged. */
  zoom: number;
  /** Frame growth is paused (fit mode, pointer near the container edge). */
  growthCapped: boolean;
  onFrameChange?: (size: { width: number; height: number }) => void;
  /** False: never write a `transform`; report origin shifts instead. */
  holdOrigin: boolean;
  onOriginShift?: (shift: { dx: number; dy: number }) => void;
  /** Host-owned context menu: attached whether or not editing is on, and replaces the built-in handler. */
  onHostContextMenu?: (e: React.MouseEvent) => void;
  /** Structural-editing state and handlers; null when editing is not enabled. */
  editing: EditingProps | null;
}

interface EditingProps {
  menu: MenuState | null;
  pending: PendingAdd | null;
  pendingRel: PendingRel | null;
  renaming: RenameState | null;
  connectSourceId: string | null;
  connectPointer: Point | null;
  dropTarget: DropTarget | null;
  selectedId: string | null;
  onLongPressPointerDown: (e: React.PointerEvent) => void;
  onActionRename: () => void;
  onActionMoveOut: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onSelectKind: (choice: EditMenuChoice) => void;
  onCloseMenu: () => void;
  onStartConnect: (sourceId: string, e: React.PointerEvent) => void;
  onConfirmLabel: (value: string) => void;
  onCancelLabel: () => void;
  onConfirmRelLabel: (value: string) => void;
  onCancelRelLabel: () => void;
  onRenameElement: (id: string) => void;
  onRenameRelationship: (index: number) => void;
  onConfirmRename: (value: string) => void;
  onCancelRename: () => void;
}

/** Width of the relationship label input, in px. */
const REL_LABEL_WIDTH = 160;

/** Radius of the (invisible) touch target of a connect handle, in SVG units. */
const CONNECT_HANDLE_HIT_RADIUS = 16;

/**
 * SVG wrapper that adds interactive overlays for drag handling.
 */
interface SvgFrame {
  viewBoxX: number;
  viewBoxY: number;
  svgWidth: number;
  svgHeight: number;
  scale: number;
}

function C4InteractiveSvg({
  layout,
  isDarkMode,
  isEditMode,
  draggedNodeId,
  svgRef,
  onNodeMouseDown,
  legendInfo,
  legendPositionOverride,
  zoom,
  growthCapped,
  onFrameChange,
  holdOrigin,
  onOriginShift,
  onHostContextMenu,
  editing,
}: C4InteractiveSvgProps): JSX.Element {
  // Guarded here as well as in C4Renderer: both are public entry points, and a
  // host reaching this one never passes through the other.
  const liveScale = normaliseZoom(zoom);
  // Get colors based on theme
  const handleColor = isDarkMode ? '#a0a0a0' : '#505050';

  // Create hit areas for each node (and legend if present)
  const hitAreas = useMemo(() => {
    const areas: {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];

    function collectNodes(nodes: LayoutNode[]) {
      for (const node of nodes) {
        areas.push({
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        });
      }
    }

    collectNodes(layout.nodes);

    // Add legend as a draggable hit area
    if (legendInfo) {
      const lx = legendPositionOverride?.x ?? legendInfo.x;
      const ly = legendPositionOverride?.y ?? legendInfo.y;
      areas.push({
        id: LEGEND_POSITION_ID,
        x: lx,
        y: ly,
        width: legendInfo.width,
        height: legendInfo.height,
      });
    }

    return areas;
  }, [layout.nodes, legendInfo, legendPositionOverride]);

  // Compute SVG dimensions that include potential legend overflow,
  // mirroring the behavior of the non-interactive C4Renderer.
  const liveFrame = useMemo<SvgFrame>(() => {
    let w = layout.width;
    let h = layout.height;
    if (legendInfo) {
      const lx = legendPositionOverride?.x ?? legendInfo.x;
      const ly = legendPositionOverride?.y ?? legendInfo.y;
      const legendRight = lx + legendInfo.width - layout.viewBoxX;
      const legendBottom = ly + legendInfo.height - layout.viewBoxY;
      if (legendRight > w) w = legendRight;
      if (legendBottom > h) h = legendBottom;
    }
    return {
      viewBoxX: layout.viewBoxX,
      viewBoxY: layout.viewBoxY,
      svgWidth: w,
      svgHeight: h,
      scale: liveScale,
    };
  }, [
    layout.width,
    layout.height,
    layout.viewBoxX,
    layout.viewBoxY,
    legendInfo,
    legendPositionOverride,
    liveScale,
  ]);

  // Live frame, origin held still (ADR-100, amended by #104).
  //
  // `layout` keeps updating while a node is dragged, so the frame (viewBox and
  // size) grows live and the host's scroll extent follows. Growth moves the
  // diagram origin on screen — a negative `viewBoxX/Y` at the top and left, and a
  // centring host shifts content by half the growth at the right and bottom — which
  // would drag every node, and the dragged node away from the pointer, whose
  // mapping is locked at drag start (`useC4DiagramDrag`). So, after every render
  // during a drag, the origin is measured and the difference from where it was at
  // drag start is cancelled with a CSS `transform: translate(...)`. A transform
  // does not affect layout, so the pane still grows. It is dropped on release.
  //
  // The one exception is the fit-mode feedback cap: while `growthCapped` the last
  // uncapped frame is rendered again (the scale, and so the mapping, stay put and
  // the node still follows the pointer; it is drawn past the edge, `overflow:
  // visible`). `frameRef` is updated on every uncapped render.
  const frameRef = useRef<SvgFrame>(liveFrame);
  const dragging = draggedNodeId !== null;
  const capped = dragging && growthCapped;
  if (!capped) frameRef.current = liveFrame;
  const frame = capped ? frameRef.current : liveFrame;
  const { svgWidth, svgHeight, scale } = frame;
  const viewBoxX = frame.viewBoxX;
  const viewBoxY = frame.viewBoxY;

  // Hold the origin. Layout phase, so no frame is painted between the frame
  // changing and the compensation catching up. The transform is cleared before
  // measuring, so the measurement never depends on whether an engine's
  // `getScreenCTM()` includes a CSS transform (WebKit has been inconsistent), and
  // the result is the real position, so host centring needs no special case.
  // Imperative on purpose: React's style diffing never touches it.
  // `null`: no drag yet. `false`: the first drag render could not be measured, so there
  // is no valid reference and no compensation is applied (re-basing from a later,
  // already-grown frame would leave the diagram shifted for the rest of the drag).
  const originStartRef = useRef<{ x: number; y: number } | false | null>(null);
  useLayoutEffect(() => {
    // Opted out (#110): the host absorbs the shift, nothing is written, not even `''`.
    if (!holdOrigin) return;
    const svg = svgRef.current;
    if (!svg) return;
    if (!dragging) {
      if (svg.style.transform) svg.style.transform = '';
      originStartRef.current = null;
      return;
    }
    svg.style.transform = '';
    const ctm = svg.getScreenCTM();
    // The first drag render still has the pre-drag frame: positions only change
    // on a later animation frame.
    if (originStartRef.current === null) originStartRef.current = ctm ? { x: ctm.e, y: ctm.f } : false;
    const start = originStartRef.current;
    if (!start || !ctm) return;
    const dx = start.x - ctm.e;
    const dy = start.y - ctm.f;
    if (dx !== 0 || dy !== 0) svg.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  // Dropped with the component too, though the element goes with it.
  useLayoutEffect(
    () => () => {
      if (holdOrigin && svgRef.current) svgRef.current.style.transform = '';
    },
    [svgRef, holdOrigin],
  );

  // Origin shift for a host that opted out of the hold (#110). From the frame
  // actually rendered (after the growth-cap substitution), not from the DOM, so a
  // host scrolling inside the callback cannot disturb the baseline, and it is
  // exactly zero for bottom/right-only changes. The baseline advances on every
  // commit, reported or not. On cancel `draggedNodeId` goes null in the same
  // commit that restores the frame, hence `wasDraggingRef`: that commit is still
  // part of the drag and reports the reverse shift.
  const onOriginShiftRef = useRef(onOriginShift);
  onOriginShiftRef.current = onOriginShift;
  const lastOriginFrameRef = useRef({ viewBoxX, viewBoxY, scale });
  const wasDraggingRef = useRef(false);
  useLayoutEffect(() => {
    const prev = lastOriginFrameRef.current;
    const cur = { viewBoxX, viewBoxY, scale };
    lastOriginFrameRef.current = cur;
    const inDrag = dragging || wasDraggingRef.current;
    wasDraggingRef.current = dragging;
    if (holdOrigin || !inDrag) return;
    const shift = originShift(prev, cur);
    if (shift) onOriginShiftRef.current?.(shift);
  }, [holdOrigin, dragging, viewBoxX, viewBoxY, scale]);

  // Tell a fitting host the frame size changed, in the same commit.
  const onFrameChangeRef = useRef(onFrameChange);
  onFrameChangeRef.current = onFrameChange;
  const lastFrameSizeRef = useRef({ width: svgWidth, height: svgHeight });
  useLayoutEffect(() => {
    const last = lastFrameSizeRef.current;
    if (last.width === svgWidth && last.height === svgHeight) return;
    lastFrameSizeRef.current = { width: svgWidth, height: svgHeight };
    onFrameChangeRef.current?.({ width: svgWidth, height: svgHeight });
  }, [svgWidth, svgHeight]);

  const connectSource = editing?.connectSourceId
    ? layout.nodes.find((n) => n.id === editing.connectSourceId)
    : undefined;
  const connectTarget =
    connectSource && editing?.connectPointer
      ? findElementAt(layout.nodes, editing.connectPointer)
      : null;
  const accent = 'var(--c4-accent, #3b82f6)';
  const gesturesIdle =
    editing?.menu === null &&
    editing.pending === null &&
    editing.pendingRel === null &&
    editing.renaming === null;
  // Elements that can be renamed by double-click: everything but boundaries and the legend.
  const renamableIds = useMemo(
    () => new Set(layout.nodes.filter((n) => !isBoundary(n.element)).map((n) => n.id)),
    [layout.nodes],
  );
  const selectedNode = editing?.selectedId
    ? layout.nodes.find((n) => n.id === editing.selectedId)
    : undefined;
  const pendingRelNodes = editing?.pendingRel
    ? {
        source: layout.nodes.find((n) => n.id === editing.pendingRel!.sourceId),
        target: layout.nodes.find((n) => n.id === editing.pendingRel!.targetId),
      }
    : null;

  const svgElement = (
      <svg
        ref={svgRef}
        width={svgWidth * scale}
        height={svgHeight * scale}
        viewBox={`${viewBoxX} ${viewBoxY} ${svgWidth} ${svgHeight}`}
        xmlns="http://www.w3.org/2000/svg"
        data-diagram="c4"
        // Capture phase: a press on a boundary also starts a move-drag, whose own
        // handler stops propagation. Only attached when editing is on.
        onPointerDownCapture={editing ? (e) => {
          // A right-click is a menu request, not the start of a move-drag.
          if (e.pointerType === 'mouse' && e.button === 2) {
            e.stopPropagation();
            return;
          }
          editing.onLongPressPointerDown(e);
        } : undefined}
        onContextMenu={onHostContextMenu ?? editing?.onContextMenu}
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          cursor: isEditMode ? (draggedNodeId ? 'grabbing' : 'default') : 'default',
          // While growth is paused the frame is held, so the dragged node can leave it.
          ...(dragging ? { overflow: 'visible' } : {}),
          // A long-press must open the menu, not the browser's text-selection and
          // callout. Edit mode with a callback only; read-only renders keep defaults.
          ...(editing ? { WebkitTouchCallout: 'none', userSelect: 'none', WebkitUserSelect: 'none' } : {}),
        }}
      >
        {/* Use the exported renderer content for stable API */}
        <C4RendererContent layout={layout} isDarkMode={isDarkMode} legendPositionOverride={legendPositionOverride} />

        {/* Overlay interactive hit areas in edit mode */}
        {isEditMode && (
          <g className="interactive-layer">
            {hitAreas.map((area) => (
              <rect
                key={area.id}
                data-node-id={area.id}
                x={area.x}
                y={area.y}
                width={area.width}
                height={area.height}
                fill="transparent"
                stroke="transparent"
                style={{
                  cursor: draggedNodeId === area.id ? 'grabbing' : 'grab',
                  // Without this the browser claims the gesture for panning and
                  // zooming before any pointermove reaches us, so a touch drag
                  // scrolls the page instead of moving the node. `none` is
                  // deliberate rather than `pan-y`: the hit area is a drag
                  // target, and a partial allowance still lets the browser
                  // steal the gesture mid-drag and fire pointercancel.
                  touchAction: 'none',
                }}
                onPointerDown={(e) => onNodeMouseDown(area.id, area.x, area.y, e)}
                // Only where rename exists; otherwise the browser's own
                // double-click behaviour is left alone.
                onDoubleClick={
                  editing && renamableIds.has(area.id) ? () => editing.onRenameElement(area.id) : undefined
                }
              />
            ))}
          </g>
        )}

        {/* Drag handles in edit mode */}
        {isEditMode && (
          <g className="drag-handles-layer">
            {hitAreas.map((area) => (
              <DragHandle
                key={`handle-${area.id}`}
                x={area.x + area.width - 20}
                y={area.y + 4}
                color={handleColor}
                isDragging={draggedNodeId === area.id}
              />
            ))}
          </g>
        )}

        {/* Relationship label targets: above the node rects (so a label over a
            boundary does not start a boundary move-drag), below the connect
            handles. The rendered text can be a legend letter or a step number,
            so the target is geometric: a box at the label's anchor, or a wide
            invisible stroke along the line when there is no label to hit. */}
        {gesturesIdle && (
          <g className="relationship-targets-layer">
            {layout.edges.map((edge, i) => {
              if (edge.relationshipIndex === undefined || edge.points.length < 2) return null;
              const first = edge.points[0];
              const last = edge.points[edge.points.length - 1];
              const common = {
                'data-rel-index': edge.relationshipIndex,
                fill: 'transparent',
                stroke: 'transparent',
                style: { cursor: 'text', touchAction: 'none' } as const,
                onDoubleClick: () => editing.onRenameRelationship(edge.relationshipIndex!),
              };
              if (edge.label) {
                const { halfW, halfH } = estimateLabelSize(edge.label, 12);
                const w = Math.min(Math.max(halfW, 20), 100);
                const h = Math.max(halfH, 12);
                const cx = (first.x + last.x) / 2;
                const cy = (first.y + last.y) / 2;
                return (
                  <rect
                    key={`rel-${i}`}
                    {...common}
                    x={cx - w}
                    y={cy - h}
                    width={w * 2}
                    height={h * 2}
                  />
                );
              }
              return (
                <line
                  key={`rel-${i}`}
                  {...common}
                  x1={first.x}
                  y1={first.y}
                  x2={last.x}
                  y2={last.y}
                  strokeWidth={16}
                  // Butt caps: edge points sit on the node borders, so round caps
                  // would protrude into the nodes and steal their move-drag.
                  strokeLinecap="butt"
                />
              );
            })}
          </g>
        )}

        {/* Connect handles: a separate target above the move rects, always
            visible because touch has no hover. Boundaries get none. */}
        {gesturesIdle && (
          <g className="connect-handles-layer">
            {layout.nodes
              .filter((n) => !isBoundary(n.element))
              .map((n) => {
                const cx = n.x + n.width;
                const cy = n.y + n.height / 2;
                return (
                  <g key={`connect-${n.id}`}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={accent}
                      stroke={isDarkMode ? '#18181b' : '#ffffff'}
                      strokeWidth={1.5}
                      style={{ pointerEvents: 'none' }}
                    />
                    <circle
                      data-connect-handle={n.id}
                      cx={cx}
                      cy={cy}
                      r={CONNECT_HANDLE_HIT_RADIUS}
                      fill="transparent"
                      style={{ cursor: 'crosshair', touchAction: 'none' }}
                      onPointerDown={(e) => editing.onStartConnect(n.id, e)}
                    />
                  </g>
                );
              })}
          </g>
        )}

        {/* Connect feedback: rubber band and target highlight */}
        {connectSource && editing?.connectPointer && (
          <g className="connect-feedback-layer" style={{ pointerEvents: 'none' }}>
            {connectTarget && connectTarget.id !== connectSource.id && (
              <rect
                x={connectTarget.x}
                y={connectTarget.y}
                width={connectTarget.width}
                height={connectTarget.height}
                fill="none"
                stroke={accent}
                strokeWidth={3}
                rx={4}
              />
            )}
            <line
              data-connect-line=""
              x1={connectSource.x + connectSource.width}
              y1={connectSource.y + connectSource.height / 2}
              x2={editing.connectPointer.x}
              y2={editing.connectPointer.y}
              stroke={accent}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          </g>
        )}

        {/* Drop target: the boundary that would receive the dragged item. Dashed as well as
            coloured, so colour is not the only cue. */}
        {editing?.dropTarget && draggedNodeId !== null && (
          <rect
            data-drop-target={editing.dropTarget.id}
            x={editing.dropTarget.x}
            y={editing.dropTarget.y}
            width={editing.dropTarget.width}
            height={editing.dropTarget.height}
            fill={isDarkMode ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)'}
            stroke={accent}
            strokeWidth={3}
            strokeDasharray="8 5"
            rx={6}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Ring around the tap-selected node, so it is clear what the action bar acts on */}
        {selectedNode && (
          <rect
            data-selected={selectedNode.id}
            x={selectedNode.x}
            y={selectedNode.y}
            width={selectedNode.width}
            height={selectedNode.height}
            fill="none"
            stroke={accent}
            strokeWidth={2}
            rx={6}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Ghost of an element waiting for its label; not in the source yet */}
        {editing?.pending && (
          <rect
            {...(editing.pending.target === 'boundary' ? { 'data-pending-boundary': '' } : { 'data-pending-element': '' })}
            x={editing.pending.x}
            y={editing.pending.y}
            width={editing.pending.width}
            height={editing.pending.height}
            fill={isDarkMode ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'}
            stroke={accent}
            strokeWidth={2}
            strokeDasharray="6 4"
            rx={6}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Ghost of a connection waiting for its label; not in the source yet */}
        {pendingRelNodes?.source && pendingRelNodes.target && (
          <line
            data-pending-relationship=""
            x1={pendingRelNodes.source.x + pendingRelNodes.source.width / 2}
            y1={pendingRelNodes.source.y + pendingRelNodes.source.height / 2}
            x2={pendingRelNodes.target.x + pendingRelNodes.target.width / 2}
            y2={pendingRelNodes.target.y + pendingRelNodes.target.height / 2}
            stroke={accent}
            strokeWidth={2}
            strokeDasharray="6 4"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>
  );

  if (!editing) {
    return <div style={{ position: 'relative' }}>{svgElement}</div>;
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Own positioning context, so the menu and the label inputs are offset from
          the SVG's origin. */}
      <div style={{ position: 'relative' }}>
        {svgElement}
        {selectedNode && gesturesIdle && editing.dropTarget === null && draggedNodeId === null && (
          <ActionBar
            // Below the node, clear of the finger that tapped it.
            left={(selectedNode.x - viewBoxX) * scale}
            top={(selectedNode.y + selectedNode.height - viewBoxY) * scale + 8}
            isDarkMode={isDarkMode}
            canRename={!isBoundary(selectedNode.element)}
            canMoveOut={selectedNode.element.parent !== undefined}
            onRename={editing.onActionRename}
            onMoveOut={editing.onActionMoveOut}
          />
        )}
        {editing.menu && (
          <EditMenu
            // Offset from the point so a finger that opened it is not under an item.
            left={(editing.menu.x - viewBoxX) * scale + 8}
            top={(editing.menu.y - viewBoxY) * scale + 8}
            isDarkMode={isDarkMode}
            originPointerId={editing.menu.pointerId}
            onSelect={editing.onSelectKind}
            onClose={editing.onCloseMenu}
          />
        )}
        {editing.pending && (
          <LabelInput
            left={(editing.pending.x - viewBoxX) * scale}
            top={(editing.pending.y - viewBoxY) * scale}
            width={editing.pending.width * scale}
            // A boundary's label sits in its header, not over the whole (large, mostly empty) box.
            height={
              (editing.pending.target === 'boundary' ? BOUNDARY_HEADER_HEIGHT : editing.pending.height) * scale
            }
            ariaLabel={editing.pending.target === 'boundary' ? 'Boundary label' : undefined}
            initialValue={pendingPlaceholder(editing.pending)}
            isDarkMode={isDarkMode}
            onConfirm={editing.onConfirmLabel}
            onCancel={editing.onCancelLabel}
          />
        )}
        {editing.renaming?.kind === 'element' && (
          <LabelInput
            // Remounted per target so a new rename never inherits a settled input.
            key={`rename-${editing.renaming.id}`}
            left={(editing.renaming.x - viewBoxX) * scale}
            top={(editing.renaming.y - viewBoxY) * scale}
            width={editing.renaming.width * scale}
            height={editing.renaming.height * scale}
            initialValue={editing.renaming.current}
            isDarkMode={isDarkMode}
            onConfirm={editing.onConfirmRename}
            onCancel={editing.onCancelRename}
          />
        )}
        {editing.renaming?.kind === 'relationship' && (
          <LabelInput
            key={`rename-rel-${editing.renaming.target.index}`}
            left={(editing.renaming.x - viewBoxX) * scale - REL_LABEL_WIDTH / 2}
            top={(editing.renaming.y - viewBoxY) * scale - 14}
            width={REL_LABEL_WIDTH}
            height={28}
            ariaLabel="Relationship label"
            initialValue={editing.renaming.current}
            isDarkMode={isDarkMode}
            onConfirm={editing.onConfirmRename}
            onCancel={editing.onCancelRename}
          />
        )}
        {editing.pendingRel && (
          <LabelInput
            left={(editing.pendingRel.x - viewBoxX) * scale - REL_LABEL_WIDTH / 2}
            top={(editing.pendingRel.y - viewBoxY) * scale - 14}
            width={REL_LABEL_WIDTH}
            height={28}
            ariaLabel="Relationship label"
            initialValue={C4_DEFAULT_RELATIONSHIP_LABEL}
            isDarkMode={isDarkMode}
            onConfirm={editing.onConfirmRelLabel}
            onCancel={editing.onCancelRelLabel}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Drag handle indicator (grip icon).
 */
function DragHandle({
  x,
  y,
  color,
  isDragging,
}: {
  x: number;
  y: number;
  color: string;
  isDragging: boolean;
}): JSX.Element {
  const opacity = isDragging ? 0.8 : 0.4;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      opacity={opacity}
      style={{ pointerEvents: 'none' }}
    >
      {/* Grip vertical icon - 3 rows of 2 circles */}
      <circle cx={4} cy={4} r={1.5} fill={color} />
      <circle cx={12} cy={4} r={1.5} fill={color} />
      <circle cx={4} cy={8} r={1.5} fill={color} />
      <circle cx={12} cy={8} r={1.5} fill={color} />
      <circle cx={4} cy={12} r={1.5} fill={color} />
      <circle cx={12} cy={12} r={1.5} fill={color} />
    </g>
  );
}

export default C4InteractiveRenderer;
