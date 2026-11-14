/**
 * Headless structural edits for C4-PlantUML source.
 *
 * `applyC4Edit(source, edit)` returns new source text. An edit is always a
 * minimal *insertion* into the original text: one line (elements, relationships)
 * or one contiguous block (an empty boundary: opening line plus closing `}`),
 * inserted at a single point. No existing byte is changed, and the parsed model is never re-serialised (it is lossy — it drops
 * `Rel` technology, direction variants, comments and directives). The package
 * never writes anywhere; the host applies the returned text.
 *
 * Pure and React-free.
 */

import {
  C4_BOUNDARY_DEFAULT_LABELS,
  C4_BOUNDARY_KIND_MACRO,
  C4_DEFAULT_LABELS,
  C4_ELEMENT_KIND_MACRO,
  generateC4Alias,
  isC4AliasAvailable,
  isValidC4Alias,
  type C4AddableBoundaryKind,
  type C4AddableElementKind,
} from './alias';
import { parseC4WithSpans } from './parser';
import { isBoundary } from './types';
import type { C4SourceSpans, C4Diagram } from './types';

// =============================================================================
// EDIT TYPES
// =============================================================================

/**
 * Add a new element. Without `parent` it goes at the top level; with `parent`
 * (a boundary id) it goes inside that boundary's `{ ... }` block.
 */
export interface C4AddElementEdit {
  kind: 'add-element';
  elementKind: C4AddableElementKind;
  label: string;
  /**
   * Alias to use. Validated, never silently changed: a collision fails with
   * `alias-collision`. Omit to have one generated (returned in the result).
   */
  alias?: string;
  /** Id of the boundary to add the element inside */
  parent?: string;
  description?: string;
  /** Technology (Container and Component kinds only) */
  technology?: string;
}

/**
 * Add a new, empty boundary: an opening line `<Macro>(alias, "Label") {` and a
 * closing `}`, inserted together at one point (the one edit that inserts more
 * than a single line). Without `parent` it goes at the top level; with `parent`
 * (a boundary id) it goes inside that boundary's `{ ... }` block. Add children
 * afterwards with `add-element` / `add-boundary` using the new alias as `parent`.
 */
export interface C4AddBoundaryEdit {
  kind: 'add-boundary';
  boundaryKind: C4AddableBoundaryKind;
  label: string;
  /**
   * Alias to use. Validated, never silently changed: a collision fails with
   * `alias-collision`. Omit to have one generated (returned in the result).
   */
  alias?: string;
  /** Id of the boundary to add the new boundary inside */
  parent?: string;
}

/** Add a `Rel` between two existing elements. */
export interface C4AddRelationshipEdit {
  kind: 'add-relationship';
  sourceId: string;
  targetId: string;
  label: string;
  technology?: string;
}

/**
 * A structural edit. A discriminated union on `kind`; further members (delete,
 * rename, re-parent, edit relationship) can be added without breaking callers.
 */
export type C4Edit = C4AddElementEdit | C4AddBoundaryEdit | C4AddRelationshipEdit;

export type C4EditErrorCode =
  | 'parse-error'
  | 'unknown-parent'
  | 'unknown-endpoint'
  | 'boundary-cannot-take-children'
  | 'alias-collision'
  | 'invalid-alias'
  | 'self-relationship'
  | 'invalid-result';

export type ApplyC4EditResult =
  | {
      ok: true;
      /**
       * The new source: the original with exactly one contiguous block inserted
       * (one line, or two for `add-boundary`)
       */
      source: string;
      /** The first inserted line (without its line terminator): the opening line for a boundary */
      insertedLine: string;
      /** Every inserted line, in order (one for elements and relationships, two for a boundary) */
      insertedLines: string[];
      /** The label as written (sanitised, or the placeholder) */
      label: string;
      /** The new node's alias (add-element and add-boundary) */
      alias?: string;
    }
  | { ok: false; code: C4EditErrorCode; message: string };

// =============================================================================
// TEXT HELPERS
// =============================================================================

/**
 * Make free text safe to write inside a quoted C4-PlantUML argument.
 *
 * The parser does not un-escape, and PlantUML has no standard escape for `"`,
 * so: control characters and newlines become a space, `"` becomes `'`, and `\`
 * becomes `/` (a trailing backslash could otherwise escape the closing quote).
 */
export function sanitizeC4Text(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/"/g, "'")
    .replace(/\\/g, '/')
    .trim();
}

function quote(text: string): string {
  return `"${text}"`;
}

function detectEol(source: string): string {
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

function detectIndentUnit(lines: string[]): string {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (line.startsWith('\t')) return '\t';
    const n = /^ */.exec(line)![0].length;
    if (n > 0 && n < min) min = n;
  }
  return min === Infinity ? '  ' : ' '.repeat(min);
}

// =============================================================================
// INSERTION
// =============================================================================

interface Doc {
  source: string;
  lines: string[];
  lineStarts: number[];
  eol: string;
}

function makeDoc(source: string): Doc {
  const lines = source.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const l of lines) {
    lineStarts.push(offset);
    offset += l.length + 1;
  }
  return { source, lines, lineStarts, eol: detectEol(source) };
}

/** Insert `text` as a new line immediately before line `k` (0-based). */
function insertBeforeLine(doc: Doc, k: number, text: string): string {
  const at = doc.lineStarts[k];
  return doc.source.slice(0, at) + text + doc.eol + doc.source.slice(at);
}

/** Insert `text` as a new line immediately after line `k` (0-based). */
function insertAfterLine(doc: Doc, k: number, text: string): string {
  if (k + 1 < doc.lines.length) return insertBeforeLine(doc, k + 1, text);
  // `k` is the final, unterminated line: a pure insertion of eol + text.
  return doc.source + doc.eol + text;
}

/** Insert at the end of the text, keeping a trailing newline if there is one. */
function insertAtEnd(doc: Doc, text: string): string {
  if (doc.source === '' || doc.source.endsWith('\n')) return doc.source + text + doc.eol;
  return doc.source + doc.eol + text;
}

/** Last line index used by anything parsed (elements, close lines, rels). */
function lastContentLine(spans: C4SourceSpans): number {
  let last = -1;
  for (const e of spans.elements) last = Math.max(last, e.line, e.closeLine ?? -1);
  for (const r of spans.relationships) last = Math.max(last, r.line);
  return last;
}

/**
 * Fallback insertion for a source with nothing to anchor on: before the first
 * `@enduml` after all parsed content, else at the end of the text.
 */
function insertBeforeEndOrAtEnd(doc: Doc, spans: C4SourceSpans, text: string): string {
  for (let i = lastContentLine(spans) + 1; i < doc.lines.length; i++) {
    if (doc.lines[i].trim().startsWith('@enduml')) return insertBeforeLine(doc, i, text);
  }
  return insertAtEnd(doc, text);
}

/** Last line a top-level element occupies (its whole block, if it has one). */
function elementEndLine(spans: C4SourceSpans, index: number): number {
  const el = spans.elements[index];
  return el.closeLine ?? el.line;
}

// =============================================================================
// APPLY
// =============================================================================

function fail(code: C4EditErrorCode, message: string): ApplyC4EditResult {
  return { ok: false, code, message };
}

/**
 * Apply a structural edit to C4-PlantUML source text.
 *
 * Re-parses `source` itself, so it never trusts a renderer's snapshot. Expected
 * failures are returned, not thrown.
 */
export function applyC4Edit(source: string, edit: C4Edit): ApplyC4EditResult {
  const parsed = parseC4WithSpans(source);
  if (!parsed.diagram || parsed.errors.length > 0) {
    const first = parsed.errors[0];
    return fail(
      'parse-error',
      first ? `Source does not parse (line ${first.line}): ${first.message}` : 'Source does not parse',
    );
  }
  const doc = makeDoc(source);

  switch (edit.kind) {
    case 'add-element':
      return applyAddElement(doc, parsed.diagram, parsed.spans, edit);
    case 'add-boundary':
      return applyAddBoundary(doc, parsed.diagram, parsed.spans, edit);
    case 'add-relationship':
      return applyAddRelationship(doc, parsed.diagram, parsed.spans, edit);
    default: {
      const never: never = edit;
      return fail('parse-error', `Unknown edit kind: ${(never as { kind?: string }).kind}`);
    }
  }
}

type AliasResult = { ok: true; alias: string } | { ok: false; result: ApplyC4EditResult };

/** Validate a caller-supplied alias, or generate one. Shared by elements and boundaries. */
function resolveAlias(
  requested: string | undefined,
  label: string,
  existingIds: string[],
  fallbackKind: C4AddableElementKind | C4AddableBoundaryKind,
): AliasResult {
  if (requested === undefined) {
    return { ok: true, alias: generateC4Alias(label, existingIds, fallbackKind) };
  }
  if (!isValidC4Alias(requested)) {
    return { ok: false, result: fail('invalid-alias', `'${requested}' is not a valid C4-PlantUML identifier`) };
  }
  if (!isC4AliasAvailable(requested, existingIds)) {
    return { ok: false, result: fail('alias-collision', `Alias '${requested}' is already in use or reserved`) };
  }
  return { ok: true, alias: requested };
}

/** Where a new top-level or nested node goes, and how it is indented. */
type Placement =
  | { mode: 'before'; line: number; indent: string }
  | { mode: 'after'; line: number; indent: string }
  | { mode: 'end'; indent: string };

type PlacementResult = { ok: true; placement: Placement } | { ok: false; result: ApplyC4EditResult };

/**
 * Find the insertion point for a new element or boundary: inside `parent`'s
 * `{ ... }` block (immediately before its closing `}`), or at the top level
 * (after the last top-level element or boundary block, else before `@enduml`).
 */
function resolvePlacement(
  doc: Doc,
  diagram: C4Diagram,
  spans: C4SourceSpans,
  parent: string | undefined,
): PlacementResult {
  if (parent !== undefined) {
    const idx = diagram.elements.findIndex((e) => e.id === parent);
    if (idx === -1 || !isBoundary(diagram.elements[idx])) {
      return { ok: false, result: fail('unknown-parent', `'${parent}' is not a boundary in this diagram`) };
    }
    const span = spans.elements[idx];
    if (span.closeLine === undefined) {
      return {
        ok: false,
        result: fail(
          'boundary-cannot-take-children',
          `Boundary '${parent}' has no multi-line { ... } block to insert into`,
        ),
      };
    }
    // Indent like the last direct child; else boundary indent + one unit.
    let siblingLine = -1;
    for (const e of spans.elements) if (e.parent === parent) siblingLine = Math.max(siblingLine, e.line);
    for (const r of spans.relationships) if (r.parent === parent) siblingLine = Math.max(siblingLine, r.line);
    const indent =
      siblingLine >= 0
        ? leadingWhitespace(doc.lines[siblingLine])
        : leadingWhitespace(doc.lines[span.line]) + detectIndentUnit(doc.lines);
    return { ok: true, placement: { mode: 'before', line: span.closeLine, indent } };
  }

  // Top level: after the last top-level element or boundary.
  let anchor = -1;
  let anchorLine = -1;
  spans.elements.forEach((e, i) => {
    if (e.parent === undefined) {
      const end = elementEndLine(spans, i);
      if (end > anchor) {
        anchor = end;
        anchorLine = e.line;
      }
    }
  });
  if (anchor >= 0) {
    return { ok: true, placement: { mode: 'after', line: anchor, indent: leadingWhitespace(doc.lines[anchorLine]) } };
  }
  return { ok: true, placement: { mode: 'end', indent: '' } };
}

/** Insert `text` (one or more lines joined by the file's EOL) at a resolved placement. */
function insertAtPlacement(doc: Doc, spans: C4SourceSpans, placement: Placement, text: string): string {
  switch (placement.mode) {
    case 'before':
      return insertBeforeLine(doc, placement.line, text);
    case 'after':
      return insertAfterLine(doc, placement.line, text);
    case 'end':
      return insertBeforeEndOrAtEnd(doc, spans, text);
  }
}

function applyAddElement(
  doc: Doc,
  diagram: C4Diagram,
  spans: C4SourceSpans,
  edit: C4AddElementEdit,
): ApplyC4EditResult {
  const existingIds = diagram.elements.map((e) => e.id);
  const label = sanitizeC4Text(edit.label) || C4_DEFAULT_LABELS[edit.elementKind];

  const resolved = resolveAlias(edit.alias, label, existingIds, edit.elementKind);
  if (!resolved.ok) return resolved.result;
  const alias = resolved.alias;

  // Compose the macro line (without indentation).
  const macro = C4_ELEMENT_KIND_MACRO[edit.elementKind];
  const detail = edit.elementKind !== 'person' && edit.elementKind !== 'system' && edit.elementKind !== 'systemDb';
  const description = sanitizeC4Text(edit.description ?? '');
  const technology = detail ? sanitizeC4Text(edit.technology ?? '') : '';
  const args = [alias, quote(label)];
  if (detail) {
    if (technology || description) args.push(quote(technology));
    if (description) args.push(quote(description));
  } else if (description) {
    args.push(quote(description));
  }
  const body = `${macro}(${args.join(', ')})`;

  const placed = resolvePlacement(doc, diagram, spans, edit.parent);
  if (!placed.ok) return placed.result;
  const line = placed.placement.indent + body;
  const newSource = insertAtPlacement(doc, spans, placed.placement, line);
  return verify(newSource, diagram, { kind: 'element', alias, parent: edit.parent }, [line], label);
}

function applyAddBoundary(
  doc: Doc,
  diagram: C4Diagram,
  spans: C4SourceSpans,
  edit: C4AddBoundaryEdit,
): ApplyC4EditResult {
  const existingIds = diagram.elements.map((e) => e.id);
  const label = sanitizeC4Text(edit.label) || C4_BOUNDARY_DEFAULT_LABELS[edit.boundaryKind];

  const resolved = resolveAlias(edit.alias, label, existingIds, edit.boundaryKind);
  if (!resolved.ok) return resolved.result;
  const alias = resolved.alias;

  const macro = C4_BOUNDARY_KIND_MACRO[edit.boundaryKind];
  const placed = resolvePlacement(doc, diagram, spans, edit.parent);
  if (!placed.ok) return placed.result;
  const { indent } = placed.placement;
  const lines = [`${indent}${macro}(${alias}, ${quote(label)}) {`, `${indent}}`];
  const newSource = insertAtPlacement(doc, spans, placed.placement, lines.join(doc.eol));
  return verify(newSource, diagram, { kind: 'boundary', alias, parent: edit.parent, macro }, lines, label);
}

function applyAddRelationship(
  doc: Doc,
  diagram: C4Diagram,
  spans: C4SourceSpans,
  edit: C4AddRelationshipEdit,
): ApplyC4EditResult {
  const ids = new Set(diagram.elements.map((e) => e.id));
  for (const id of [edit.sourceId, edit.targetId]) {
    if (!ids.has(id)) return fail('unknown-endpoint', `'${id}' is not an element in this diagram`);
  }
  if (edit.sourceId === edit.targetId) {
    return fail('self-relationship', 'A relationship from an element to itself cannot be drawn');
  }

  const label = sanitizeC4Text(edit.label);
  const technology = sanitizeC4Text(edit.technology ?? '');
  const args = [edit.sourceId, edit.targetId, quote(label)];
  if (technology) args.push(quote(technology));
  const body = `Rel(${args.join(', ')})`;

  // After the last top-level Rel; else after the last top-level element.
  let anchor = -1;
  for (const r of spans.relationships) if (r.parent === undefined) anchor = Math.max(anchor, r.line);
  let anchorLine = anchor;
  if (anchor < 0) {
    spans.elements.forEach((e, i) => {
      if (e.parent === undefined) {
        const end = elementEndLine(spans, i);
        if (end > anchor) {
          anchor = end;
          anchorLine = e.line;
        }
      }
    });
  }
  let newSource: string;
  let line: string;
  if (anchor >= 0) {
    line = leadingWhitespace(doc.lines[anchorLine]) + body;
    newSource = insertAfterLine(doc, anchor, line);
  } else {
    line = body;
    newSource = insertBeforeEndOrAtEnd(doc, spans, body);
  }
  return verify(
    newSource,
    diagram,
    { kind: 'relationship', sourceId: edit.sourceId, targetId: edit.targetId },
    [line],
    label,
  );
}

/** What `verify` expects the edit to have added. */
type Expected =
  | { kind: 'element'; alias: string; parent?: string }
  | { kind: 'boundary'; alias: string; parent?: string; macro: string }
  | { kind: 'relationship'; sourceId: string; targetId: string };

/**
 * Re-parse the result and check it contains exactly the intended addition.
 * A safety net for odd source shapes (unterminated blocks, closing braces
 * sharing a line with content, …) that would otherwise misplace the line.
 */
function verify(
  newSource: string,
  before: C4Diagram,
  expected: Expected,
  insertedLines: string[],
  label: string,
): ApplyC4EditResult {
  const after = parseC4WithSpans(newSource);
  const bad = () => fail('invalid-result', 'The edit could not be inserted cleanly into this source');
  if (!after.diagram || after.errors.length > 0) return bad();
  const ok = (alias?: string): ApplyC4EditResult => ({
    ok: true,
    source: newSource,
    insertedLine: insertedLines[0],
    insertedLines,
    label,
    ...(alias !== undefined ? { alias } : {}),
  });

  if (expected.kind === 'element') {
    if (after.diagram.elements.length !== before.elements.length + 1) return bad();
    const added = after.diagram.elements.find((e) => e.id === expected.alias);
    if (!added || added.parent !== expected.parent) return bad();
    return ok(expected.alias);
  }

  if (expected.kind === 'boundary') {
    const elements = after.diagram.elements;
    if (elements.length !== before.elements.length + 1) return bad();
    const idx = elements.findIndex((e) => e.id === expected.alias);
    if (idx === -1) return bad();
    const added = elements[idx];
    if (added.parent !== expected.parent || !isBoundary(added)) return bad();
    // Every pre-existing element must keep its parent: a misplaced `}` would silently re-parent siblings.
    const afterParent = new Map(elements.map((e) => [e.id, e.parent]));
    for (const e of before.elements) {
      if (!afterParent.has(e.id) || afterParent.get(e.id) !== e.parent) return bad();
    }
    // The new block is exactly its opening line and a separate closing line, and starts with the requested macro
    // (the AST cannot tell `Boundary` from `System_Boundary`, so read the source).
    const span = after.spans.elements[idx];
    if (span.closeLine !== span.line + 1) return bad();
    if (!newSource.split('\n')[span.line].trimStart().startsWith(`${expected.macro}(`)) return bad();
    return ok(expected.alias);
  }

  if (after.diagram.relationships.length !== before.relationships.length + 1) return bad();
  // The new relationship may land anywhere in parse order (boundary relationships can follow
  // it), so look for an index whose removal leaves exactly the original relationships.
  const same = (a: { sourceId: string; targetId: string; label: string }, b: typeof a) =>
    a.sourceId === b.sourceId && a.targetId === b.targetId && a.label === b.label;
  const afterRels = after.diagram.relationships;
  const inserted = afterRels.some(
    (r, k) =>
      r.sourceId === expected.sourceId &&
      r.targetId === expected.targetId &&
      afterRels.filter((_, i) => i !== k).every((o, i) => same(o, before.relationships[i])),
  );
  if (!inserted) return bad();
  return ok();
}
