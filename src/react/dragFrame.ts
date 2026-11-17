/**
 * Pure helpers for the live-growth drag frame (ADR-100, amended by #104).
 *
 * Kept out of the renderer so they can be unit-tested without a DOM layout.
 */

/**
 * In zoom-to-fit, dragging outward grows the frame, which shrinks the scale,
 * which maps the same pointer position further out. The loop settles while the
 * pointer is well inside the container and runs away as it nears the edge, so
 * frame growth is paused while the pointer is within this many px of the
 * container's edge. It is above the playground's own padding (8px) and small
 * next to any real pane.
 */
export const GROWTH_CAP_MARGIN_PX = 48;

/**
 * Upper bound on consecutive synthetic re-maps (`remapDrag`) between two real
 * pointer moves. The pass converges geometrically while the pointer is inside
 * the container; this bounds it regardless.
 */
export const MAX_REMAP_PASSES = 24;

/** A viewport-relative rectangle. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CLIPPING = /^(auto|scroll|hidden|clip)$/;

/**
 * The rectangle the diagram scrolls inside: the nearest ancestor of `svg` that
 * clips or scrolls (`overflow-x`/`overflow-y` of auto, scroll, hidden or clip),
 * intersected with the viewport. The viewport when there is no such ancestor.
 */
export function findScrollContainerRect(svg: Element): Rect {
  const view: Rect = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let el = svg.parentElement; el; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    // `overflow` is read too, as a shorthand: happy-dom does not expand it into
    // `overflow-x`/`overflow-y`, and a browser reports the same keywords there.
    const keywords = [style.overflowX, style.overflowY, ...(style.overflow ?? '').split(/\s+/)];
    if (keywords.some((k) => CLIPPING.test(k))) {
      const r = el.getBoundingClientRect();
      return {
        left: Math.max(view.left, r.left),
        top: Math.max(view.top, r.top),
        right: Math.min(view.right, r.right),
        bottom: Math.min(view.bottom, r.bottom),
      };
    }
  }
  return view;
}

/**
 * Whether a pointer at (`x`, `y`) is within `margin` px of any edge of `rect`, or
 * outside it altogether.
 */
export function isInsideGrowthMargin(rect: Rect, x: number, y: number, margin: number): boolean {
  return x < rect.left + margin || x > rect.right - margin || y < rect.top + margin || y > rect.bottom - margin;
}

/** Whether two scales differ by more than a relative 1e-4. */
export function scaleDiffers(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-4 * Math.max(Math.abs(a), Math.abs(b));
}

/** The part of a rendered frame that fixes where the diagram origin sits. */
export interface OriginFrame {
  /** `viewBox` x/y: user-space coordinates of the frame's top-left corner. */
  viewBoxX: number;
  viewBoxY: number;
  /** Rendered px per user-space unit. */
  scale: number;
}

/**
 * Where the diagram origin (user-space 0,0) sits inside the svg's layout box, in
 * rendered px: `-viewBox{X,Y} * scale`. Top/left growth makes it larger.
 */
export function originOffset(frame: OriginFrame): { x: number; y: number } {
  // `+ 0` normalises -0 to 0.
  return { x: -frame.viewBoxX * frame.scale + 0, y: -frame.viewBoxY * frame.scale + 0 };
}

/**
 * How far the diagram origin moved on screen between two committed frames, in
 * rendered px. Positive means right/down, so a host that scrolls by the same
 * amounts keeps the origin still. `null` when it did not move (always the case
 * for bottom/right-only changes).
 */
export function originShift(prev: OriginFrame, cur: OriginFrame): { dx: number; dy: number } | null {
  const a = originOffset(prev);
  const b = originOffset(cur);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx === 0 && dy === 0 ? null : { dx, dy };
}
