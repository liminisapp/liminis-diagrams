/**
 * useC4LongPress - hold a pointer still for a moment to fire a callback.
 *
 * Touch has no right-click, and Safari does not reliably fire `contextmenu` on a
 * long-press, so the add-element menu needs its own. Built on pointer events like
 * every other gesture here (see `useC4DiagramDrag`): one pointer owns the press,
 * movement past the tolerance abandons it (so a drag never opens a menu), and
 * `pointercancel` abandons it too, leaving no timer behind.
 *
 * Mouse is excluded on purpose — it has a right button — and so is a
 * non-primary pointer: a second finger is not a press.
 *
 * It only listens; it does not stop the pointerdown. The caller decides where a
 * press may start (`shouldStart`) and what to do when it fires.
 */

import { useCallback, useEffect, useRef } from 'react';

/** How long the pointer must be held, in ms. */
export const LONG_PRESS_DELAY_MS = 500;
/** How far the pointer may drift, in client px, before it stops being a press. */
export const LONG_PRESS_MOVE_TOLERANCE = 8;

export interface UseC4LongPressProps {
  enabled: boolean;
  /** Whether a press starting at this event may become a long-press */
  shouldStart: (e: React.PointerEvent) => boolean;
  /** Fired once the delay elapses with the pointer still down and still */
  onLongPress: (e: { clientX: number; clientY: number; pointerId: number }) => void;
  delayMs?: number;
  moveTolerance?: number;
}

export function useC4LongPress({
  enabled,
  shouldStart,
  onLongPress,
  delayMs = LONG_PRESS_DELAY_MS,
  moveTolerance = LONG_PRESS_MOVE_TOLERANCE,
}: UseC4LongPressProps): { onPointerDownCapture: (e: React.PointerEvent) => void } {
  const shouldStartRef = useRef(shouldStart);
  shouldStartRef.current = shouldStart;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  // Tears down the press in flight (timer and window listeners), if any.
  const cancelRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  const onPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      // A second pointer is not a press, and neither is anything while one is pending.
      if (cancelRef.current !== null) {
        cancel();
        return;
      }
      if (e.pointerType === 'mouse' || !e.isPrimary || e.button > 0) return;
      if (!shouldStartRef.current(e)) return;

      const { pointerId, clientX: startX, clientY: startY } = e;

      const onMove = (m: PointerEvent) => {
        if (m.pointerId !== pointerId) return;
        if (Math.hypot(m.clientX - startX, m.clientY - startY) > moveTolerance) cancel();
      };
      const onEnd = (u: PointerEvent) => {
        if (u.pointerId === pointerId) cancel();
      };
      const timer = setTimeout(() => {
        cancel();
        onLongPressRef.current({ clientX: startX, clientY: startY, pointerId });
      }, delayMs);

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
      cancelRef.current = () => {
        clearTimeout(timer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      };
    },
    [enabled, delayMs, moveTolerance, cancel],
  );

  // Disabled or unmounted mid-press: leave nothing running.
  useEffect(() => {
    if (!enabled) cancel();
    return cancel;
  }, [enabled, cancel]);

  return { onPointerDownCapture };
}
