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
export { applyC4Edit, sanitizeC4Text } from './core/edit';
export type {
  C4Edit,
  C4AddElementEdit,
  C4AddRelationshipEdit,
  C4EditErrorCode,
  ApplyC4EditResult,
} from './core/edit';
export {
  generateC4Alias,
  isValidC4Alias,
  isC4AliasAvailable,
  C4_ADDABLE_ELEMENT_KINDS,
  C4_ELEMENT_KIND_MACRO,
  C4_DEFAULT_LABELS,
  C4_ADDABLE_BOUNDARY_KINDS,
  C4_BOUNDARY_KIND_MACRO,
  C4_BOUNDARY_DEFAULT_LABELS,
  C4_DEFAULT_RELATIONSHIP_LABEL,
  C4_RESERVED_LEGEND_ID,
} from './core/alias';
export type { C4AddableElementKind, C4AddableBoundaryKind } from './core/alias';
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
