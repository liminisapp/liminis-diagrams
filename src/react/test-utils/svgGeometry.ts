/**
 * A screen-geometry model for the `<svg>` in happy-dom tests.
 *
 * happy-dom implements no SVG geometry, and the identity `getScreenCTM` stubs the
 * older tests use cannot fail when the SVG moves or changes size on screen — which
 * is exactly the class of bug issue #100 was (a canvas that grew mid-drag shifted
 * the SVG inside a centring pane, so a node tracked in SVG space drifted from the
 * pointer). This stub computes the CTM *live* from the rendered `<svg>`'s `width`,
 * `height` and `viewBox` attributes plus a modelled host container, so any change
 * to those during a drag is visible to the coordinate maths.
 *
 * Host layouts:
 *  - `centred`: the SVG is centred in a pane on both axes (offset
 *    `(pane - size) / 2`, never negative). This is the playground as it was
 *    before #100, and the editor's `justify-content: center` column host.
 *  - `centred-x`: centred horizontally only, pinned to the top. This is the
 *    playground now (`margin: 0 auto`).
 *  - `top-left`: the SVG sits at the pane's top-left, shifted by the container's
 *    scroll position. This is how a typical host embeds it.
 *
 * CSS transform (ADR-100, amended by #104): the renderer holds the diagram origin
 * still during a drag by setting `transform: translate(Xpx, Ypx)` on the `<svg>`.
 * The stub reads it from `svg.style.transform` and adds it to the SVG's screen
 * position, because a transform moves what is painted without affecting layout
 * (so the host offsets above ignore it). Engines disagree on whether
 * `getScreenCTM()` includes such a transform; `ctmIncludesTransform: false` models
 * one that does not. `nodeScreenPos` always includes it: it is the true,
 * painted position, which is what the user sees and what the tests assert.
 */

export type HostLayout =
  | { mode: 'centred'; paneWidth: number; paneHeight: number }
  | { mode: 'centred-x'; paneWidth: number }
  | { mode: 'top-left'; scrollLeft?: number; scrollTop?: number };

export interface SvgGeometryOptions {
  /** Whether `getScreenCTM()` includes the CSS transform (default true). */
  ctmIncludesTransform?: boolean;
}

interface Affine {
  a: number;
  d: number;
  e: number;
  f: number;
}

export interface SvgGeometry {
  /** Replace the modelled host layout (for example to add a pre-scroll). */
  setHost(host: HostLayout): void;
  /** The screen-to-SVG affine as `getScreenCTM()` reports it for `svg`. */
  ctm(svg: SVGSVGElement): Affine;
  /** The translation currently applied to `svg` by its CSS transform. */
  transformOf(svg: SVGSVGElement): { x: number; y: number };
  /** Screen (client) position of the top-left of the hit rect for `nodeId`. */
  nodeScreenPos(container: HTMLElement, nodeId: string): { x: number; y: number };
  /** Rendered size of the svg on screen, in px. */
  renderedSize(svg: SVGSVGElement): { width: number; height: number };
  /** Every hit-rect id mapped to its current screen position. */
  allScreenPositions(container: HTMLElement): Record<string, { x: number; y: number }>;
  restore(): void;
}

function parseViewBox(svg: SVGSVGElement): [number, number, number, number] {
  const parts = (svg.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number);
  return [parts[0], parts[1], parts[2], parts[3]];
}

function parseTranslate(svg: SVGSVGElement): { x: number; y: number } {
  const m = /translate\(\s*(-?[\d.e+-]+)(?:px)?\s*,\s*(-?[\d.e+-]+)(?:px)?\s*\)/.exec(svg.style.transform ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

export function installSvgGeometry(
  initialHost: HostLayout,
  options: SvgGeometryOptions = {},
): SvgGeometry {
  let host = initialHost;
  const ctmIncludesTransform = options.ctmIncludesTransform ?? true;
  const proto = window.SVGSVGElement?.prototype as unknown as Record<string, unknown>;
  const saved = {
    createSVGPoint: proto.createSVGPoint,
    getScreenCTM: proto.getScreenCTM,
  };

  const renderedSize = (svg: SVGSVGElement) => ({
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
  });

  const affine = (svg: SVGSVGElement, withTransform: boolean): Affine => {
    const [vbX, vbY, vbW, vbH] = parseViewBox(svg);
    const { width, height } = renderedSize(svg);
    const a = width / vbW;
    const d = height / vbH;
    let offX: number;
    let offY: number;
    if (host.mode === 'centred') {
      offX = Math.max(0, (host.paneWidth - width) / 2);
      offY = Math.max(0, (host.paneHeight - height) / 2);
    } else if (host.mode === 'centred-x') {
      offX = Math.max(0, (host.paneWidth - width) / 2);
      offY = 0;
    } else {
      offX = -(host.scrollLeft ?? 0);
      offY = -(host.scrollTop ?? 0);
    }
    if (withTransform) {
      const t = parseTranslate(svg);
      offX += t.x;
      offY += t.y;
    }
    // screen = a * svgX + e, where svgX = vbX maps to the SVG's own left edge.
    return { a, d, e: offX - vbX * a, f: offY - vbY * d };
  };

  /** What `getScreenCTM()` reports. */
  const ctm = (svg: SVGSVGElement): Affine => affine(svg, ctmIncludesTransform);

  const inverseOf = (m: Affine) => ({
    a: 1 / m.a,
    d: 1 / m.d,
    e: -m.e / m.a,
    f: -m.f / m.d,
  });

  proto.getScreenCTM = function getScreenCTM(this: SVGSVGElement) {
    const m = ctm(this);
    return { ...m, b: 0, c: 0, inverse: () => inverseOf(m) };
  };
  proto.createSVGPoint = function createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform(m: Affine) {
        return { x: m.a * this.x + m.e, y: m.d * this.y + m.f };
      },
    };
  };

  const nodeScreenPos = (container: HTMLElement, nodeId: string) => {
    const svg = container.querySelector('svg') as unknown as SVGSVGElement;
    const rect = container.querySelector(`[data-node-id="${nodeId}"]`)!;
    // The painted position: always includes the transform.
    const m = affine(svg, true);
    return {
      x: m.a * Number(rect.getAttribute('x')) + m.e,
      y: m.d * Number(rect.getAttribute('y')) + m.f,
    };
  };

  return {
    setHost(next) {
      host = next;
    },
    ctm,
    transformOf: parseTranslate,
    nodeScreenPos,
    renderedSize,
    allScreenPositions(container) {
      const out: Record<string, { x: number; y: number }> = {};
      for (const el of Array.from(container.querySelectorAll('[data-node-id]'))) {
        const id = el.getAttribute('data-node-id')!;
        out[id] = nodeScreenPos(container, id);
      }
      return out;
    },
    restore() {
      proto.createSVGPoint = saved.createSVGPoint;
      proto.getScreenCTM = saved.getScreenCTM;
    },
  };
}
