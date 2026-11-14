# ADR-94: A modifying edit — rename

**Status**: Accepted
**Issue**: #94 — Rename elements and relationships from the diagram

## Context

ADR-92 made every edit "exactly one line inserted": no existing byte ever changed, which made
the minimal-patch guarantee trivially checkable. A user could add an element or a
relationship from the diagram but not fix a typo in a label, short of editing the source by
hand. Rename is the first edit that *modifies* an existing line. The standing constraints
carry over: the source text is canonical (the AST is lossy), the alias never changes (manual
positions are keyed by it), the package never writes anywhere, and the API is additive.

## Decision

1. **A rename is a splice of one argument's characters, not an insertion.** ADR-92 decision 1
   is revised: an edit is a *minimal patch* — a line insertion (add) or the replacement of
   exactly one label argument's characters (rename). Every other byte, including the alias,
   description, technology, tags, macro variant, spacing, trailing comment, line endings and
   the final newline, is untouched. The model is still never re-serialised.
2. **The parser reports where the label is.** `ElementSpan` and `RelationshipSpan` gain an
   optional `labelRange` — character offsets of the label argument within the raw line.
   `extractArgs`/`splitArgs` became offset-aware, so one implementation decides what "the
   label argument" is (empty arguments are dropped, quotes and escapes are honoured, comments
   are stripped) and a second scanner in `edit.ts` cannot drift from the parser. A `$named`
   argument (`$tags=…`) or an absent argument gets no range: replacing it would drop a keyword
   or insert an argument, which is more than replacing a label's characters. Those fail with
   `no-label-argument`. An unquoted label is replaced by a quoted one.
3. **`C4Edit` gains `{ kind: 'rename', target, label }`.** `target` is `{ element: alias }`
   (a boundary alias works too, by the same argument position; no boundary gesture is added)
   or `{ relationship: { index, sourceId, targetId, label } }`.
4. **Relationship identity is an index plus a staleness guard.** Relationships have no alias.
   `index` is the position in `diagram.relationships`; the endpoints and the *combined* label
   (`label [technology]`, as parsed) are what the renderer saw. `applyC4Edit` re-parses the
   host's text and applies the rename only if the relationship at `index` still matches;
   otherwise `stale-target`, and nothing changes. A source span was rejected because line
   numbers go stale after any host edit and are a parser detail; `(source, target, occurrence)`
   was rejected because the occurrence shifts when a sibling is added or removed. The index
   identifies one line, so duplicate pairs are unambiguous.
5. **New failure codes**: `unknown-element`, `stale-target`, `no-label-argument`. A `Rel` with
   fewer than three arguments is already a `parse-error`. The success shape is unchanged:
   `insertedLine` is now documented as "the line as it now reads".
6. **A rename is verified differently.** `verifyRename` re-parses the result and requires the
   same elements (id, parent, type, properties), the same relationships (endpoints,
   technology) in the same order, and only the target's label changed; otherwise
   `invalid-result`. Renaming to the current label returns the source unchanged.
7. **Label rules are add's.** The same sanitising; an empty label falls back to "Uses" for a
   relationship and to `placeholderLabelFor(element)` for an element (type name, `Database`
   for a cylinder, `Queue`, `Boundary` for boundaries and deployment nodes).
8. **AST and layout additions (a departure from ADR-92 decision 4).** `C4Relationship` gains
   an optional `technology` (set only when non-empty) and `LayoutEdge` an optional
   `relationshipIndex`. The renderer holds the AST, not the spans, and needs the bare label to
   prefill the input — without it, confirming `Uses [HTTPS]` would write the technology twice.
   `layout.edges[i]` is not `relationships[i]` when an endpoint is missing, so the edge needs
   the index. Both are optional and additive; only tests that deep-compared a relationship
   carrying a technology were touched.
9. **Gestures.** Double-click an element's node or a relationship's label; on touch, the
   ~500 ms long-press (same tolerance, pointer events, `pointercancel`). On `main` that
   long-press was deliberately not started on an element, so reusing it there is free; a
   long-press on a boundary or empty canvas still opens the add menu. The press target is
   resolved when the press starts and the long-press drops the move-drag it began, so
   releasing writes no positions. The rename input reuses `LabelInput` (Enter confirms, Escape
   or blur cancels); the menu, both add inputs, the rename input and both drags are mutually
   exclusive. Gated on `isEditMode && onEdit`; double-click handlers exist only then, so the
   browser's own behaviour is untouched otherwise.
10. **Relationship targets are geometric.** The rendered label can be a legend letter or a step
    number, and edges carry no DOM hooks, so a transparent rect at the edge midpoint (the
    formula `EdgeComponent` uses) takes the gesture; a relationship with no label gets a wide
    transparent line instead, so an empty label can still be set. The layer sits above the node
    rects and below the connect handles. Right-click on a label is suppressed (no add menu).
    The prefill comes from the model, never the DOM.
11. **`onEdit` carries `{ positions }` as for every edit**, so a host has one code path and a
    label that resizes a node cannot reshuffle automatic positions.

## Consequences

- Diffs stay one line, and within it only the label argument.
- A double-click still reports `onPositionChange` once per click, as any click on a node does
  (the move-drag reports on release regardless of movement). It is idempotent for a host and
  the spec requires move-drag to stay unchanged, so it is accepted.
- The double-click handler assumes the drag state is cleared by `pointerup` before `dblclick`
  fires (React flushes the discrete event synchronously); a drag in flight refuses it.
- **Manual verification needed (not coverable in jsdom/happy-dom):** after a timer-fired
  long-press there is no user activation, so on iPadOS Safari `focus()` on the input may not
  raise the keyboard, and the input opens under the still-down finger.
- Still not built: delete, re-parent, changing an element's kind, editing description or
  technology, and a boundary rename gesture (the headless edit accepts a boundary alias).
