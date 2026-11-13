/**
 * `@liminis/diagrams/core` — the React-free surface.
 *
 * Parse C4-PlantUML source into a diagram AST and lay it out. `@dagrejs/dagre`
 * is the only runtime dependency of anything reachable from here: no React, no
 * DOM globals, no `document`/`window`. That is what makes this entry usable from
 * a CLI, a CI job, or a worker with nothing else installed.
 *
 * Note that SVG *rendering* is not here — `renderC4DiagramToSVG` is DOM-free but
 * not React-free (it goes through `renderToStaticMarkup`), so it ships from
 * `@liminis/diagrams/server`. See docs/EXTRACTION-PLAN.md §2.
 */

export { parseC4, parseC4WithSpans, validateC4 } from './core/parser';
export { layoutC4Diagram } from './core/layout';
export { buildClippedEdgePaths, estimateLabelSize } from './core/edge-clipping';
export {
  isSystem,
  isContainer,
  isComponent,
  isPerson,
  isExternal,
  isBoundary,
} from './core/types';
export type {
  C4ElementType,
  C4Shape,
  C4Direction,
  C4Style,
  C4Properties,
  C4Element,
  C4Relationship,
  C4Diagram,
  Point,
  LayoutNode,
  LayoutEdge,
  LayoutResult,
  LayoutOptions,
  ParseError,
  ParseResult,
  ManualLayout,
  ElementSpan,
  RelationshipSpan,
  C4SourceSpans,
  ParseResultWithSpans,
} from './core/types';
