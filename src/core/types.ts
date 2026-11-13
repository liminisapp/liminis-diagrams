/**
 * Type definitions for the C4 architecture diagram plugin.
 * Defines AST nodes for parsed C4 DSL and layout types for rendering.
 */

// =============================================================================
// C4 ELEMENT TYPES
// =============================================================================

/**
 * Type of C4 element in the diagram
 */
export type C4ElementType = 'system' | 'container' | 'component' | 'person';

/**
 * Shape override for C4 elements (e.g., cylinder for databases)
 */
export type C4Shape = 'rectangle' | 'cylinder' | 'queue';

/**
 * Layout direction for element groupings
 */
export type C4Direction = 'right' | 'down' | 'left' | 'up';

/**
 * Style modifier for elements (boundary creates dotted enclosure)
 */
export type C4Style = 'boundary';

/**
 * Properties that can be attached to any C4 element
 */
export interface C4Properties {
  /** Technology stack (e.g., "React, TypeScript") */
  tech?: string;
  /** Description of the element's purpose */
  description?: string;
  /** Whether this is an external system */
  external?: boolean;
  /** Shape override (e.g., cylinder for databases) */
  shape?: C4Shape;
  /** Layout direction for children */
  direction?: C4Direction;
  /** Style modifier (boundary for dotted enclosure) */
  style?: C4Style;
}

/**
 * Core C4 element representing systems, containers, components, or persons.
 * Elements can be nested (e.g., containers within systems).
 */
export interface C4Element {
  /** Type of C4 element */
  type: C4ElementType;
  /** Unique identifier for this element (from [id] in DSL) */
  id: string;
  /** Human-readable name (from "Name" in DSL) */
  name: string;
  /** Element properties */
  properties: C4Properties;
  /** Nested child elements */
  children: C4Element[];
  /** Parent element id, if nested */
  parent?: string;
}

/**
 * Relationship between two C4 elements (arrow in diagram)
 */
export interface C4Relationship {
  /** Source element id */
  sourceId: string;
  /** Target element id */
  targetId: string;
  /** Relationship label (e.g., "JSON/HTTPS", "SQL/TCP") */
  label: string;
}

/**
 * Complete C4 diagram AST
 */
export interface C4Diagram {
  /** All elements in the diagram (flat list, nesting via parent field) */
  elements: C4Element[];
  /** All relationships between elements */
  relationships: C4Relationship[];
  /** Layout direction from LAYOUT_* directive */
  direction?: C4Direction;
}

// =============================================================================
// LAYOUT TYPES
// =============================================================================

/**
 * 2D point for edge routing
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Positioned node after layout calculation
 */
export interface LayoutNode {
  /** Element id */
  id: string;
  /** X position (left edge) */
  x: number;
  /** Y position (top edge) */
  y: number;
  /** Node width */
  width: number;
  /** Node height */
  height: number;
  /** Reference to the C4 element */
  element: C4Element;
  /** Child nodes (for nested layout) */
  children?: LayoutNode[];
}

/**
 * Routed edge between two nodes
 */
export interface LayoutEdge {
  /** Source node id */
  source: string;
  /** Target node id */
  target: string;
  /** Points defining the edge path */
  points: Point[];
  /** Edge label */
  label: string;
}

/**
 * Complete layout result ready for rendering
 */
export interface LayoutResult {
  /** Positioned nodes */
  nodes: LayoutNode[];
  /** Routed edges */
  edges: LayoutEdge[];
  /** Total diagram width */
  width: number;
  /** Total diagram height */
  height: number;
  /** ViewBox origin X (non-zero when nodes have negative coordinates) */
  viewBoxX: number;
  /** ViewBox origin Y (non-zero when nodes have negative coordinates) */
  viewBoxY: number;
}

/**
 * Options for layout calculation
 */
export interface LayoutOptions {
  /** Base width for nodes (default: 200) */
  nodeWidth?: number;
  /** Base height for nodes (default: 80) */
  nodeHeight?: number;
  /** Padding around nested elements (default: 20) */
  nodePadding?: number;
  /** Vertical separation between ranks (default: 80) */
  rankSep?: number;
  /** Horizontal separation between edges (default: 20) */
  edgeSep?: number;
}

// =============================================================================
// PARSER TYPES
// =============================================================================

/**
 * Parse error with location information
 */
export interface ParseError {
  /** Error message */
  message: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (1-indexed) */
  column: number;
}

/**
 * Result of parsing C4 DSL code
 */
export interface ParseResult {
  /** Parsed diagram (null if parsing failed) */
  diagram: C4Diagram | null;
  /** Parse errors (empty if successful) */
  errors: ParseError[];
}

/**
 * Where an element sits in the source text. Lines are 0-based.
 */
export interface ElementSpan {
  /** Line of the macro call (for a boundary, the line carrying the `{`) */
  line: number;
  /**
   * Line of the closing `}`, only for a boundary whose `{ ... }` block was
   * opened on the macro line and closed on a later line.
   */
  closeLine?: number;
  /** Id of the enclosing boundary, undefined at the top level */
  parent?: string;
}

/**
 * Where a relationship sits in the source text. Lines are 0-based.
 */
export interface RelationshipSpan {
  line: number;
  /** Id of the enclosing boundary, undefined at the top level */
  parent?: string;
}

/**
 * Source locations parallel to a `C4Diagram`: `elements[i]` describes
 * `diagram.elements[i]`, `relationships[i]` describes `diagram.relationships[i]`.
 */
export interface C4SourceSpans {
  elements: ElementSpan[];
  relationships: RelationshipSpan[];
}

/**
 * `ParseResult` plus source spans, from `parseC4WithSpans`.
 */
export interface ParseResultWithSpans extends ParseResult {
  spans: C4SourceSpans;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if an element is a system
 */
export function isSystem(element: C4Element): boolean {
  return element.type === 'system';
}

/**
 * Check if an element is a container
 */
export function isContainer(element: C4Element): boolean {
  return element.type === 'container';
}

/**
 * Check if an element is a component
 */
export function isComponent(element: C4Element): boolean {
  return element.type === 'component';
}

/**
 * Check if an element is a person
 */
export function isPerson(element: C4Element): boolean {
  return element.type === 'person';
}

/**
 * Check if an element is external
 */
export function isExternal(element: C4Element): boolean {
  return element.properties.external === true;
}

/**
 * Check if an element has boundary style
 */
export function isBoundary(element: C4Element): boolean {
  return element.properties.style === 'boundary';
}

// =============================================================================
// MANUAL LAYOUT TYPES
// =============================================================================

/**
 * Manual layout data for user-positioned diagram elements.
 * When present, positions are user-defined instead of computed by dagre.
 */
export interface ManualLayout {
  /** Element positions keyed by element ID */
  positions: Record<string, { x: number; y: number }>;
}
