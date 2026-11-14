# Feature Specification: Move elements into and out of boundaries by drag and drop (re-parent)

**Feature Branch**: `fabrik/issue-99`
**Created**: 2026-11-13
**Status**: Specified
**Input**: User description: "## Problem

There's no way to move an element into or out of a boundary from the diagram. Which boundary an element belongs to is decided by where its line sits in the source, so the user has to cut and paste the line by hand. Dragging a child past its boundary's edge doesn't move it out: the boundary just grows to contain it, because the layout sizes a boundary to fit its children. Dropping an element on a boundary only changes the element's position.

## Desired outcome

In edit mode:
- **Drop onto a boundary to move into it.** Drag an element (or a boundary) and release it over another boundary. The dragged item becomes that boundary's child.
- **Option-drag to move out.** Holding ⌥ (Alt) while dragging a child lifts it out of its current boundary. It goes to the top level, or into whichever boundary it's dropped on.
- A plain drag inside the element's current boundary keeps today's behaviour: it repositions, and the boundary grows.

## Hard constraints (carried over from #92 / #94 / #95)

- **The source text stays canonical, and the patch stays minimal.** This is a new `reparent` edit kind: a *move* of the element's line, or a boundary's whole `{ … }` block, to its new parent's block or to the top level. Content is byte-identical apart from re-indentation to the destination's sibling indent. No other line changes. Specify decides whether re-indentation is allowed; see Q1.
- **Aliases never change**, so relationships and manual positions survive. The moved element keeps the dropped position.
- A boundary can't be moved into itself or into one of its descendants. That's rejected with a result code and no thrown error.
- The package never writes anywhere. `onEdit` reports the edit and the host applies it. The API stays additive.
- Pointer events with `pointercancel` handling. All of this sits behind edit mode. Move, connect, the menu and rename stay mutually exclusive.

## Acceptance criteria

- [ ] `applyC4Edit(source, { kind: 'reparent', id, parent?: alias })` moves the line or block. `parent` undefined means top level, using the #92 top-level insertion rule. The result parses, and the element's parent in `parseC4WithSpans` is the new one.
- [ ] Fixture tests show that comments, `Rel` arguments, direction variants and every untouched line are byte-identical. Moving a boundary carries its children with it.
- [ ] Dropping onto a boundary reports a `reparent` into the innermost boundary under the pointer. Dropping back onto the current parent reports nothing beyond the position change.
- [ ] An option-drag that ends on empty canvas reports a `reparent` to the top level. The old boundary shrinks back, and no other manual position moves.
- [ ] While dragging, the boundary that would receive the drop is highlighted, so the user can see where it will land.
- [ ] A touch equivalent exists for "move out", since touch has no ⌥ key. See Q2.
- [ ] The playground, recipes and an ADR are updated (ADR number = this issue's number).

## Out of scope

Wrapping several existing elements in a new boundary. Delete. Multi-select.

## Open questions for Specify. Put these to the user; don't answer them silently.

1. Is re-indenting the moved line acceptable, given it's the only byte change? Or should the original indentation be kept?
2. What's the touch gesture for moving out? Options: dragging past the boundary's edge by some margin, or a \"Move out\" entry in a menu. Note that long-press on an element currently means rename, which is already causing problems on iPad. The rename gesture on touch is being reconsidered separately.
3. Should a relationship-heavy element moving into a boundary trigger any warning? (Suggested: no. Nesting rules aren't enforced, as in #92 Q3.)
4. Where in the destination block does the moved line go: after the last sibling, as with add-element?

## Pointers

- `src/core/edit.ts`, `parseC4WithSpans`, `src/react/hit-test.ts` (`findBoundaryAt`, innermost wins)
- `applyDragWithChildren` and the drag preview in `src/react/C4InteractiveRenderer.tsx`; `src/react/hooks/useC4DiagramDrag.ts`
- ADR-92, ADR-94, ADR-95"

## Background

In edit mode the diagram can already reposition elements (#94), add elements and relationships (#92) and add boundaries (#95). It cannot change which boundary an element belongs to. That membership is decided purely by where the element's line sits in the PlantUML source, so today a user who wants to move a container into a system boundary, or lift it out, has to leave the diagram, cut the line and paste it into another block by hand. That is exactly the round trip the in-diagram editing features exist to avoid.

The gesture they would naturally try does not work. Dragging a child past its boundary's edge does not move it out: the layout sizes a boundary to fit its children, so the boundary just grows. Dropping an element onto another boundary only changes its position; the source is untouched.

This change adds a **re-parent** edit. Dropping an element or boundary onto another boundary moves it into that boundary; holding ⌥ (Alt) while dragging a child moves it out of its current boundary (to the top level, or into whichever boundary it is dropped on). A plain drag inside the current boundary behaves as today.

The constraints carried over from #92, #94 and #95 still hold: the source text stays canonical and the patch stays minimal, aliases never change (so relationships and manual positions survive), and the package never writes anywhere. It reports an edit through `onEdit` and the host applies it. The API stays additive. ADR-95 already relaxed "exactly one line inserted" to "exactly one contiguous block inserted"; a move is the first edit that also *removes* text, so the "nothing else changed" guarantee needs restating for it (see Assumptions).

Existing context: on touch, long-press on an element currently means rename and long-press on the canvas opens the add menu; the rename gesture on touch is being reconsidered separately because it already causes problems on iPad.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Drop an element or boundary onto a boundary to move it in (Priority: P1)

A user in edit mode drags an element, or a whole boundary, and releases it over another boundary. The dragged item becomes a child of the innermost boundary under the pointer. The source is reported as an edit; the host applies it.

**Why this priority**: This is the core capability; without it, re-parenting from the diagram does not exist. It also works with a mouse or touch, with no modifier key.

**Independent Test**: Take a source with a top-level element and an unrelated boundary. Drag the element onto the boundary and release. Apply the reported edit to the source. The element's line now sits inside the boundary's block, its alias is unchanged, and the element appears inside the boundary at the dropped position.

**Acceptance Scenarios**:

1. **Given** a top-level element and a boundary, **When** the user drops the element onto the boundary, **Then** `onEdit` reports a `reparent` of that element into that boundary, together with its dropped position.
2. **Given** nested boundaries A ⊃ B, **When** the user drops an element over B's area, **Then** the new parent is B, the innermost boundary under the pointer.
3. **Given** a boundary with children, **When** the user drops the whole boundary onto another boundary, **Then** the boundary's whole `{ … }` block moves into the target, with all its children, and each child keeps its alias and its manual position.
4. **Given** an element already inside boundary A, **When** the user drops it elsewhere inside A (a plain drag), **Then** only its position changes and no `reparent` is reported; A grows as it does today.
5. **Given** a boundary, **When** the user drops it onto itself or onto one of its own descendants, **Then** the edit is rejected with a result code (no exception), the source is unchanged and the host can show the message.

---

### User Story 2 - See where the drop will land (Priority: P1)

While dragging, the boundary that would receive the drop is visibly highlighted, so the user knows before releasing which boundary they are moving into (or that they are not moving into one).

**Why this priority**: Without feedback, an inside/outside drop is a guess, and a wrong drop rewrites the source.

**Independent Test**: Start dragging an element and move over different boundaries. Exactly one boundary (the innermost under the pointer) shows the highlight at any time; the highlight disappears over empty canvas and on release or cancel.

**Acceptance Scenarios**:

1. **Given** a drag in progress, **When** the pointer is over a boundary that is a valid target, **Then** that boundary, and only it, is highlighted.
2. **Given** a drag of a boundary, **When** the pointer is over that boundary or one of its descendants, **Then** nothing is highlighted as a drop target (it is an invalid target).
3. **Given** a highlighted target, **When** the user releases, cancels (`pointercancel`) or presses Escape, **Then** the highlight is removed.

---

### User Story 3 - Option-drag to move a child out of its boundary (Priority: P2)

Holding ⌥ (Alt) while dragging a child lifts it out of its current boundary. Released on empty canvas it goes to the top level; released over another boundary it goes into that boundary.

**Why this priority**: Without it there is no mouse gesture to un-nest, because a plain drag only grows the boundary. It depends on User Story 1.

**Independent Test**: With an element inside boundary A, ⌥-drag it to empty canvas and release. The reported edit puts the element at the top level; applying it removes it from A's block; A shrinks back; no other manual position changes.

**Acceptance Scenarios**:

1. **Given** an element in boundary A, **When** the user ⌥-drags it to empty canvas and releases, **Then** a `reparent` to the top level is reported with the dropped position.
2. **Given** an element in boundary A, **When** the user ⌥-drags it onto boundary B and releases, **Then** a `reparent` into B is reported.
3. **Given** the user releases the pointer after having ⌥-dragged, **When** ⌥ is released before the pointer, **Then** the drop is interpreted by the rule in FR-013, not left ambiguous.
4. **Given** an element in A, **When** the user ⌥-drags it and drops it on A itself, **Then** no `reparent` is reported (it stays in A), only the position change.
5. **Given** an element at the top level, **When** the user ⌥-drags it to empty canvas, **Then** it behaves as a plain drag, with no `reparent`.

---

### User Story 4 - Select an element on touch and use its action bar to rename or move out (Priority: P2)

A touch user, with no ⌥ key, taps an element to select it. A small action bar appears next to it with **Rename** and **Move out**. Move out appears only when the element has a parent boundary. Choosing Move out lifts the element to the top level; choosing Rename starts the inline rename. This replaces long-press-on-element as the touch rename gesture from #94.

**Why this priority**: Edit mode is used on iPad. Without an equivalent, touch users could move elements in but never out. The old long-press rename also collides with press-then-drag (a pause before moving turns the drag into a rename), so the same change settles every touch gesture on an element.

**Independent Test**: On a touch device (or touch-emulated pointer events), tap a child element: the action bar shows Rename and Move out. Choose Move out and confirm the same `reparent` to top level is reported as for ⌥-drag on empty canvas. Tap a top-level element: the bar shows Rename only. Press and hold an element, pause, then drag: it moves, with no rename.

**Acceptance Scenarios**:

1. **Given** an element in a boundary on a touch device, **When** the user taps it, **Then** it is selected and an action bar with Rename and Move out appears next to it.
2. **Given** a top-level element, **When** the user taps it, **Then** the action bar shows Rename and no Move out.
3. **Given** the action bar, **When** the user chooses Move out, **Then** a `reparent` to the top level is reported, the same edit as a ⌥-drag out.
4. **Given** the action bar, **When** the user chooses Rename, **Then** the inline rename flow starts for that element.
5. **Given** a selected element, **When** the user taps empty canvas or presses Escape, **Then** it is deselected and the action bar disappears.
6. **Given** a finger pressed on an element, **When** the user pauses and then drags, **Then** the element is dragged and no rename starts.
7. **Given** a long-press on empty canvas or on a boundary, **Then** the add menu opens, as today.
8. **Given** the action bar is shown, **When** an action is chosen, **Then** it does not trigger the add menu or a connect drag.

---

### User Story 5 - Applying a re-parent edit to the source (Priority: P1)

A host calls `applyC4Edit(source, { kind: 'reparent', id, parent? })` and gets new source text in which the element's line, or the boundary's whole block, has moved to the new parent's block (or the top level when `parent` is omitted). Nothing else about the text changes.

**Why this priority**: This is the source-level contract everything else rests on, and it is testable on its own with no UI.

**Independent Test**: Run the function on fixtures containing comments, `Rel` lines with arguments, direction variants, blank lines, CRLF, and nested boundaries. Diff input against output: only the moved lines (and their indentation) differ; the result parses and the element's parent in `parseC4WithSpans` is the requested one.

**Acceptance Scenarios**:

1. **Given** a valid source, **When** a `reparent` is applied, **Then** the result parses and the moved element's parent is the requested one.
2. **Given** a boundary with children, **When** it is re-parented, **Then** the whole block (opening line through closing `}`) moves, children included, and they keep their own relative structure.
3. **Given** `parent` is undefined, **When** the edit is applied, **Then** the line or block goes to the top level using the #92 top-level rule.
4. **Given** an unknown `id`, an unknown or non-boundary `parent`, or a boundary moved into itself or a descendant, **When** the edit is applied, **Then** the result is not ok with a distinct result code, and no exception is thrown.
5. **Given** the element is already a child of the requested parent, **When** the edit is applied, **Then** the source is returned unchanged (or the call is reported as a no-op, by whichever the plan chooses, consistently).

---

### Edge Cases

- Dropping on the element's current parent reports no `reparent` (only the position change).
- Dropping a boundary onto itself or any descendant is rejected and highlights nothing.
- The innermost boundary under the pointer wins when boundaries are nested (existing `findBoundaryAt` behaviour).
- A boundary whose `}` is missing (unterminated) cannot receive a child. It is rejected, not silently mis-nested (same reason as #95).
- A moved block is multi-line; comments, blank lines and `Rel` lines inside it move with it, because they are part of the block.
- A `Rel` line written inside a boundary block that is not part of the moved element is untouched. Relationships are keyed by alias so they survive any move.
- Moving the last child out of a boundary leaves an empty block (`{` then `}`), which renders as the empty-boundary box from #95.
- `pointercancel`, Escape, or losing pointer capture mid-drag cancels the drag with no `reparent` and no position change, and removes the highlight.
- CRLF sources and a missing trailing newline are preserved (as in ADR-92/95).
- If the pointer is released with ⌥ no longer held, see FR-013.
- The moved element keeps the dropped position; a nested drop is clamped into its parent's content area as in #95 so the parent does not shift its own origin.
- A relationship-heavy element moving into a boundary is not treated specially: no warning or confirmation.
- Move, connect, the add menu and rename remain mutually exclusive: a re-parent drag cannot start or run while any of them is active.
- The action bar is hidden while a drag of the selected element is in progress, and is not offered for boundaries (only for elements) unless a boundary is itself a re-parent candidate. [Boundaries can still be moved out by ⌥-drag on desktop; touch move-out for boundaries is covered by the same bar if the plan finds it no more complex, see Assumption A9.]
- Moving an element out via the action bar when its parent is itself nested puts it at the top level, not in the grandparent.
- Entering a drag, rename, connect or the add menu while an element is selected deselects it or hides the bar, so the bar is never stale.
- Leaving edit mode, or changing the diagram so the selected alias no longer exists, clears the selection.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The edit union gains a `reparent` member `{ kind: 'reparent', id, parent?: alias }`, added without changing any existing member or exported type's meaning.
- **FR-002**: `applyC4Edit` with `reparent` moves the element's line, or a boundary's whole `{ … }` block, to the end of the destination: immediately before the new parent's closing `}`, or, for the top level, by the #92 top-level insertion rule (after the last top-level element or boundary block, else before `@enduml`, else the end of text).
- **FR-003**: After a `reparent`, the result parses and the element's parent in `parseC4WithSpans` equals the requested parent (or none for the top level). Every other element keeps its alias and its parent.
- **FR-004**: Apart from the moved lines themselves, and their re-indentation per FR-021, the result is byte-identical to the input: comments, `Rel` arguments, direction variants, blank lines, line endings and every untouched line. Moving a boundary carries all its children, and everything inside its block, with it.
- **FR-005**: Aliases are never changed by a `reparent`, so relationships and manual positions keyed by alias survive.
- **FR-006**: `applyC4Edit` rejects, with a result code and a message and without throwing: an unknown `id`; an unknown `parent`, or a `parent` that is not a boundary; a `parent` that is unterminated (no closing `}`); and moving a boundary into itself or any of its descendants. The source is left unchanged in each case.
- **FR-007**: A `reparent` to the element's current parent is a no-op. The renderer never reports one, and `applyC4Edit` handles it harmlessly.
- **FR-008**: In edit mode, releasing a dragged element or boundary over a boundary reports `onEdit` with a `reparent` into the innermost boundary under the pointer, together with the dropped positions, in the same shape the add edits use.
- **FR-009**: Releasing a drag over the dragged item's current parent reports no `reparent` and only the position change (today's behaviour).
- **FR-010**: While a drag is in progress, the boundary that would receive the drop is highlighted. Only the innermost valid target is highlighted; the highlight is cleared on release, `pointercancel`, Escape or leaving edit mode. Invalid targets (the item itself, its descendants) are never highlighted.
- **FR-011**: Holding ⌥ (Alt) during a drag of a child means "leave my current boundary". Released on empty canvas, it reports a `reparent` to the top level; released over a boundary other than the current parent, it reports a `reparent` into that boundary.
- **FR-012**: After an option-drag out, the old boundary shrinks back to fit its remaining children, and no other manual position changes. The moved item keeps the dropped position.
- **FR-013**: The ⌥ state that counts is the one at the moment of release.
- **FR-014**: A plain (non-⌥) drag that ends on empty canvas, or inside the item's own parent, never reports a `reparent`; a child dragged past its boundary's edge still just grows the boundary, as today.
- **FR-015**: A touch equivalent for "move out" exists: choosing **Move out** in the selected element's action bar (FR-022) reports the same `reparent` to the top level as FR-011 does for a drag onto empty canvas.
- **FR-016**: The re-parent drag handles `pointercancel` (and lost pointer capture) by abandoning the gesture with no edit and no position change.
- **FR-017**: Re-parenting is available only when edit mode is on and `onEdit` is supplied. Move, connect, the add menu and rename stay mutually exclusive.
- **FR-018**: The package never writes the source or positions anywhere. `onEdit` reports, and the host applies. The change is additive: existing props, edits and results keep their types and meanings.
- **FR-019**: A `reparent` whose result does not re-parse to the intended structure (every other element present with its original parent; the moved element or block under its new parent) is reported as `invalid-result` rather than returned as ok, in the same spirit as ADR-95's `verify`.
- **FR-020**: Documentation is updated: the playground shows the feature; the recipes describe the host's responsibilities for `reparent`; and an ADR is added at `adrs/99-<slug>.md` titled `# ADR-99: …`. The ADR records the "one contiguous block" amendment for a move (Assumption A1), and the touch-gesture change in FR-023.
- **FR-021**: A moved line, or every line of a moved boundary block, is re-indented to the destination's sibling indent: the same rule `add-element` uses (the last sibling's indent, else the parent's indent plus one unit; top level uses the top-level indent). A boundary block is shifted by one uniform amount, so its internal relative indentation is preserved. Blank lines stay blank. Apart from indentation, line content is unchanged.
- **FR-022**: In edit mode, tapping an element selects it and shows a small action bar next to it with **Rename** and **Move out**. **Move out** is shown only when the element has a parent boundary. Tapping empty canvas, or pressing Escape, deselects the element and hides the bar.
- **FR-023**: On touch, long-press on an element no longer starts a rename (this replaces the #94 touch rename gesture); rename on touch is started from the action bar's **Rename**. A pause between pressing an element and dragging it never turns the drag into a rename.
- **FR-024**: Long-press stays only on empty canvas and on boundaries, where it opens the add menu, as today.
- **FR-025**: On desktop, ⌥-drag still moves out and double-click still renames. The action bar may also appear on desktop if that is simpler.
- **FR-026**: Choosing an action in the action bar does not start the add menu or a connect drag, and starting any of move, connect, the add menu or rename hides the bar, so the four stay mutually exclusive.
- **FR-027**: Moving an element out via the action bar leaves its position unchanged (it keeps where it is on the canvas) and reports it to `onEdit` in the same shape as other edits, positions included.
- **FR-028**: Moving out places the element at the top level, regardless of how deeply its parent is nested.

### Key Entities *(if applicable)*

- **Reparent edit**: `{ kind: 'reparent', id, parent? }`. `id` is the alias of the element or boundary being moved. `parent` is the alias of the destination boundary; omitted means top level.
- **Drop target**: the innermost boundary under the pointer at release, excluding the dragged item and its descendants; none means the top level.
- **Moved block**: for an element, its single line; for a boundary, its opening line through its closing `}`, including everything between.
- **Selected element / action bar**: the single element a user has tapped in edit mode, and the small bar beside it offering Rename and (when it has a parent boundary) Move out.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can move an element into a boundary, and out of it, using only the diagram (no source editing), on desktop and on touch.
- **SC-002**: For every re-parent fixture, a diff of input against output shows only the moved lines, re-indented to the destination; every other line is byte-identical.
- **SC-003**: Every alias, and every manual position keyed by alias, present before a re-parent is present and unchanged after it, except the moved item's own dropped position.
- **SC-004**: In 100% of attempts to move a boundary into itself or a descendant, the result is a coded rejection with the source unchanged and no exception.
- **SC-005**: During any drag, exactly zero or one boundary is highlighted, and it is the one that receives the drop if released.
- **SC-006**: An option-drag to empty canvas yields a `reparent` to top level, the old boundary shrinks to fit its remaining children, and no other element's manual position changes.
- **SC-007**: A plain drag within the current boundary produces no `reparent`, and its behaviour is identical to before this change.
- **SC-008**: The existing test suite for #92, #94 and #95 passes unchanged, except for the tests that asserted the old touch long-press-to-rename behaviour, which are replaced by tests of FR-022 and FR-023.
- **SC-009**: On touch, a press, pause and drag on an element never starts a rename, and a tap-selected child element can be moved out with two taps (select, then Move out).

## Assumptions

- **A1: "One contiguous block" becomes "one moved block".** A move removes a block at its old place and inserts it at the new one, so the "pure insertion" guarantee of ADR-92/95 cannot hold for it. The guarantee that carries over is: only the moved block changes, in position and indentation; every other byte is identical. The ADR will record this as an amendment, as ADR-95 did for ADR-92.
- **A2: A moved boundary's children keep their manual positions** (keyed by alias), and the dropped position applies to the dragged item.
- **A3: ⌥ is read at release.** If ⌥ was held at the end of the drag, the "move out" rule applies; this is the simplest model and avoids a stuck-modifier state.
- **A4: Elements can be dropped into any boundary kind** (`Boundary`, `System_Boundary`, `Container_Boundary`); C4 nesting rules are not enforced, consistent with #92 Q3. There is no warning for moving a relationship-heavy element.
- **A5: A drop onto the item's current parent in a non-⌥ drag is a plain move**, and in an ⌥ drag it is also a plain move (the item stays where it is). ⌥ only matters when the item is not dropped on its own parent.
- **A6: Lines only inside the moved block are moved.** Comments or blank lines *adjacent* to an element's line (above it, say) are not part of the move; only the element's own line (or the boundary's own block) moves.
- **A7: Decisions recorded from the Specify discussion:** re-indent to the destination's sibling indent (FR-021); touch uses tap-to-select with an action bar (FR-022 to FR-024); no warning on relationship-heavy moves; the moved line goes last in the destination block, just before its `}` (FR-002).
- **A8: The touch rename change is part of this issue.** The Background describes the touch rename gesture as "being reconsidered separately"; that reconsideration is settled here, and the replacement (action bar Rename) ships with this change.
- **A9: The action bar is for elements.** A boundary can already be moved into another boundary by drag; whether the bar also offers Move out for a boundary on touch is left to the plan, and is acceptable either way provided a touch user has some way to move a nested boundary out (the bar is the expected one).
- **A10: Selection is transient UI state.** It is not reported to the host, not persisted, and cleared when leaving edit mode or when the selected alias disappears.

## Out of Scope *(optional)*

- Wrapping several existing elements in a new boundary.
- Delete.
- Multi-select, and therefore moving several elements at once.
- Reordering siblings within the same boundary (a move within the same parent changes position only).
- Enforcing C4 nesting rules (for example, containers only in system boundaries).
- Further actions in the action bar beyond Rename and Move out (for example Delete).

## Source References *(optional)*

- Issue #99 and the earlier editing work: #92 (add elements and relationships), #94 (positions, and the touch long-press rename this change replaces), #95 (add boundaries).
- `adrs/92-structural-editing-edit-api.md` and `adrs/95-multi-line-boundary-insertion.md`: the edit union, placement rules, `verify`, and the "one contiguous block" amendment this change extends.
- `specs/92-add-elements-and-relationships-from-the-diagram/` and `specs/95-add-boundaries-from-the-diagram-s-context-menu/`: previous specs for the same area.
- README "Add elements and relationships": current `onEdit` host contract (apply source and positions together, merge never clear).
