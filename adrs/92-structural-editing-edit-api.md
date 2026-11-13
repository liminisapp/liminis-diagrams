# ADR-92: Structural editing edit API

**Status**: Accepted
**Issue**: #92 — Add elements and relationships from the diagram

## Context

A diagram could be rendered and its nodes dragged; adding a box or a relationship meant
hand-editing C4-PlantUML. We want to add elements and relationships from the rendered
diagram without breaking three standing constraints: the source text is canonical (the
AST is lossy — it drops `Rel` technology, direction variants, comments and directives),
the package never writes anywhere, and the `./core` entry stays React-free.

## Decision

1. **An edit is a line insertion at a character offset into the original text.** Never a
   re-serialisation of the model. `applyC4Edit(source, edit)` (in `./core`, pure) re-parses
   the text it is given — it never trusts the renderer's snapshot — and returns the source
   with exactly one line inserted. Offsets, not a re-joined line array, so CRLF and a missing
   trailing newline survive byte for byte.
2. **`C4Edit` is a discriminated union on `kind`** (`add-element`, `add-relationship`).
   Delete, rename, re-parent and edit-relationship can be added as further members without
   breaking callers.
3. **Result type, not exceptions.** `{ ok: true, source, … } | { ok: false, code, message }`.
   A host must show "cannot add inside this boundary" without a try/catch, and an agent can
   branch on `code`. The output is re-parsed before it is returned (`invalid-result` if it
   would not contain exactly the intended addition).
4. **Spans live beside the AST, not on it.** `parseC4WithSpans` returns `ParseResult` plus
   index-aligned `spans`. `parseC4` and the AST types are unchanged, so no existing consumer
   or deep-equality test is affected.
5. **The renderer decides the alias; core validates it.** Positions are keyed by alias, so the
   host needs `{ [alias]: position }` at report time. The renderer calls `generateC4Alias`
   and carries the alias in the edit. `applyC4Edit` never silently renames: a collision with
   the host's current text fails with `alias-collision`, since renaming would orphan the
   position key.
6. **Label safety = sanitising plus two parser fixes.** The parser does not un-escape and
   PlantUML has no escape for `"`, so a label is written with `"`→`'`, `\`→`/` and control
   characters → space, and the label as written is returned. `extractArgs` now ignores
   parentheses inside quoted strings and only boundary macros open a `{` block (outside
   quotes), so common labels such as `Web App (React)` round-trip. Both fixes change
   behaviour only for sources that previously misparsed.
7. **Insertion points.** Top-level element: after the last top-level element or boundary
   (its closing line, if it has a block), else before the first `@enduml` after all content,
   else end of text. In a boundary: immediately before its closing `}`. Relationship: after
   the last top-level `Rel`, else as for an element. Boundaries that cannot take a pure
   insertion (no braces, single-line `{ }`, unterminated) are rejected with
   `boundary-cannot-take-children`; making them take children would modify an existing line.
8. **`onEdit(edit, { positions })`, gated on `isEditMode && onEdit`.** `positions` is the
   complete map to store: `{ ...layoutPositions, ...hostPositions, [newAlias]: placement }`.
   Every structural edit pins every currently laid-out node from the *effective* layout, so
   adding a node cannot reshuffle automatic positions; it is stateless (no "first edit"
   flag), so "Reset layout" followed by an edit pins again. Host values win over layout
   values, so nothing that had a manual position moves or is re-rounded. The legend is
   pinned only if the host already positioned it. Gating on `onEdit` as well as `isEditMode`
   keeps hosts that pass `isEditMode` for dragging alone (liminis-editor) unchanged.
9. **Gestures.** A context menu on the canvas to add an element (right-click, or a ~500 ms
   long-press on touch because iPadOS Safari does not reliably fire `contextmenu`; it
   replaced an initial toolbar palette, which was the package's only control and took space
   from every host); choosing a kind places the element at the point the menu opened;
   an HTML label input over the SVG (`foreignObject` has focus quirks on iPadOS Safari);
   a dedicated connect handle, always visible, separate from the move rect. Move, connect,
   the menu and the open inputs are mutually exclusive; every gesture uses pointer events,
   owns its pointer id, and aborts on `pointercancel`. Target resolution is geometric, in SVG
   coordinates, so nesting rather than paint order decides the target.
10. **Relationships on boundaries** are blocked in the UI only; core stays permissive.
    Self-relationships are rejected in both layers (`calculateEdges` cannot draw a loop).
    Duplicate pairs are allowed.
11. **A new relationship is labelled on creation.** On release over a valid target the same
    inline input appears at the edge's midpoint, defaulting to "Uses"; the edit is reported
    only once it is confirmed, so `add-relationship` needs nothing new. Renaming an existing
    element or relationship stays out of scope and will be a separate `rename` edit kind.

## Consequences

- Diffs stay one line, which is what the diagram-wiki goal (#27) needs.
- Hosts own applying the edit and must apply text and positions in one update, and must merge
  rather than clear positions. `liminis-editor` clears its layout whenever the set of element
  ids changes; that must become a merge before the feature is usable there (separate work in
  that repo).
- The menu is the package's first built-in control; it is styled inline with `--c4-*`
  variable fallbacks and targeted with `data-c4-menu`. The native context menu is
  suppressed over the diagram in edit mode with `onEdit` only.
- Not built: delete, rename, re-parent, editing an existing relationship, deployment nodes
  and boundaries as addable kinds, relationships on boundaries.
