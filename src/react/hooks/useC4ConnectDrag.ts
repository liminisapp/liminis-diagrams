/**
 * useC4ConnectDrag - Hook for the "drag from one element to another" gesture.
 *
 * Mirrors `useC4DiagramDrag` and for the same reasons (see the header there):
 * pointer events only, window-level listeners while the gesture is active, a
 * pointer-id owner so a second finger cannot hijack or end it, a CTM captured at
 * the start so the mapping cannot drift mid-gesture, and `pointercancel`
 * aborting cleanly. The difference is the ending: a connect gesture reports
 * where the pointer was released, and a cancelled one reports nothing at all.
 *
 * It does not decide what the release point means — the caller resolves the
 * target — and it does not know about move-drag. `canStart` is how the caller
 * keeps the two gestures mutually exclusive.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Point } from '../../core/types';

export interface UseC4ConnectDragProps {
  svgRef: RefObject<SVGSVGElement | null>;
  /** Whether the gesture is enabled at all */
  enabled: boolean;
  /**
   * Checked at the start of every gesture. Return false while another gesture
   * (move, placement, an open label input) owns the pointer.
   */
  canStart?: () => boolean;
  /** Fired on release (not on cancel) with the SVG-space release point */
  onConnect: (sourceId: string, point: Point) => void;
}

export interface UseC4ConnectDragReturn {
  /** Element the gesture started from, or null when idle */
  connectSourceId: string | null;
  /** Current pointer position in SVG space while connecting, else null */
  connectPointer: Point | null;
  /** Begin a connect gesture from a node */
  startConnect: (sourceId: string, e: React.PointerEvent) => void;
}

export function useC4ConnectDrag({
  svgRef,
  enabled,
  canStart,
  onConnect,
}: UseC4ConnectDragProps): UseC4ConnectDragReturn {
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [connectPointer, setConnectPointer] = useState<Point | null>(null);

  const sourceRef = useRef<string | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lockedCtmInverseRef = useRef<DOMMatrix | null>(null);

  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;
  const canStartRef = useRef(canStart);
  canStartRef.current = canStart;

  const toSvg = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const inverse = lockedCtmInverseRef.current ?? svg.getScreenCTM()?.inverse();
      if (!inverse) return null;
      const p = point.matrixTransform(inverse);
      return { x: p.x, y: p.y };
    },
    [svgRef],
  );
  const toSvgRef = useRef(toSvg);
  toSvgRef.current = toSvg;

  const reset = useCallback(() => {
    sourceRef.current = null;
    activePointerIdRef.current = null;
    lockedCtmInverseRef.current = null;
    setConnectSourceId(null);
    setConnectPointer(null);
  }, []);

  const startConnect = useCallback(
    (sourceId: string, e: React.PointerEvent) => {
      if (!enabled) return;
      // One gesture at a time: a pointerdown while one is active is a second finger.
      if (sourceRef.current !== null) return;
      if (canStartRef.current && !canStartRef.current()) return;

      e.stopPropagation();
      e.preventDefault();

      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      lockedCtmInverseRef.current = ctm ? ctm.inverse() : null;

      const start = toSvg(e.clientX, e.clientY);
      if (!start) {
        lockedCtmInverseRef.current = null;
        return;
      }

      activePointerIdRef.current = e.pointerId;
      sourceRef.current = sourceId;
      setConnectSourceId(sourceId);
      setConnectPointer(start);
    },
    [enabled, svgRef, toSvg],
  );

  useEffect(() => {
    if (!connectSourceId) return;

    const handleMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerIdRef.current) return;
      const p = toSvgRef.current(e.clientX, e.clientY);
      if (p) setConnectPointer(p);
    };

    const handleUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerIdRef.current) return;
      const source = sourceRef.current;
      const p = toSvgRef.current(e.clientX, e.clientY);
      reset();
      if (source && p) onConnectRef.current(source, p);
    };

    // The browser took the gesture over (scroll, system swipe) or the pointer
    // was lost: abort, report nothing, leave nothing stuck.
    const handleCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerIdRef.current) return;
      reset();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };
  }, [connectSourceId, reset]);

  // Disabled mid-gesture (edit mode switched off): drop it.
  useEffect(() => {
    if (!enabled && sourceRef.current !== null) reset();
  }, [enabled, reset]);

  return { connectSourceId, connectPointer, startConnect };
}
