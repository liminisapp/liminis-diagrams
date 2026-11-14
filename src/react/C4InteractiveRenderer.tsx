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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useC4DiagramDrag } from './hooks/useC4DiagramDrag';
import { useC4ConnectDrag } from './hooks/useC4ConnectDrag';
import { findBoundaryAt, findElementAt } from './hit-test';
import { useC4LongPress } from './hooks/useC4LongPress';
import { EditMenu, type EditMenuChoice } from './EditMenu';
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
   * It also reports a `rename` when the user double-clicks (or, on touch,
   * long-presses) an element or a relationship label and confirms a new one.
   *
   * The renderer never applies the edit and never writes anywhere. The host
   * applies `edit` to its source text (see `applyC4Edit` in `./core`) and stores
   * `context.positions` — in the same update, so the diagram never renders the
   * new text against the old positions.
   */
  onEdit?: (edit: C4Edit, context: C4EditContext) => void;
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
   */
  zoom?: number;
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
  zoom = 1,
}: C4InteractiveRendererProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);

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
  const handleNodeDrag = useCallback((nodeId: string, x: number, y: number) => {
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
  }, [manualPositions, autoLayout.nodes, applyDragWithChildren, updateDragPositions]);

  // Handle drag end - persist positions
  // Uses dragPositionsRef (not dragPositions state) to avoid stale closure race
  const handleNodeDragEnd = useCallback((nodeId: string, x: number, y: number) => {
    // Cancel any pending rAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
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
  }, [manualPositions, autoLayout.nodes, onPositionChange, applyDragWithChildren]);

  // Set up drag hook (window-level listeners handle mousemove/mouseup)
  const { draggedNodeId, startNodeDrag, cancelDrag } = useC4DiagramDrag({
    svgRef,
    onNodeDrag: handleNodeDrag,
    onNodeDragEnd: handleNodeDragEnd,
    enabled: isEditMode,
  });

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
      startNodeDrag(nodeId, nodeX, nodeY, e);
    },
    [connectSourceId, startNodeDrag],
  );

  // Edit mode (or the callback) going away drops any half-finished add.
  useEffect(() => {
    if (!canEdit) {
      setMenu(null);
      setPending(null);
      setPendingRel(null);
      setRenaming(null);
    }
  }, [canEdit]);

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

  // `afterAbort`: a long-press has just dropped the move-drag it started, but the
  // ref mirror only catches up on the next render, so that guard must be skipped.
  const startRenameElement = (id: string, afterAbort = false) => {
    if (!canEdit || busyRef.current || connectSourceId !== null) return;
    if (!afterAbort && draggedNodeIdRef.current !== null) return;
    const node = layout.nodes.find((n) => n.id === id);
    if (!node || isBoundary(node.element)) return;
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
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingDragRef.current = null;
    dragPositionsRef.current = {};
    setDragPositions({});
    dragStartPosRef.current = null;
    dragStartPositionsRef.current = {};
  };

  // What the press in flight resolved to when it started.
  const pressTargetRef = useRef<PressTarget | null>(null);

  const { onPointerDownCapture: onLongPressPointerDown } = useC4LongPress({
    enabled: canEdit,
    shouldStart: (e) => {
      pressTargetRef.current = null;
      if (draggedNodeIdRef.current !== null || busyRef.current) return false;
      pressTargetRef.current = resolvePressTarget(e.target, e.clientX, e.clientY);
      return pressTargetRef.current !== null;
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
      if (press.kind === 'element') startRenameElement(press.id, true);
      else if (press.kind === 'relationship') startRenameRelationship(press.index, true);
      else openMenuAt(clientX, clientY, pointerId);
    },
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    // Edit mode only, and only where the menu exists: a read-only render, and a
    // host that passes isEditMode without onEdit, keep the browser's own menu.
    e.preventDefault();
    if (busyRef.current || draggedNodeIdRef.current !== null) return;
    if (!isMenuTarget(e.target, e.clientX, e.clientY)) return;
    openMenuAt(e.clientX, e.clientY, null);
  };

  const handleSelectKind = (choice: EditMenuChoice) => {
    if (!menu) return;
    const size = defaultNodeSize(choice);
    let x = Math.round(menu.x - size.width / 2);
    let y = Math.round(menu.y - size.height / 2);
    if (choice.group === 'boundary' && menu.parent !== undefined) {
      // Keep a new nested boundary inside its parent's content area. Left of or above it, the
      // parent would shift its own origin to contain the child, moving a node that already has a position.
      const parentNode = layout.nodes.find((n) => n.id === menu.parent);
      if (parentNode) {
        x = Math.max(x, parentNode.x + BOUNDARY_PADDING);
        y = Math.max(y, parentNode.y + BOUNDARY_HEADER_HEIGHT);
      }
    }
    const next = { target: choice.group, kind: choice.kind, x, y, ...size } as PendingAdd;
    if (menu.parent !== undefined) next.parent = menu.parent;
    setMenu(null);
    setPending(next);
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
      editing={
        canEdit
          ? {
              menu,
              pending,
              pendingRel,
              renaming,
              connectSourceId,
              connectPointer,
              onLongPressPointerDown,
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
  onLongPressPointerDown: (e: React.PointerEvent) => void;
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
  editing,
}: C4InteractiveSvgProps): JSX.Element {
  // Guarded here as well as in C4Renderer: both are public entry points, and a
  // host reaching this one never passes through the other.
  const scale = normaliseZoom(zoom);
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
  const { svgWidth, svgHeight } = useMemo(() => {
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
    return { svgWidth: w, svgHeight: h };
  }, [layout.width, layout.height, layout.viewBoxX, layout.viewBoxY, legendInfo, legendPositionOverride]);

  const connectSource = editing?.connectSourceId
    ? layout.nodes.find((n) => n.id === editing.connectSourceId)
    : undefined;
  const connectTarget =
    connectSource && editing?.connectPointer
      ? findElementAt(layout.nodes, editing.connectPointer)
      : null;
  const accent = 'var(--c4-accent, #3b82f6)';
  const gesturesIdle =
    editing !== null &&
    editing.menu === null &&
    editing.pending === null &&
    editing.pendingRel === null &&
    editing.renaming === null;
  // Elements that can be renamed by double-click: everything but boundaries and the legend.
  const renamableIds = useMemo(
    () => new Set(layout.nodes.filter((n) => !isBoundary(n.element)).map((n) => n.id)),
    [layout.nodes],
  );
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
        viewBox={`${layout.viewBoxX} ${layout.viewBoxY} ${svgWidth} ${svgHeight}`}
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
        onContextMenu={editing ? editing.onContextMenu : undefined}
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          cursor: isEditMode ? (draggedNodeId ? 'grabbing' : 'default') : 'default',
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
        {editing.menu && (
          <EditMenu
            // Offset from the point so a finger that opened it is not under an item.
            left={(editing.menu.x - layout.viewBoxX) * scale + 8}
            top={(editing.menu.y - layout.viewBoxY) * scale + 8}
            isDarkMode={isDarkMode}
            originPointerId={editing.menu.pointerId}
            onSelect={editing.onSelectKind}
            onClose={editing.onCloseMenu}
          />
        )}
        {editing.pending && (
          <LabelInput
            left={(editing.pending.x - layout.viewBoxX) * scale}
            top={(editing.pending.y - layout.viewBoxY) * scale}
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
            left={(editing.renaming.x - layout.viewBoxX) * scale}
            top={(editing.renaming.y - layout.viewBoxY) * scale}
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
            left={(editing.renaming.x - layout.viewBoxX) * scale - REL_LABEL_WIDTH / 2}
            top={(editing.renaming.y - layout.viewBoxY) * scale - 14}
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
            left={(editing.pendingRel.x - layout.viewBoxX) * scale - REL_LABEL_WIDTH / 2}
            top={(editing.pendingRel.y - layout.viewBoxY) * scale - 14}
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
