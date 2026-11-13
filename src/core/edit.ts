/**
 * Headless structural edits for C4-PlantUML source.
 *
 * `applyC4Edit(source, edit)` returns new source text. An edit is always a
 * minimal line-level *insertion* into the original text: no existing byte is
 * changed, and the parsed model is never re-serialised (it is lossy — it drops
 * `Rel` technology, direction variants, comments and directives). The package
 * never writes anywhere; the host applies the returned text.
 *
 * Pure and React-free.
 */

import {
  C4_DEFAULT_LABELS,
  C4_ELEMENT_KIND_MACRO,
  generateC4Alias,
  isC4AliasAvailable,
  isValidC4Alias,
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
export type C4Edit = C4AddElementEdit | C4AddRelationshipEdit;

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
      /** The new source: the original with exactly one line inserted */
      source: string;
      /** The line that was inserted (without its line terminator) */
      insertedLine: string;
      /** The label as written (sanitised, or the placeholder) */
      label: string;
      /** The element's alias (add-element only) */
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
    case 'add-relationship':
      return applyAddRelationship(doc, parsed.diagram, parsed.spans, edit);
    default: {
      const never: never = edit;
      return fail('parse-error', `Unknown edit kind: ${(never as { kind?: string }).kind}`);
    }
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

  let alias: string;
  if (edit.alias !== undefined) {
    if (!isValidC4Alias(edit.alias)) {
      return fail('invalid-alias', `'${edit.alias}' is not a valid C4-PlantUML identifier`);
    }
    if (!isC4AliasAvailable(edit.alias, existingIds)) {
      return fail('alias-collision', `Alias '${edit.alias}' is already in use or reserved`);
    }
    alias = edit.alias;
  } else {
    alias = generateC4Alias(label, existingIds, edit.elementKind);
  }

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

  let newSource: string;
  if (edit.parent !== undefined) {
    const idx = diagram.elements.findIndex((e) => e.id === edit.parent);
    if (idx === -1 || !isBoundary(diagram.elements[idx])) {
      return fail('unknown-parent', `'${edit.parent}' is not a boundary in this diagram`);
    }
    const span = spans.elements[idx];
    if (span.closeLine === undefined) {
      return fail(
        'boundary-cannot-take-children',
        `Boundary '${edit.parent}' has no multi-line { ... } block to insert into`,
      );
    }
    // Indent like the last direct child; else boundary indent + one unit.
    let siblingLine = -1;
    for (const e of spans.elements) if (e.parent === edit.parent) siblingLine = Math.max(siblingLine, e.line);
    for (const r of spans.relationships) if (r.parent === edit.parent) siblingLine = Math.max(siblingLine, r.line);
    const indent =
      siblingLine >= 0
        ? leadingWhitespace(doc.lines[siblingLine])
        : leadingWhitespace(doc.lines[span.line]) + detectIndentUnit(doc.lines);
    newSource = insertBeforeLine(doc, span.closeLine, indent + body);
    return verify(newSource, diagram, { ...edit, alias }, indent + body, label);
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
    const indent = leadingWhitespace(doc.lines[anchorLine]);
    newSource = insertAfterLine(doc, anchor, indent + body);
    return verify(newSource, diagram, { ...edit, alias }, indent + body, label);
  }
  newSource = insertBeforeEndOrAtEnd(doc, spans, body);
  return verify(newSource, diagram, { ...edit, alias }, body, label);
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
  return verify(newSource, diagram, edit, line, label);
}

/**
 * Re-parse the result and check it contains exactly the intended addition.
 * A safety net for odd source shapes (unterminated blocks, closing braces
 * sharing a line with content, …) that would otherwise misplace the line.
 */
function verify(
  newSource: string,
  before: C4Diagram,
  edit: C4Edit,
  insertedLine: string,
  label: string,
): ApplyC4EditResult {
  const after = parseC4WithSpans(newSource);
  const bad = () => fail('invalid-result', 'The edit could not be inserted cleanly into this source');
  if (!after.diagram || after.errors.length > 0) return bad();

  if (edit.kind === 'add-element') {
    if (after.diagram.elements.length !== before.elements.length + 1) return bad();
    const added = after.diagram.elements.find((e) => e.id === edit.alias);
    if (!added || added.parent !== edit.parent) return bad();
    return { ok: true, source: newSource, insertedLine, label, alias: edit.alias };
  }

  if (after.diagram.relationships.length !== before.relationships.length + 1) return bad();
  // The new relationship may land anywhere in parse order (boundary relationships can follow
  // it), so look for an index whose removal leaves exactly the original relationships.
  const same = (a: { sourceId: string; targetId: string; label: string }, b: typeof a) =>
    a.sourceId === b.sourceId && a.targetId === b.targetId && a.label === b.label;
  const afterRels = after.diagram.relationships;
  const inserted = afterRels.some(
    (r, k) =>
      r.sourceId === edit.sourceId &&
      r.targetId === edit.targetId &&
      afterRels.filter((_, i) => i !== k).every((o, i) => same(o, before.relationships[i])),
  );
  if (!inserted) return bad();
  return { ok: true, source: newSource, insertedLine, label };
}
