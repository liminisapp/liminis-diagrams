/**
 * C4-PlantUML Parser
 *
 * Parses C4-PlantUML macro syntax into a C4 diagram AST.
 * Supports: Person, System, Container, Component (and _Ext, Db, Queue variants),
 * System_Boundary, Container_Boundary, Rel (and directional variants), BiRel.
 *
 * Strips: @startuml/@enduml, !include, SHOW_LEGEND(), LAYOUT_* directives.
 */

import type {
  C4Diagram,
  C4Direction,
  C4Element,
  C4ElementType,
  C4Properties,
  C4Relationship,
  C4Shape,
  C4SourceSpans,
  ElementSpan,
  LabelRange,
  ParseError,
  ParseResult,
  ParseResultWithSpans,
  RelationshipSpan,
} from './types';

// =============================================================================
// ELEMENT MACRO CLASSIFICATION
// =============================================================================

interface MacroInfo {
  type: C4ElementType;
  external: boolean;
  shape: C4Shape;
  /** Argument order: 'system' = (alias, label, desc), 'detail' = (alias, label, tech, desc) */
  argStyle: 'system' | 'detail';
  /** Whether this is a boundary (children expected) */
  boundary: boolean;
}

const ELEMENT_MACROS: Record<string, MacroInfo> = {
  // Person
  Person:     { type: 'person', external: false, shape: 'rectangle', argStyle: 'system', boundary: false },
  Person_Ext: { type: 'person', external: true,  shape: 'rectangle', argStyle: 'system', boundary: false },

  // System
  System:       { type: 'system', external: false, shape: 'rectangle', argStyle: 'system', boundary: false },
  System_Ext:   { type: 'system', external: true,  shape: 'rectangle', argStyle: 'system', boundary: false },
  SystemDb:     { type: 'system', external: false, shape: 'cylinder',  argStyle: 'system', boundary: false },
  SystemDb_Ext: { type: 'system', external: true,  shape: 'cylinder',  argStyle: 'system', boundary: false },
  SystemQueue:     { type: 'system', external: false, shape: 'queue', argStyle: 'system', boundary: false },
  SystemQueue_Ext: { type: 'system', external: true,  shape: 'queue', argStyle: 'system', boundary: false },

  // Container
  Container:       { type: 'container', external: false, shape: 'rectangle', argStyle: 'detail', boundary: false },
  Container_Ext:   { type: 'container', external: true,  shape: 'rectangle', argStyle: 'detail', boundary: false },
  ContainerDb:     { type: 'container', external: false, shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ContainerDb_Ext: { type: 'container', external: true,  shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ContainerQueue:     { type: 'container', external: false, shape: 'queue', argStyle: 'detail', boundary: false },
  ContainerQueue_Ext: { type: 'container', external: true,  shape: 'queue', argStyle: 'detail', boundary: false },

  // Component
  Component:       { type: 'component', external: false, shape: 'rectangle', argStyle: 'detail', boundary: false },
  Component_Ext:   { type: 'component', external: true,  shape: 'rectangle', argStyle: 'detail', boundary: false },
  ComponentDb:     { type: 'component', external: false, shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ComponentDb_Ext: { type: 'component', external: true,  shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ComponentQueue:     { type: 'component', external: false, shape: 'queue', argStyle: 'detail', boundary: false },
  ComponentQueue_Ext: { type: 'component', external: true,  shape: 'queue', argStyle: 'detail', boundary: false },

  // Boundaries
  System_Boundary:    { type: 'system',    external: false, shape: 'rectangle', argStyle: 'system', boundary: true },
  Container_Boundary: { type: 'container', external: false, shape: 'rectangle', argStyle: 'system', boundary: true },
  Enterprise_Boundary:{ type: 'system',    external: false, shape: 'rectangle', argStyle: 'system', boundary: true },
  Boundary:           { type: 'system',    external: false, shape: 'rectangle', argStyle: 'system', boundary: true },

  // Deployment nodes (C4 deployment diagrams)
  Deployment_Node:     { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Deployment_Node_L:   { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Deployment_Node_R:   { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Node:                { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Node_L:              { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Node_R:              { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },

  // Infrastructure nodes (C4 deployment diagrams)
  InfrastructureNode:      { type: 'component', external: false, shape: 'rectangle', argStyle: 'detail', boundary: false },
  InfrastructureNode_Ext:  { type: 'component', external: true,  shape: 'rectangle', argStyle: 'detail', boundary: false },
};

const REL_MACROS = new Set([
  'Rel', 'Rel_Back', 'Rel_Neighbor',
  'Rel_D', 'Rel_U', 'Rel_L', 'Rel_R',
  'BiRel', 'BiRel_D', 'BiRel_U', 'BiRel_L', 'BiRel_R',
]);

/**
 * Every macro name the parser recognises (element and relationship macros).
 * Used by alias generation to keep generated aliases clear of macro names.
 */
export const C4_MACRO_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(ELEMENT_MACROS),
  ...REL_MACROS,
]);

/** Directives and macros to silently skip */
const SKIP_PREFIXES = ['@startuml', '@enduml', '!include', '!define', 'SHOW_', 'HIDE_', 'title '];

// =============================================================================
// LINE-BASED PARSER
// =============================================================================

/**
 * Parse C4-PlantUML code into a C4 diagram AST.
 */
export function parseC4(code: string): ParseResult {
  const parser = new C4PlantUMLParser(code);
  return parser.parse();
}

/**
 * Parse C4-PlantUML code and also report where each element and relationship
 * lives in the source (0-based line numbers). `diagram` and `errors` are exactly
 * what `parseC4` returns; `spans` is a parallel structure, index-aligned with
 * `diagram.elements` / `diagram.relationships`, so the AST shape is unchanged.
 *
 * Spans exist so that edits can be made as minimal line insertions into the
 * original text (see `applyC4Edit`). On a failed parse `spans` still describes
 * whatever was recognised, but `diagram` is null.
 */
export function parseC4WithSpans(code: string): ParseResultWithSpans {
  const parser = new C4PlantUMLParser(code);
  const result = parser.parse();
  return { ...result, spans: parser.getSpans() };
}

/**
 * Validate that a C4 diagram is well-formed.
 * Checks for duplicate IDs, missing relationship targets, etc.
 */
export function validateC4(diagram: C4Diagram): ParseError[] {
  const errors: ParseError[] = [];
  const elementIds = new Set<string>();

  for (const element of diagram.elements) {
    if (elementIds.has(element.id)) {
      errors.push({
        message: `Duplicate element ID: '${element.id}'`,
        line: 0,
        column: 0,
      });
    }
    elementIds.add(element.id);
  }

  for (const rel of diagram.relationships) {
    if (!elementIds.has(rel.sourceId)) {
      errors.push({
        message: `Relationship source '${rel.sourceId}' not found`,
        line: 0,
        column: 0,
      });
    }
    if (!elementIds.has(rel.targetId)) {
      errors.push({
        message: `Relationship target '${rel.targetId}' not found`,
        line: 0,
        column: 0,
      });
    }
  }

  return errors;
}

/** One macro argument: its trimmed text and where it sits in the scanned line. */
interface ParsedArg {
  text: string;
  start: number;
  end: number;
}

class C4PlantUMLParser {
  private lines: string[];
  private lineNum: number = 0;
  private elements: C4Element[] = [];
  private relationships: C4Relationship[] = [];
  private errors: ParseError[] = [];
  private direction: C4Direction | undefined;
  private elementSpans: ElementSpan[] = [];
  private relationshipSpans: RelationshipSpan[] = [];

  constructor(code: string) {
    this.lines = code.split('\n');
  }

  parse(): ParseResult {
    this.parseLines(undefined);

    const diagram: C4Diagram = {
      elements: this.elements,
      relationships: this.relationships,
      direction: this.direction,
    };

    return {
      diagram: this.errors.length === 0 ? diagram : null,
      errors: this.errors,
    };
  }

  getSpans(): C4SourceSpans {
    return { elements: this.elementSpans, relationships: this.relationshipSpans };
  }

  /**
   * Parse lines at the current level. If parentId is set, we're inside a boundary.
   * Stops when we hit a closing brace or run out of lines.
   *
   * Returns true when it stopped on a closing brace (the block was closed), false
   * when it ran out of lines.
   */
  private parseLines(parentId: string | undefined): boolean {
    while (this.lineNum < this.lines.length) {
      const rawLine = this.lines[this.lineNum];
      const line = this.stripComment(rawLine).trim();

      // Empty or comment-only line
      if (line === '') {
        this.lineNum++;
        continue;
      }

      // Closing brace — return to parent
      if (line === '}' || line.startsWith('}')) {
        this.lineNum++;
        return true;
      }

      // Parse LAYOUT directives
      if (line.startsWith('LAYOUT_TOP_DOWN')) {
        this.direction = 'down';
        this.lineNum++;
        continue;
      }
      if (line.startsWith('LAYOUT_LEFT_RIGHT')) {
        this.direction = 'right';
        this.lineNum++;
        continue;
      }

      // Skip other directives
      if (this.isSkippable(line)) {
        this.lineNum++;
        continue;
      }

      // Extract the macro name (first word before '(')
      const macroMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
      if (!macroMatch) {
        // Unknown line
        this.errors.push({
          message: `Unrecognized syntax: '${line.slice(0, 50)}'`,
          line: this.lineNum + 1,
          column: 1,
        });
        this.lineNum++;
        continue;
      }

      const macroName = macroMatch[1];

      // Element macro
      if (macroName in ELEMENT_MACROS) {
        this.parseElementMacro(macroName, line, parentId);
        continue;
      }

      // Relationship macro
      if (REL_MACROS.has(macroName)) {
        this.parseRelMacro(line, parentId);
        this.lineNum++;
        continue;
      }

      // Unknown macro — skip
      this.errors.push({
        message: `Unknown macro: '${macroName}'`,
        line: this.lineNum + 1,
        column: 1,
      });
      this.lineNum++;
    }
    return false;
  }

  /**
   * Parse an element macro like Person(alias, "Label", "Description")
   * or a boundary like System_Boundary(alias, "Label") { ... }
   */
  private parseElementMacro(macroName: string, line: string, parentId: string | undefined): void {
    const info = ELEMENT_MACROS[macroName];
    const currentLine = this.lineNum + 1;
    const startLine = this.lineNum;

    // Extract arguments from parentheses
    const parsedArgs = this.extractArgs(line, currentLine);
    if (parsedArgs === null) {
      this.lineNum++;
      return;
    }
    const args = parsedArgs.map((a) => a.text);

    // First arg is always the alias (unquoted identifier)
    const alias = args[0]?.replace(/^"|"$/g, '');
    if (!alias) {
      this.errors.push({
        message: `${macroName}: missing alias (first argument)`,
        line: currentLine,
        column: 1,
      });
      this.lineNum++;
      return;
    }

    // Build properties from remaining args
    const properties: C4Properties = {};
    let name: string;

    if (info.external) properties.external = true;
    if (info.shape !== 'rectangle') properties.shape = info.shape;
    if (info.boundary) properties.style = 'boundary';

    if (info.argStyle === 'system') {
      // (alias, "label", "description")
      name = this.unquote(args[1] ?? '') || alias;
      const desc = this.unquote(args[2] ?? '');
      if (desc) properties.description = desc;
    } else {
      // (alias, "label", "technology", "description")
      name = this.unquote(args[1] ?? '') || alias;
      const tech = this.unquote(args[2] ?? '');
      const desc = this.unquote(args[3] ?? '');
      if (tech) properties.tech = tech;
      if (desc) properties.description = desc;
    }

    // Check for $tags and other named params
    for (const arg of args) {
      if (arg.startsWith('$tags=')) {
        // Could be used for styling in the future
      }
    }

    const element: C4Element = {
      type: info.type,
      id: alias,
      name,
      properties,
      children: [],
      parent: parentId,
    };

    this.elements.push(element);
    const span: ElementSpan = { line: startLine };
    if (parentId !== undefined) span.parent = parentId;
    const labelRange = this.labelRangeOf(parsedArgs[1], this.lines[startLine]);
    if (labelRange) span.labelRange = labelRange;
    this.elementSpans.push(span);

    // A boundary opens a block with a '{' (outside quotes) and no '}' on the line.
    // Leaf elements never open a block, whatever their label contains.
    const hasBrace = info.boundary && this.opensBlock(line);

    if (hasBrace) {
      this.lineNum++;
      // Parse children
      const childrenBefore = this.elements.length;
      const closed = this.parseLines(alias);
      if (closed) span.closeLine = this.lineNum - 1;
      // Link children
      for (let i = childrenBefore; i < this.elements.length; i++) {
        if (this.elements[i].parent === alias) {
          element.children.push(this.elements[i]);
        }
      }
    } else {
      this.lineNum++;
    }
  }

  /**
   * Parse a relationship macro like Rel(from, to, "label", "tech")
   */
  private parseRelMacro(line: string, parentId: string | undefined): void {
    const startLine = this.lineNum;
    const currentLine = this.lineNum + 1;
    const parsedArgs = this.extractArgs(line, currentLine);
    if (parsedArgs === null) return;
    const args = parsedArgs.map((a) => a.text);

    if (args.length < 3) {
      this.errors.push({
        message: `Relationship requires at least 3 arguments (from, to, label)`,
        line: currentLine,
        column: 1,
      });
      return;
    }

    const sourceId = args[0].replace(/^"|"$/g, '');
    const targetId = args[1].replace(/^"|"$/g, '');
    const label = this.unquote(args[2]);
    const tech = this.unquote(args[3] ?? '');

    const fullLabel = tech ? `${label} [${tech}]` : label;

    const relationship: C4Relationship = {
      sourceId,
      targetId,
      label: fullLabel,
    };
    if (tech) relationship.technology = tech;
    this.relationships.push(relationship);
    const span: RelationshipSpan = { line: startLine };
    if (parentId !== undefined) span.parent = parentId;
    const labelRange = this.labelRangeOf(parsedArgs[2], this.lines[startLine]);
    if (labelRange) span.labelRange = labelRange;
    this.relationshipSpans.push(span);
  }

  /**
   * Extract comma-separated arguments from a macro call.
   * Handles quoted strings with commas inside them. Each argument carries its
   * character range within `line`.
   */
  private extractArgs(line: string, lineNum: number): ParsedArg[] | null {
    // Find opening paren
    const openIdx = line.indexOf('(');
    if (openIdx === -1) {
      this.errors.push({
        message: `Expected '(' in macro call`,
        line: lineNum,
        column: 1,
      });
      return null;
    }

    // Find matching closing paren (handle nested parens in edge cases).
    // Parentheses inside quoted strings are part of the text, not structure.
    let depth = 0;
    let closeIdx = -1;
    let inQuote = false;
    for (let i = openIdx; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '\\') i++;
        else if (ch === '"') inQuote = false;
        continue;
      }
      if (ch === '"') inQuote = true;
      else if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }

    if (closeIdx === -1) {
      this.errors.push({
        message: `Unmatched '(' — missing closing ')'`,
        line: lineNum,
        column: openIdx + 1,
      });
      return null;
    }

    const inner = line.slice(openIdx + 1, closeIdx);
    return this.splitArgs(inner, openIdx + 1);
  }

  /**
   * Split a comma-separated argument string, respecting quoted strings.
   * Empty arguments are dropped. `base` is the offset of `inner` within the
   * line, so each argument's `start`/`end` are line offsets of its trimmed text.
   */
  private splitArgs(inner: string, base: number): ParsedArg[] {
    const args: ParsedArg[] = [];
    let inQuote = false;
    let escaped = false;
    let chunkStart = 0;

    const flush = (chunkEnd: number) => {
      const chunk = inner.slice(chunkStart, chunkEnd);
      const text = chunk.trim();
      if (!text) return;
      const lead = chunk.length - chunk.trimStart().length;
      args.push({
        text,
        start: base + chunkStart + lead,
        end: base + chunkStart + lead + text.length,
      });
    };

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (char === ',' && !inQuote) {
        flush(i);
        chunkStart = i + 1;
      }
    }
    flush(inner.length);

    return args;
  }

  /**
   * The raw-line character range of a label argument, or undefined when there
   * is none or it is a `$named` argument (replacing it would drop the keyword).
   * `line` is the comment-stripped, trimmed line the arguments were scanned in;
   * it starts after the raw line's leading whitespace.
   */
  private labelRangeOf(arg: ParsedArg | undefined, rawLine: string): LabelRange | undefined {
    if (!arg || arg.text.startsWith('$')) return undefined;
    const lead = rawLine.length - rawLine.trimStart().length;
    return { start: lead + arg.start, end: lead + arg.end };
  }

  /**
   * True when the line has a '{' outside quotes and no '}' outside quotes.
   */
  private opensBlock(line: string): boolean {
    let inQuote = false;
    let open = false;
    let close = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '\\') i++;
        else if (ch === '"') inQuote = false;
        continue;
      }
      if (ch === '"') inQuote = true;
      else if (ch === '{') open = true;
      else if (ch === '}') close = true;
    }
    return open && !close;
  }

  /**
   * Remove surrounding quotes from a string argument.
   */
  private unquote(s: string): string {
    s = s.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1);
    }
    return s;
  }

  /**
   * Strip single-line comment (C4-PlantUML uses ' for comments)
   */
  private stripComment(line: string): string {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuote = !inQuote;
      if (line[i] === '\'' && !inQuote) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  /**
   * Check if a line should be silently skipped (directives, etc.)
   */
  private isSkippable(line: string): boolean {
    return SKIP_PREFIXES.some((p) => line.startsWith(p));
  }
}
