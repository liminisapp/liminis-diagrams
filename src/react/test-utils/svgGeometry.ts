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
 *  - `centred`: the SVG is centred in a pane on both axes with `margin: auto`
 *    semantics (offset `(pane - size) / 2`, never negative). This is the
 *    playground as it was before #100, and the layout that exposed the bug.
 *  - `top-left`: the SVG sits at the pane's top-left, shifted by the container's
 *    scroll position. This is how a typical host embeds it.
 */

export type HostLayout =
  | { mode: 'centred'; paneWidth: number; paneHeight: number }
  | { mode: 'top-left'; scrollLeft?: number; scrollTop?: number };

interface Affine {
  a: number;
  d: number;
  e: number;
  f: number;
}

export interface SvgGeometry {
  /** Replace the modelled host layout (for example to add a pre-scroll). */
  setHost(host: HostLayout): void;
  /** The screen-to-SVG affine currently in effect for `svg`. */
  ctm(svg: SVGSVGElement): Affine;
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

export function installSvgGeometry(initialHost: HostLayout): SvgGeometry {
  let host = initialHost;
  const proto = window.SVGSVGElement?.prototype as unknown as Record<string, unknown>;
  const saved = {
    createSVGPoint: proto.createSVGPoint,
    getScreenCTM: proto.getScreenCTM,
  };

  const renderedSize = (svg: SVGSVGElement) => ({
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
  });

  const ctm = (svg: SVGSVGElement): Affine => {
    const [vbX, vbY, vbW, vbH] = parseViewBox(svg);
    const { width, height } = renderedSize(svg);
    const a = width / vbW;
    const d = height / vbH;
    const [offX, offY] =
      host.mode === 'centred'
        ? [Math.max(0, (host.paneWidth - width) / 2), Math.max(0, (host.paneHeight - height) / 2)]
        : [-(host.scrollLeft ?? 0), -(host.scrollTop ?? 0)];
    // screen = a * svgX + e, where svgX = vbX maps to the SVG's own left edge.
    return { a, d, e: offX - vbX * a, f: offY - vbY * d };
  };

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
    const m = ctm(svg);
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
