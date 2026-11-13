/**
 * useC4DiagramDrag - Hook for drag interaction on C4 diagram elements
 *
 * Provides drag-and-drop functionality for repositioning C4 diagram elements.
 * Uses window-level listeners during drag so the interaction continues even
 * when the cursor leaves the SVG bounds.
 *
 * Pointer events, not mouse events. This started as mouse-only and did not work
 * on touch devices at all: iPadOS and mobile Safari synthesize `mousedown` and
 * `click` *after* a gesture resolves, but never emit the `mousemove` stream a
 * drag needs, so the node never moved and the page panned instead. Pointer
 * events unify mouse, touch and pen, and are the only way to get one code path
 * for all three. `pointercancel` matters here too — the browser fires it when it
 * decides a touch is a scroll or a system gesture, and without handling it the
 * drag would stay stuck open with no terminating `pointerup`.
 */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';

export interface UseC4DiagramDragProps {
  /** Reference to the SVG element */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Callback fired during drag with new position */
  onNodeDrag?: (nodeId: string, x: number, y: number) => void;
  /** Callback fired when drag ends */
  onNodeDragEnd?: (nodeId: string, x: number, y: number) => void;
  /** Whether drag interaction is enabled */
  enabled: boolean;
}

export interface UseC4DiagramDragReturn {
  /** ID of the node currently being dragged */
  draggedNodeId: string | null;
  /** Whether a drag is in progress */
  isDragging: boolean;
  /** Start dragging a node */
  /**
   * Start dragging a node. Accepts a pointer or mouse event: the parameter is
   * widened rather than switched so existing callers passing a React.MouseEvent
   * still typecheck.
   */
  startNodeDrag: (
    nodeId: string,
    nodeX: number,
    nodeY: number,
    e: React.PointerEvent | React.MouseEvent,
  ) => void;
  /** Convert screen coordinates to SVG coordinates */
  screenToSvg: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /**
   * Abandon the drag in flight without reporting it: `onNodeDragEnd` is not
   * called. For when another gesture (a long-press opening the add menu) takes
   * over the pointer. A no-op when nothing is being dragged.
   */
  cancelDrag: () => void;
}

/**
 * Hook for managing drag interactions on C4 diagram nodes.
 *
 * During a drag, pointermove/pointerup/pointercancel are handled on `window` so
 * the interaction continues seamlessly when the pointer leaves the SVG.
 */
export function useC4DiagramDrag({
  svgRef,
  onNodeDrag,
  onNodeDragEnd,
  enabled,
}: UseC4DiagramDragProps): UseC4DiagramDragReturn {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  // Track the offset from cursor to node origin for smooth dragging
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Track the last known position for dragEnd callback
  const lastPositionRef = useRef({ x: 0, y: 0 });

  // The pointer that owns the current drag. Mouse events have exactly one
  // stream; pointer events do not — a touch device can deliver concurrent
  // streams for several fingers at once. Without this, a second finger landing
  // on another node overwrites the single-slot drag state, so the first
  // finger's moves start dragging the second node and either finger's release
  // ends the drag. Null when no drag is active; null for a mouse-event caller,
  // which cannot be concurrent anyway.
  const activePointerIdRef = useRef<number | null>(null);

  // Locked CTM inverse captured at drag start — prevents the accelerating
  // feedback loop where canvas expansion changes the scale mid-drag
  const lockedCtmInverseRef = useRef<DOMMatrix | null>(null);

  // Refs for callbacks so window listeners always see latest values
  const onNodeDragRef = useRef(onNodeDrag);
  onNodeDragRef.current = onNodeDrag;
  const onNodeDragEndRef = useRef(onNodeDragEnd);
  onNodeDragEndRef.current = onNodeDragEnd;
  const draggedNodeIdRef = useRef<string | null>(null);

  /**
   * Convert screen (client) coordinates to SVG coordinates.
   * Uses the locked CTM from drag start if available, otherwise live CTM.
   */
  const screenToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;

      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;

      const inverse = lockedCtmInverseRef.current ?? svg.getScreenCTM()?.inverse();
      if (!inverse) return null;

      const svgPoint = point.matrixTransform(inverse);
      return { x: svgPoint.x, y: svgPoint.y };
    },
    [svgRef]
  );

  const screenToSvgRef = useRef(screenToSvg);
  screenToSvgRef.current = screenToSvg;

  /**
   * Start dragging a node.
   * Locks the screen-to-SVG transform so canvas resizing during drag
   * doesn't cause accelerating movement.
   */
  const startNodeDrag = useCallback(
    (nodeId: string, nodeX: number, nodeY: number, e: React.PointerEvent | React.MouseEvent) => {
      if (!enabled) return;

      // One drag at a time. A pointerdown arriving while a drag is already in
      // progress is a second finger, not a new intent — ignore it rather than
      // letting it hijack the drag already underway.
      if (draggedNodeIdRef.current !== null) return;

      e.stopPropagation();
      e.preventDefault();

      activePointerIdRef.current = 'pointerId' in e ? e.pointerId : null;

      // Lock the CTM at drag start
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      lockedCtmInverseRef.current = ctm ? ctm.inverse() : null;

      const svgPoint = screenToSvg(e.clientX, e.clientY);
      if (!svgPoint) return;

      dragOffsetRef.current = {
        x: svgPoint.x - nodeX,
        y: svgPoint.y - nodeY,
      };

      lastPositionRef.current = { x: nodeX, y: nodeY };
      draggedNodeIdRef.current = nodeId;
      setDraggedNodeId(nodeId);
    },
    [enabled, screenToSvg, svgRef]
  );

  const cancelDrag = useCallback(() => {
    if (draggedNodeIdRef.current === null) return;
    draggedNodeIdRef.current = null;
    activePointerIdRef.current = null;
    lockedCtmInverseRef.current = null;
    setDraggedNodeId(null);
  }, []);

  // Attach window-level listeners while dragging
  useEffect(() => {
    if (!draggedNodeId) return;

    const handlePointerMove = (e: PointerEvent) => {
      const nodeId = draggedNodeIdRef.current;
      if (!nodeId) return;
      // Movement from any other finger is not this drag.
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;

      const svgPoint = screenToSvgRef.current(e.clientX, e.clientY);
      if (!svgPoint) return;

      const newX = svgPoint.x - dragOffsetRef.current.x;
      const newY = svgPoint.y - dragOffsetRef.current.y;

      lastPositionRef.current = { x: newX, y: newY };
      onNodeDragRef.current?.(nodeId, newX, newY);
    };

    const endDrag = (e: PointerEvent) => {
      const nodeId = draggedNodeIdRef.current;
      if (!nodeId) return;
      // A second finger lifting must not end the drag the first one owns.
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;

      onNodeDragEndRef.current?.(
        nodeId,
        lastPositionRef.current.x,
        lastPositionRef.current.y
      );
      draggedNodeIdRef.current = null;
      activePointerIdRef.current = null;
      lockedCtmInverseRef.current = null;
      setDraggedNodeId(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endDrag);
    // Fired when the browser takes the gesture over (scroll, system swipe) or
    // the pointer is otherwise lost. Without it a touch drag can end with no
    // `pointerup` at all, leaving the node stuck to the finger.
    window.addEventListener('pointercancel', endDrag);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [draggedNodeId]);

  return {
    draggedNodeId,
    isDragging: draggedNodeId !== null,
    startNodeDrag,
    screenToSvg,
    cancelDrag,
  };
}
