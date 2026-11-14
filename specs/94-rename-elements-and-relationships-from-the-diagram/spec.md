# Feature Specification: Rename elements and relationships from the diagram

**Feature Branch**: `fabrik/issue-94`
**Created**: 2026-11-13
**Status**: Specified
**Input**: User description: "## Problem

After #92/#93 a user can add elements and relationships from the diagram, but can't change a label once it exists. To fix a typo in an element's name, or replace a relationship's default \"Uses\", they have to edit the C4-PlantUML source by hand.

## Desired outcome

In edit mode, the user can rename an existing **element** or **relationship** from the diagram. The renderer reports a new `rename` edit, and the headless `applyC4Edit` applies it as a minimal patch to the source.

## Hard constraints (carried over from #92)

- **The source text stays canonical.** This is the first edit kind that *modifies* an existing line rather than inserting one. It replaces only the label argument's characters. Every other byte of that line (alias, description, technology, tags, macro variant such as `Rel_D` / `ContainerDb` / `_Ext`, trailing comment) and every other line stay byte-identical.
- **The alias never changes.** Manual positions are keyed by alias, so renaming must not orphan a position.
- **The package never writes anywhere.** The edit is reported through `onEdit` and the host applies it.
- Additive API: a new member of the edit union. Existing callers are unaffected.
- Pointer events with `pointercancel`. Everything sits behind `isEditMode`.
- Reuse the existing inline `LabelInput` and its sanitising rules (`\"`→`'`, `\\`→`/`, control characters → space).

## Acceptance criteria

- [ ] `applyC4Edit(source, { kind: 'rename', target: { element: alias } | { relationship: index-or-span }, label })` returns source that differs only in the label argument of one line.
- [ ] A fixture test covers every element macro family and `Rel` / `Rel_*` / `BiRel`. It shows the description, technology, direction variant and comments are byte-identical after a rename.
- [ ] Renaming a relationship whose label argument is empty, or a line written across odd spacing, still produces a minimal patch that parses.
- [ ] Renaming to an empty label falls back to the existing placeholder rules.
- [ ] In edit mode, double-clicking an element's label (or a long-press on a node, on touch) opens the inline label input prefilled with the current label. The same works on a relationship's label. Enter confirms; Escape or blur cancels and reports nothing.
- [ ] Move-drag, connect-drag and the add-element context menu keep working unchanged.
- [ ] The playground demonstrates both renames. The recipes document the new edit kind.

## Out of scope

Delete, re-parent, changing an element's kind/macro, editing description or technology, and renaming boundaries. Note any of these that fall out for free.

## Open questions for Specify

1. How is a relationship identified in the edit? Relationships have no alias. Options: an index into `diagram.relationships`, the source span from `parseC4WithSpans`, or `(sourceId, targetId, occurrence)`. Which one is stable when the host's text has changed since render?
2. On touch, a long-press on a node already means something (see #93's long-press menu). What gesture triggers rename on touch?
3. Should renaming a boundary's label come along for free, since it is the same argument position?

## Pointers

- `src/core/edit.ts` (the `C4Edit` union, `applyC4Edit`)
- `parseC4WithSpans` in `src/core/parser.ts`
- `src/react/LabelInput.tsx`, `src/react/EditMenu.tsx`, `src/react/hooks/useC4LongPress.ts`
- `ideas/structural-editing.md` (open question 8: what comes next)
- #92 (spec) and #93 (implementation)"

## Background

After #92/#93 a user can add elements and relationships from the rendered diagram, but cannot change a label once it exists. Fixing a typo in an element's name, or replacing a relationship's default "Uses", means leaving the diagram and hand-editing C4-PlantUML. This issue closes that gap with a `rename` edit.

It carries over the constraints settled in #92 (recorded in ADR-92 and `ideas/structural-editing.md`):

- The source text is canonical, and an edit is a minimal patch, never a re-serialisation of the lossy model.
- The package never writes anywhere. The renderer reports an edit through `onEdit` and the host applies it.
- Public API changes are additive. Interaction uses pointer events with `pointercancel` handling, and everything sits behind `isEditMode`.

**What is new:** every edit so far has been a pure line *insertion*, so existing bytes were never touched. Rename is the first edit that *modifies* an existing line. It must replace exactly the label argument's characters and nothing else on that line. It must also never change an alias, because manual positions are keyed by alias.

**Findings from the codebase on `main`** (the Research stage should confirm them):

- `parseC4WithSpans` returns index-aligned spans: `spans.elements[i]` for `diagram.elements[i]` and `spans.relationships[i]` for `diagram.relationships[i]`. Each carries a line, and boundaries are included among the elements.
- `applyC4Edit` re-parses the text it is given and never trusts the renderer's snapshot. It returns a `{ ok } | { ok: false, code }` result.
- A relationship has no alias. Its identity is its position in the parsed list.
- On `main`, the long-press (about 500 ms, via `useC4LongPress`) opens the add-element menu only on empty canvas or on a boundary. It is deliberately not started on an element node. A long-press on a node therefore has no meaning today, which resolves open question 2 in favour of reusing the long-press for rename on nodes. A long-press on a *boundary* already belongs to the add menu.
- `LabelInput` already exists as the inline editor. Enter confirms, Escape or blur cancels, and exactly one of the two fires per mount.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rename an element from the diagram (Priority: P1)

In edit mode, I double-click an element's label (or long-press the element on touch). An inline input appears over the label, prefilled with the current label. I type a new name and press Enter. The host receives a `rename` edit, applies it, and the diagram shows the new label with the element in the same place.

**Why this priority**: Fixing a typo in a name is the most common label change. It also builds the first modify-in-place edit in the core, which relationship rename reuses.

**Independent Test**: In the playground, double-click an element's label, change the text and press Enter. Diff the source before and after. Exactly one line changed, and within it only the label argument. The element keeps its position.

**Acceptance Scenarios**:

1. **Given** edit mode with `onEdit`, **When** I double-click an element's label, **Then** the inline label input opens over it, prefilled with the current label and with the text selected.
2. **Given** the input is open, **When** I press Enter, **Then** `onEdit` is called once with a `rename` edit targeting that element's alias and the sanitised label. The host applies it and the source differs from before only in that label argument.
3. **Given** the input is open, **When** I press Escape or the input loses focus, **Then** nothing is reported and no stuck state remains.
4. **Given** a touch device, **When** I press and hold on an element for about 500 ms without significant movement, **Then** the same input opens. If I move past the threshold, release early, or the pointer is cancelled, no input opens, so a move-drag never opens one. A long-press that opens the input drops the move-drag it started, without reporting a position change.
5. **Given** an element whose macro is any family (`Person`, `System`, `Container`, `Component`, with `Db`, `Queue`, `_Ext` variants), **When** I rename it, **Then** its macro, alias, description, technology, tags and any trailing comment are byte-identical.
6. **Given** I confirm the label unchanged, **Then** nothing is reported.
7. **Given** I confirm an empty or whitespace-only label, **Then** the label falls back to the placeholder for that element's type (the same placeholder rules as adding an element) and that is what is reported.
8. **Given** a label containing `"`, `\` or control characters, **When** I confirm, **Then** it is sanitised with the same rules as add (`"`→`'`, `\`→`/`, control characters → space) and the source still parses.
9. **Given** an element that has a manual position, **When** I rename it, **Then** its position is unchanged and no position key is orphaned.

---

### User Story 2 - Rename a relationship from the diagram (Priority: P1)

In edit mode, I double-click a relationship's label (or long-press it on touch). The inline input opens prefilled with the current label. I replace "Uses" with something meaningful and press Enter. The host applies a `rename` edit that changes only that `Rel` line's label argument.

**Why this priority**: The issue asks for both renames, and the playground must demonstrate both. Relationships are harder because they have no alias.

**Independent Test**: In the playground, double-click a relationship label, change it, press Enter. Diff the source. Exactly one `Rel` line changed, only in its label argument. Its technology and direction variant are intact.

**Acceptance Scenarios**:

1. **Given** edit mode with `onEdit`, **When** I double-click a relationship's label, **Then** the inline input opens at the label, prefilled with the current label.
2. **Given** the input is open, **When** I press Enter, **Then** a `rename` edit targeting that relationship is reported once, and applying it changes only that line's label argument.
3. **Given** `Rel`, `Rel_D` (and the other `Rel_*` direction variants) and `BiRel` lines carrying a technology argument and a trailing comment, **When** I rename them, **Then** the technology, direction variant and comment are byte-identical.
4. **Given** a relationship whose label argument is empty (`""`), or a `Rel` line written with unusual spacing, **When** I rename it, **Then** the patch is still minimal and the result parses.
5. **Given** two relationships between the same pair of elements, **When** I rename one, **Then** only that one changes.
6. **Given** the input is open, **When** I press Escape or blur, **Then** nothing is reported.
7. **Given** I confirm an empty label, **Then** it falls back to "Uses".
8. **Given** a touch device, **When** I long-press a relationship's label, **Then** the input opens, with the same abandonment rules as in User Story 1.

---

### User Story 3 - Headless rename for hosts, tools and agents (Priority: P2)

A tool builder or agent renames an element or relationship in C4-PlantUML text without React, by calling `applyC4Edit` with a `rename` edit and getting the new source back. The recipes document the new edit kind.

**Why this priority**: It is the stated architecture and what makes the feature testable and agent-usable. The visible value is in Stories 1 and 2.

**Independent Test**: Call `applyC4Edit` from a plain unit test over the fixture and diff the results. Follow the recipes to apply a rename in a host.

**Acceptance Scenarios**:

1. **Given** source text and `{ kind: 'rename', target: { element: alias }, label }`, **When** `applyC4Edit` is called, **Then** it returns new source differing from the original only in that element's label argument.
2. **Given** a relationship target that no longer matches the text the host holds (it moved, was deleted or was edited since render), **When** `applyC4Edit` is called, **Then** it returns a failure result rather than patching a different relationship.
3. **Given** a target alias that is not in the source, **When** `applyC4Edit` is called, **Then** it returns a failure result.
4. **Given** the recipes, **When** a tool builder reads them, **Then** they describe the `rename` edit, how to target an element and a relationship, and the host's responsibilities.

---

### Edge Cases

- A label argument that is empty (`""`) on an element or relationship is replaced in place.
- A label written unquoted in the source: the patch replaces that argument's characters and writes the new label quoted, so the result still parses.
- A label argument that is absent altogether (for example a `Rel` with only two arguments): rename is rejected with a failure result rather than inserting an argument, because that would go beyond replacing a label's characters.
- Odd spacing, such as `Rel( a ,b , "x" )`, or tabs around arguments.
- The old label's text also appears in the description, technology, alias or a trailing comment on the same line. Only the label argument is replaced, never the first textual match.
- Labels containing commas, parentheses or non-ASCII characters (the parser already round-trips these inside quotes).
- CRLF line endings, a missing trailing newline, and a rename of the last line are preserved byte for byte.
- An element inside a boundary, and a relationship inside a boundary block, keep their indentation.
- Renaming to the same label is a no-op: the renderer reports nothing, and the headless function returns the source unchanged.
- The source stops parsing between render and apply: the edit fails and nothing is patched.
- A rename of an element whose alias is also a substring of another alias or label affects only the targeted line.
- A press on a boundary, a connect handle, the legend or empty canvas does not open the rename input. A long-press on a boundary still opens the add menu.
- Edit mode off, or no `onEdit`: no double-click or long-press rename is available and the browser's default double-click behaviour is untouched.
- The rename input and the add-element menu, the new-element input, the new-relationship input, move-drag and connect-drag are mutually exclusive: opening one closes or refuses another and leaves no stuck state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The core edit union MUST gain a `rename` member, `{ kind: 'rename', target, label }`, added without changing existing members or the behaviour of `add-element` and `add-relationship`.
- **FR-002**: `target` MUST be `{ element: alias }` for an element, or `{ relationship: … }` for a relationship (see FR-004).
- **FR-003**: Applying a `rename` MUST replace only the characters of the label argument on exactly one line. Every other byte on that line (alias, description, technology, tags, macro variant, spacing, trailing comment) and every other line MUST be byte-identical, including line endings and the presence or absence of a trailing newline.
- **FR-004**: A relationship target MUST be identified by its index into the parsed relationships, together with the source and target ids and the current label the renderer saw. `applyC4Edit` MUST re-parse the text it is given and apply the rename only if the relationship at that index still has those endpoints and that label. Otherwise it MUST return a failure result and change nothing.
- **FR-005**: An element target that is not in the current source MUST return a failure result.
- **FR-006**: Rename MUST NOT change any alias, so manual positions keyed by alias are never orphaned.
- **FR-007**: The new label MUST use the same sanitising rules as add (`"`→`'`, `\`→`/`, control characters → space, trimmed), and the label as written MUST be returned in the success result.
- **FR-008**: An empty or whitespace-only label (after sanitising) MUST fall back to the existing placeholder: "Uses" for a relationship, and the type's placeholder label for an element.
- **FR-009**: The source produced by a rename MUST parse with `parseC4` with no errors, with the same elements, aliases and relationships as before and only the targeted label changed. If it would not, the edit MUST fail without returning modified source.
- **FR-010**: Rename MUST work for every element macro family and variant the parser supports (including `_Ext`, `Db`, `Queue`), for `Rel`, every `Rel_*` direction variant and `BiRel`, and for elements and relationships nested inside boundary blocks.
- **FR-011**: A label argument that is empty, unquoted, or surrounded by unusual spacing MUST still be renamed as a minimal patch that parses. A line with no label argument at all MUST be rejected with a failure result.
- **FR-012**: The core change MUST stay headless and React-free, and the `rename` result MUST use the same success/failure result shape as the existing edits, with new failure codes for the cases above.
- **FR-013**: In edit mode with `onEdit` provided, double-clicking an element's label MUST open the existing inline `LabelInput`, prefilled with the current label. Enter confirms and reports a `rename` edit. Escape or blur cancels and reports nothing.
- **FR-014**: In edit mode with `onEdit` provided, double-clicking a relationship's label MUST open the same input at the label, with the same confirm and cancel behaviour. Where a relationship has no visible label, double-clicking the relationship's line MUST open it too, so an empty label can still be set.
- **FR-015**: On touch, a long-press of about 500 ms with no significant movement on an element node, or on a relationship's label, MUST open the rename input. It MUST be built on the existing long-press mechanism and pointer events. Movement past the tolerance, early release, or `pointercancel` MUST abandon the press. A long-press that fires on a node MUST abort the move-drag that the press started, without reporting a position.
- **FR-016**: Confirming a rename whose sanitised label equals the current label MUST report nothing.
- **FR-017**: A rename reported through `onEdit` MUST NOT be applied by the renderer, and the package MUST NOT write anywhere. The host applies the edit.
- **FR-018**: `onEdit` for a rename MUST carry the same `{ positions }` contract as other edits, so a host applies text and positions in one update through a single code path. Positions are the complete map to store, with every currently laid-out node pinned from the effective layout, host values winning, so a label change that resizes a node cannot reshuffle nodes that only had automatic positions.
- **FR-019**: Rename affordances MUST appear only when `isEditMode` is on and `onEdit` is provided. A read-only render gains nothing, and a host that passes `isEditMode` for dragging alone is unaffected.
- **FR-020**: Move-drag, connect-drag and the add-element context menu (right-click and long-press on canvas or boundary) MUST behave exactly as before. The rename input, the add menu, the new-element and new-relationship inputs and the drags MUST be mutually exclusive.
- **FR-021**: The rename gestures MUST use pointer events, handle `pointercancel`, and leave no stuck gesture state.
- **FR-022**: Renaming MUST be unavailable while the source does not parse, as for other edits.
- **FR-023**: The playground MUST demonstrate both an element rename and a relationship rename end to end, applying the reported edit and positions in one update.
- **FR-024**: The recipes MUST document the `rename` edit kind: the shape of both targets, how the renderer reports it, the failure results, and the host's responsibilities.
- **FR-025**: The core unit tests MUST include a fixture covering every element macro family and `Rel` / `Rel_*` / `BiRel`, showing that description, technology, direction variant and comments are byte-identical after a rename. They MUST also cover an empty label argument, odd spacing, an unquoted label, an absent label argument, a stale relationship target, an unknown alias, sanitising, the empty-label fallback and CRLF.
- **FR-026**: The decision to add a modifying edit (ADR-92 says an edit is "exactly one line inserted") MUST be recorded as an ADR in `adrs/`, numbered by this issue's number (`adrs/94-<slug>.md`, heading `# ADR-94: …`), per the repository convention.

### Key Entities *(if applicable)*

- **Rename edit**: The new `C4Edit` member, `{ kind: 'rename', target, label }`, reported by the renderer and applied headlessly.
- **Rename target**: Either an element alias, or a relationship identified by its index plus its endpoints and current label as a staleness guard.
- **Label argument**: The single argument position that holds the human-readable name in an element macro, boundary macro or `Rel` macro. It is the only text a rename may change.
- **Alias**: The unchanged identifier an element's manual position is keyed by.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the playground, renaming an element and renaming a relationship each change the source on exactly one line, and within that line only the label argument (verified by diff).
- **SC-002**: Across the fixture covering every element macro family and `Rel` / `Rel_*` / `BiRel`, 100% of descriptions, technologies, direction variants, aliases and comments are byte-identical after a rename.
- **SC-003**: Every renamed source in the test suite parses with `parseC4` with zero errors and has the same elements, aliases and relationships as before, with only the target's label changed.
- **SC-004**: After any rename, every element that had a manual position has the same position, and no position key is orphaned.
- **SC-005**: A rename against a relationship target that no longer matches the text, or an alias that is not in the source, changes zero bytes and returns a failure result.
- **SC-006**: With edit mode off, or without `onEdit`, a render exposes zero rename affordances, and the existing test suite passes unchanged.
- **SC-007**: Cancelling the input (Escape or blur), confirming an unchanged label, and a long-press abandoned by movement, early release or `pointercancel` all report nothing.
- **SC-008**: A tool builder can follow the recipes to apply a rename to an element and to a relationship without reading the package source.

## Assumptions

- **Relationship identity (open question 1):** the index into the parsed relationships, guarded by the source id, target id and current label the renderer saw. This identifies one line, so it is unambiguous even for duplicate pairs (which are allowed). The guard means a stale index fails rather than patching a different line. A raw source span is rejected because line numbers go stale after any host edit and are an implementation detail of the parser. The `(sourceId, targetId, occurrence)` option is rejected because its occurrence count shifts the moment a sibling is added or removed.
- **Touch gesture (open question 2):** the issue's premise is slightly off. On `main` the long-press menu opens only on empty canvas and on boundaries, never on an element, so a long-press on a node is free. Rename reuses the same long-press (about 500 ms, same tolerance) on elements and relationship labels. Double-tap is not required.
- **Boundary rename (open question 3):** boundary labels are the same argument position, and boundaries are already in the parsed elements, so the headless `rename` falls out for free and accepts a boundary's alias. No boundary UI gesture is added in this issue: a long-press on a boundary already opens the add menu, and the issue lists boundary rename as out of scope. Whether a double-click on a boundary label opens the input is left out; the Research stage may note if it is trivial, but it is not required.
- Renaming to an empty label falls back to the placeholder (per the issue) rather than cancelling, using the same placeholder rules as add.
- Rename reports `positions` exactly as the other edits do (FR-018) rather than omitting them. This keeps one host code path and covers label-width layout shifts.
- The result type (`{ ok } | { ok: false, code }`) is reused. New failure codes are an implementation choice for the Plan stage.
- Undo is whatever the host already has. This package adds none.
- `liminis-editor` host behaviour (merging positions) is separate work in that repo, as in #92.

## Out of Scope *(optional)*

- Delete, re-parent, changing an element's kind or macro, and editing description or technology.
- Renaming boundaries from the UI. The headless `rename` accepts a boundary alias as a by-product (see Assumptions), but no boundary gesture is added.
- Changing a relationship's endpoints, technology or direction variant.
- Renaming an alias (explicitly forbidden: positions are keyed by it).
- The `liminis-editor` host change.
- Any persistence or file writing by this package.

## Source References *(optional)*

- `adrs/92-structural-editing-edit-api.md` (on `main`): the edit API decisions this extends, including the insertion-only wording that FR-026 revisits
- `src/core/edit.ts` (the `C4Edit` union, `applyC4Edit`) and `parseC4WithSpans` in `src/core/parser.ts`
- `src/react/LabelInput.tsx`, `src/react/hooks/useC4LongPress.ts`, `src/react/C4InteractiveRenderer.tsx`
- `ideas/structural-editing.md` (open question 8: what comes next)
- #92 (spec) and #93 (implementation, merged)
