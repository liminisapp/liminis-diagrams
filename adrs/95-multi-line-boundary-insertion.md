# ADR-95: Multi-line boundary insertion

**Status**: Accepted
**Issue**: #95 — Add boundaries from the diagram's context menu
**Amends**: ADR-92, decision 1 ("exactly one line"), decision 2 (the edit union) and its
"Diffs stay one line" and "Not built" consequences.

## Context

After #93 an element can be added from the diagram, at top level or inside an existing
boundary, but a boundary itself still has to be written in the source first. To show what is
inside a container or system the user must leave the diagram, which is the flow the context
menu exists to avoid.

A boundary cannot be one line. It is an opening line `X_Boundary(alias, "Label") {` and a
separate closing `}`; the parser only gives a boundary a `closeLine` (which is what makes it a
valid insertion target) when the `}` is on a later line. ADR-92's rule that an edit inserts
exactly one line therefore cannot hold for this edit, and the reason for the rule (no existing
byte changes, diffs stay small and reviewable) is still the thing to protect.

## Decision

1. **"Exactly one line" becomes "exactly one contiguous block".** `add-element` and
   `add-relationship` still insert one line. `add-boundary` inserts two lines, the opening line
   and the closing `}`, together at one point. It remains a pure insertion: `source.slice(0, at)
   + block + source.slice(at)`. No existing byte changes and every original line stays in order.
2. **A separate `add-boundary` member of the edit union**, `{ kind, boundaryKind, label,
   alias?, parent? }`, rather than a boundary kind on `add-element`. The insertion differs, a
   boundary has no technology or description, and `C4AddableElementKind` and the existing edit
   shapes stay frozen. `boundaryKind` is `systemBoundary | containerBoundary | boundary`
   (`System_Boundary`, `Container_Boundary`, `Boundary`). `Enterprise_Boundary` and deployment
   nodes are not offered; `Enterprise_Boundary` can be added later without breaking anything.
3. **Same placement, alias and label rules as `add-element`**, through shared helpers
   (`resolveAlias`, `resolvePlacement`) so the two cannot drift. Top level: after the last
   top-level element or boundary block, else before `@enduml`, else the end of text. Nested:
   immediately before the parent's closing `}`, indented like the last sibling, else the parent's
   indent plus one unit. The closing `}` is aligned with the opening line. The block is joined with
   the file's own EOL and goes through the same single-point insert helpers, so CRLF and a missing
   trailing newline need no new byte-level code.
4. **Results gain `insertedLines: string[]`** (one element for `add-element` and
   `add-relationship`, two for `add-boundary`). `insertedLine` keeps its type and meaning and holds
   the first inserted line, so existing callers are unaffected.
5. **A stronger `verify`.** The result is re-parsed and must contain exactly the intended
   addition: one more element, the new alias with the requested parent and boundary style, a
   `closeLine` on the line right after its opening line (an empty block), the requested macro on the
   opening line (the AST cannot tell `Boundary` from `System_Boundary`), and every pre-existing
   element still present with the same parent (a misplaced `}` would otherwise silently re-parent
   siblings). Anything else is `invalid-result`. In particular, inserting after an unterminated
   top-level boundary fails rather than nesting the new block inside it.
6. **An empty boundary is a placeable, clickable box.** A boundary with no children takes a
   minimum 240x160 box (`EMPTY_BOUNDARY_SIZE`), in both auto and manual layout, because a default 80
   px box leaves only about 25 px under its 55 px header, too small to right-click into. It applies
   only to `style === 'boundary'` with no children, so a plain childless `System` is unchanged, and a
   boundary that gains children grows to contain them exactly as before. Size is still never stored;
   position is `{ x, y }` keyed by alias like any node.
7. **A pinned empty boundary is not pushed.** `resolveTopLevelOverlaps` skips a pair where both
   nodes have manual positions and either is an empty boundary, so a boundary dropped within 40 px of
   a populated one appears where the user put it and the populated one does not move.
8. **A nested boundary is clamped into its parent's content area** (`parent.x + 40`,
   `parent.y + 55`). Placed left of or above that, the parent would shift its own origin to contain
   the child, moving a node that already has a manual position. This slightly adjusts "appears at
   the clicked point" near a parent's top-left edge, for boundaries only; `add-element` is unchanged.
9. **Menu and gestures.** One menu with two labelled groups, Elements then Boundaries (a rule and a
   small heading separate them); boundary items use `data-boundary-kind` and element items keep
   `data-kind`. Choosing a boundary kind uses the same inline label flow, reports
   `onEdit(edit, { positions })` only on confirmation, and follows ADR-92 decisions 8 and 9
   unchanged. The innermost boundary containing the point is the parent (already the behaviour of
   `findBoundaryAt`; a test now locks it in). Boundaries get no connect handle and cannot be
   relationship endpoints (ADR-92 decision 10).

## Consequences

- Diffs for a boundary edit are one contiguous two-line block; for everything else, still one line.
  A diff reviewer can rely on "one contiguous block, nothing else changed" for any edit.
- A hand-written empty boundary now renders 240x160 where it used to render 240x80. Diagrams that
  contain one will look slightly taller; nothing else changes.
- Hosts that read `insertedLine` keep working. Hosts that want the whole block read `insertedLines`.
- The docs-site playground and the demo are pinned to the published package and show the feature
  only after a release.
- Still not built: delete, rename, re-parent (including wrapping existing elements in a new
  boundary), editing an existing relationship, deployment nodes, `Enterprise_Boundary` in the menu,
  and relationships on boundaries.
