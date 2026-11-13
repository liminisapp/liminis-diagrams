# Feature Specification: Add elements and relationships from the diagram (structural editing)

**Feature Branch**: `fabrik/issue-92`
**Created**: 2026-11-13
**Status**: Specified
**Input**: User description: "## Problem

Today a C4 diagram can be rendered and its nodes dragged, and nothing else. To add a box or connect two boxes, the user has to leave the diagram and edit C4-PlantUML by hand. We want users to **add new elements and relationships directly from the rendered diagram**, while dragging keeps working as it does now.

The background, the constraints we have already found and the open questions are in **[`ideas/structural-editing.md`](https://github.com/liminisapp/liminis-diagrams/blob/main/ideas/structural-editing.md)**. Read it first. It is a pre-spec sketch, not a plan.

## Desired outcome

In edit mode, a user can:

1. **Add an element.** Choose a kind, place it on the canvas, and have it land where it was placed. This works at the top level and inside an existing boundary.
2. **Add a relationship.** Drag from one element to another to create a `Rel` between them.

Each action changes the diagram's **C4-PlantUML source** by the minimal insertion, and the host decides what to do with that change. The in-repo playground (`src/playground/C4Playground.tsx`) is the reference host and must demonstrate both actions end to end.

## Hard constraints

These were settled in the ideas doc. Please don't reopen them without raising it.

- **The source text stays canonical.** An edit is a minimal line-level patch to the source. It is **never** a re-serialisation of the model. The AST in `src/core/types.ts` is a lossy rendering model:
  - a `Rel`'s technology argument is dropped;
  - the `Rel_D`/`Rel_U` variants collapse into one;
  - the `_Ext`/`Db`/`Queue` macro variants collapse;
  - comments and directives are stripped.

  Regenerating text from the AST would destroy hand-written diagrams.
- **This package never writes anywhere.** That is Limitations item 2 on the docs site. The renderer reports an edit through a callback, and the host applies it. This is the same controlled pattern as `onPositionChange`.
- **The core edit logic is headless.** It lives in `./core`, works without React, and is unit-tested on its own. The react layer only produces edit intents.
- **The public API changes are additive.** Existing consumers of `parseC4`, `layoutC4Diagram` and `C4InteractiveRenderer` must keep working unchanged.
- **All new affordances sit behind `isEditMode`.** A read-only render gains nothing.
- **Interaction uses pointer events and handles `pointercancel`.** The reason is in `src/react/hooks/useC4DiagramDrag.ts`: mouse-only drag failed on iPadOS. A move-drag and a connect-drag must be distinguishable gestures.

## Acceptance criteria

- [ ] **Top-level element.** In the playground, adding an element at the top level inserts exactly one macro line into the source. No other line changes.
- [ ] **Element inside a boundary.** Adding an element inside a boundary inserts exactly one macro line inside that boundary's block, indented to match its siblings.
- [ ] **Relationship.** Dragging from element A to element B inserts exactly one `Rel(...)` line. No other line changes.
- [ ] **Comments and arguments preserved.** On a fixture with comments, `Rel` technology arguments, a direction variant and stripped directives, each edit leaves all of them byte-identical. This is checked by diffing the source before and after.
- [ ] **Placement.** A newly added element appears where the user placed it. Elements that already had manual positions do not move.
- [ ] **Valid output.** Every edited source parses with `parseC4`, with no errors, and contains the new element or relationship.
- [ ] **Unique aliases.** Generated aliases are unique within the diagram and are valid C4-PlantUML identifiers, including when a label collides with an existing alias.
- [ ] **Unit tests for the edit function.** The core edit function has unit tests that cover insertion points, indentation, quoting and escaping of labels, and alias collisions.
- [ ] **Docs updated.** The docs Limitations section (`docs/src/content/docs/index.mdx`, item 1 \"No editing affordance\") and the recipes describe the new capability and the host's responsibilities. A worked host example is included.

## Out of scope

- **Delete, rename, re-parent, and editing an existing relationship.** These are obvious follow-ups. Shape the edit API so that adding them later is additive, but don't build them.
- **The `liminis-editor` host change.** Its `C4Component.tsx` clears the whole manual layout whenever the set of element ids changes (the \"TASK 7\" effect). That must become *merge* behaviour before this feature is usable there. That work belongs in `liminisapp/liminis-editor` and will be filed separately. This issue should make the right host behaviour easy and document it, not reach into that repo.
- **Deployment nodes and the boundary macros as addable kinds.** Leave them to the source unless Specify finds they come for free.
- **Enforcing C4 nesting rules** in the UI (for example, Components only inside a `Container_Boundary`), unless Specify decides otherwise. See open question 3.

## Open questions for Specify to resolve

These are listed in full in the ideas doc. Please put them to the user, and don't pick answers silently.

1. **How does a new element get its label?** The options are:
   - a placeholder, which the user then renames in the source;
   - inline label editing on the diagram;
   - a host callback.

   This is the main scope question. The ideas doc leans towards inline editing of the label only.
2. **Which kinds can be added in the first cut?**
3. **Should C4 nesting rules be enforced: warn, block, or neither?**
4. **Can a relationship start or end on a boundary?**
5. **Where is a top-level insertion placed?** It must come before any `@enduml`.
6. **When adding a node would reshuffle the elements that have no manual position yet, what happens?** One option is to pin every visible node on the first structural edit. The other is to accept the reshuffle.

## Pointers

- `src/core/parser.ts`: a line-based parser that already tracks `lineNum` but records no source spans.
- `src/core/types.ts`: the AST, which has no source locations.
- `src/react/C4InteractiveRenderer.tsx`: the controlled renderer, with props `diagram`, `manualPositions` and `onPositionChange`.
- `src/react/hooks/useC4DiagramDrag.ts`: the existing pointer-event drag.
- `src/playground/C4Playground.tsx`: the reference host, which already holds `text` and `positions` in state.
- #27 is the diagram-wiki goal. Its storage format is \"plain text, line-diffable\" in git, which is why edits must be minimal patches."

## Background

Today a C4 diagram can be rendered and its nodes dragged, and nothing else. To add a box or connect two boxes, the user has to leave the diagram and hand-edit C4-PlantUML. The goal is to let users **add elements and relationships directly from the rendered diagram** while drag keeps working as it does now.

Design background lives in `ideas/structural-editing.md` (a pre-spec sketch). Its settled principles, which this spec treats as fixed constraints:

- **The source text is canonical.** The parsed model is deliberately lossy (it drops `Rel` technology, collapses direction and `_Ext`/`Db`/`Queue` variants, strips comments and directives). Regenerating text from it would destroy hand-written diagrams, so an edit is a minimal line-level patch to the source, never a re-serialisation.
- **The package never writes anywhere** (docs Limitations item 2). The renderer reports an edit through a callback and the host applies it, the same controlled pattern as position changes. Undo comes free from whatever the host already has.
- **Diffs stay line-sized**, which matters for the diagram-wiki goal (#27), where diagrams are plain text in git.
- **The editing logic is headless** (usable from a test, a CLI or an agent, without React); the interactive layer only produces edit intents.
- **Hosts must merge positions, not clear them.** `liminis-editor` currently clears the entire manual layout whenever the set of element ids changes. That would throw away every arranged position the moment one box is added. Fixing it is separate work in that repo; this feature must make the right behaviour easy and document it.
- **Lessons already paid for:** pointer events with `pointercancel` handling (mouse-only drag failed on iPadOS); move-drag and connect-drag must be unambiguous gestures; all affordances stay behind edit mode.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add an element where I place it (Priority: P1)

In edit mode, I choose an element kind, place it on the canvas (at the top level or inside an existing boundary), name it with an inline label input, and a new element appears exactly where I placed it. The host receives a one-line source insertion and applies it.

**Why this priority**: Adding a box is the most basic structural edit and unblocks everything else. The headless edit function that powers it is also the foundation for relationships.

**Independent Test**: In the playground, add an element at the top level and another inside a boundary; diff the source before and after each, and confirm one macro line was inserted, the diagram re-renders with the new element at the placed spot, and previously positioned elements did not move.

**Acceptance Scenarios**:

1. **Given** a parseable diagram in edit mode, **When** I add an element at the top level, **Then** exactly one macro line is inserted (after the last top-level element and before the first top-level `Rel`, or before `@enduml` as a fallback), no other line changes, and the element appears where I placed it.
2. **Given** a diagram with a boundary, **When** I add an element inside that boundary, **Then** exactly one macro line is inserted inside that boundary's block, indented like its siblings.
3. **Given** elements with manual positions, **When** I add a new element, **Then** those elements keep their positions.
4. **Given** an existing element whose alias equals the slug of the new label, **When** I add the element, **Then** the generated alias is unique and a valid identifier.
5. **Given** a label with quotes or other characters special in C4-PlantUML, **When** I add the element, **Then** the inserted line is correctly quoted/escaped and the source still parses.
6. **Given** I have placed a new element, **When** the inline label input appears, **Then** it is pre-filled with a kind-appropriate placeholder label, and confirming it (as is or edited) reports the add with that label.
7. **Given** the inline label input is open, **When** I cancel it (Escape or `pointercancel`), **Then** nothing is inserted and no stuck state remains.

---

### User Story 2 - Connect two elements by dragging (Priority: P1)

In edit mode, I drag from one element to another and a `Rel` between them is added to the source as one new line.

**Why this priority**: Relationships are the other half of the requested capability and the second action the playground must demonstrate.

**Independent Test**: In the playground, drag from element A to element B; diff the source and confirm exactly one `Rel(...)` line was added, and the edited source parses and contains the relationship.

**Acceptance Scenarios**:

1. **Given** two elements in edit mode, **When** I drag from A to B, **Then** exactly one `Rel(...)` line from A to B is inserted and no other line changes.
2. **Given** a diagram with comments, `Rel` technology arguments, a direction variant (e.g. `Rel_D`) and stripped directives, **When** I add a relationship, **Then** all of those are byte-identical afterwards.
3. **Given** edit mode, **When** I press on a node to move it, **Then** it moves as today and no relationship is created; a connect-drag and a move-drag are never confused.
4. **Given** a connect-drag in progress, **When** the pointer is cancelled (e.g. `pointercancel` on iPadOS) or released over empty canvas, **Then** nothing is inserted and no stuck state remains.
5. **Given** a read-only render (not edit mode), **Then** no add or connect affordance is present.
6. **Given** a boundary in the diagram, **When** I drag a connection that starts or ends on the boundary, **Then** no relationship is created.

---

### User Story 3 - Headless edits for hosts, tools and agents (Priority: P2)

A tool builder or agent applies the same add-element / add-relationship edits to C4-PlantUML text without React, getting back the new source, and can see how to wire the interactive renderer's edit callback into a host.

**Why this priority**: It is the stated architecture and what makes the feature reusable and testable, but the user-visible value is delivered by Stories 1–2.

**Independent Test**: Call the edit function from a plain unit test on a fixture and diff results; follow the docs' worked host example to wire a host.

**Acceptance Scenarios**:

1. **Given** source text and an edit description, **When** the edit function is called, **Then** it returns new source differing only by the inserted line(s), with no model re-serialisation.
2. **Given** the docs, **When** a tool builder reads them, **Then** the Limitations section no longer says there is no editing affordance, and the recipes explain the host's responsibilities (apply the edit, merge positions rather than clear them) with a worked example.

---

### Edge Cases

- Source does not parse (`parseC4` yields no diagram): there is nothing to click, so editing is unavailable until the text parses again.
- Source with `@startuml`/`@enduml`: top-level insertions land before `@enduml`.
- Source with no `@startuml`/`@enduml` wrapper at all.
- Source with no elements yet (insertion falls back to before `@enduml`, or end of file).
- Source with no top-level `Rel` (insertion goes after the last top-level element).
- Boundary on a single line vs. a multi-line block; an empty boundary with no siblings to copy indentation from; tabs vs. spaces; CRLF line endings.
- Labels containing double quotes, backslashes, commas, parentheses or non-ASCII; labels that are empty or whitespace; labels that slug to nothing (e.g. only symbols).
- Alias collisions with an existing alias, with a macro keyword, or repeated collisions (`cache`, `cache_2`, …).
- A drag that starts and ends on the same element (self-relationship); a duplicate of an existing relationship between the same pair.
- A connect-drag started or released on a boundary creates nothing.
- The first structural edit on a diagram where some elements have only automatic positions: all visible nodes are pinned at their current positions (see FR-027).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The core package MUST provide a headless function that takes C4-PlantUML source and an edit description and returns the new source, without depending on React.
- **FR-002**: The edit description MUST be a discriminated union with at least an add-element edit and an add-relationship edit, shaped so that further edit kinds (delete, rename, re-parent, edit relationship) can be added later without breaking existing callers.
- **FR-003**: An edit MUST be a minimal line-level insertion into the original text; no existing line may be modified, and the model MUST NOT be re-serialised.
- **FR-004**: Comments, `Rel` technology arguments, direction-variant macros and stripped directives (`!include`, `SHOW_LEGEND()`, `title`, `LAYOUT_*`, etc.) MUST remain byte-identical after any edit.
- **FR-005**: Adding a top-level element MUST insert exactly one macro line, placed after the last top-level element or boundary and before the first top-level `Rel`; when there is no top-level element, it falls back to immediately before `@enduml` (or the end of the source if there is none). It MUST never land after `@enduml`.
- **FR-006**: Adding an element inside a boundary MUST insert exactly one macro line inside that boundary's block, indented to match its siblings.
- **FR-007**: Adding a relationship MUST insert exactly one `Rel(...)` line connecting the chosen source and target elements.
- **FR-008**: Generated aliases MUST be unique within the diagram and be valid C4-PlantUML identifiers, including when the label collides with an existing alias.
- **FR-009**: Labels and other text arguments MUST be quoted and escaped so the inserted line parses correctly and round-trips the user's text.
- **FR-010**: Every source produced by an edit MUST parse with `parseC4` without errors and contain the new element or relationship.
- **FR-011**: Locating insertion points MUST be supported by source-location information recorded by the parser (element, relationship and boundary line spans, including a boundary's closing line), added without changing the existing shape of parse results for current consumers.
- **FR-012**: The interactive renderer MUST report an edit through a callback carrying the edit description and, for added elements, the position where the user placed them. It MUST NOT apply the edit itself or write anywhere.
- **FR-013**: In edit mode only, the renderer MUST offer an add-element affordance: choose a kind, place it on the canvas, optionally inside a boundary. The addable kinds are Person, System, Container and Component, plus the `Db` (cylinder) variant of System, Container and Component. `_Ext`, `Queue`, boundaries and deployment nodes are not offered.
- **FR-014**: In edit mode only, the renderer MUST offer a connect gesture: dragging from one element to another creates a relationship.
- **FR-015**: Move-drag and connect-drag MUST be distinguishable gestures; existing move behaviour MUST be unchanged.
- **FR-016**: New interactions MUST use pointer events and MUST handle `pointercancel`, leaving no stuck gesture state.
- **FR-017**: A newly added element MUST appear where the user placed it; elements that already had manual positions MUST NOT move. Elements without manual positions are handled by FR-027.
- **FR-018**: A read-only render (not in edit mode) MUST gain no new affordances, and existing consumers of `parseC4`, `layoutC4Diagram` and `C4InteractiveRenderer` MUST keep working unchanged (additive API only).
- **FR-019**: Structural-editing affordances MUST be unavailable while the source does not parse.
- **FR-020**: The in-repo playground MUST demonstrate both actions end to end: it applies the reported edit to its source text and merges the new element's position into its positions.
- **FR-021**: The edit function MUST have unit tests covering insertion points, indentation, quoting and escaping of labels, and alias collisions, plus a fixture test proving FR-004 by diffing source before and after.
- **FR-022**: The docs MUST be updated: Limitations item 1 ("No editing affordance") reflects the new capability; the recipes describe it and the host's responsibilities (apply the edit; merge, don't clear, manual positions), including a worked host example.
- **FR-023**: A new element MUST get its label through inline label editing on the diagram, scoped to the label only: after placement, an input appears over the new element pre-filled with a kind-appropriate placeholder label. The edit is reported only once the label is confirmed; cancelling reports nothing.
- **FR-024**: A relationship MUST NOT start or end on a boundary in this first cut: the connect gesture only targets non-boundary elements, and boundary relationships remain a source-level feature.
- **FR-025**: The UI MUST NOT enforce C4 nesting rules (no warning, no blocking): an element may be added in any boundary regardless of kind, matching what the parser accepts.
- **FR-026**: The inline label input MUST be usable with pointer and keyboard (confirm and cancel), appear only in edit mode, and leave the source unchanged until the label is confirmed.
- **FR-027**: On the first structural edit, the position of every currently visible node MUST be pinned (reported to the host together with the new element's position) so that adding a node does not reshuffle elements that previously had only automatic positions. Hosts then store these positions as manual positions, merged with existing ones.

### Key Entities *(if applicable)*

- **Edit**: A description of one structural change (add element, add relationship; later delete, rename, etc.) that the headless function applies to source text and the renderer reports to its host.
- **Source span**: The line range of an element, relationship or boundary (including a boundary's closing line) in the original text, used to find insertion points.
- **Alias**: The C4-PlantUML identifier of an element, unique per diagram. Manual positions are keyed by it, so a generated alias must be stable once created.
- **Placement**: The canvas position where the user put a new element, travelling with the edit so the host can store it with the other manual positions.
- **Pinned positions**: The current positions of all visible nodes, reported with the first structural edit so the host can store them and keep the layout stable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the playground, adding a top-level element, an element inside a boundary, and a relationship each change the source by exactly one inserted line (verified by diff).
- **SC-002**: On a fixture with comments, `Rel` technology arguments, a direction variant and stripped directives, 100% of those lines are byte-identical after each edit type.
- **SC-003**: Every edited source in the test suite parses with `parseC4` with zero errors and contains the new element or relationship.
- **SC-004**: A newly added element renders at the placed position, and every element that had a manual position before the edit has the same position after it.
- **SC-005**: Generated aliases are unique and valid identifiers across test cases that include label/alias collisions and awkward labels.
- **SC-006**: With edit mode off, a render exposes zero new interactive affordances, and the existing test suite passes unchanged.
- **SC-007**: A tool builder can follow the docs' worked host example to apply edits and merge positions without reading the package source.
- **SC-008**: After the first structural edit in the playground, no previously visible element has moved from its pre-edit position, including elements that had no manual position before.

## Assumptions

- Relationships added by the UI use plain `Rel` with a label and no technology argument (technology can be added by hand later); the edit function accepts an optional technology. The relationship label's default is a placeholder or empty, to be settled in planning.
- Structural editing is disabled while the source does not parse, since `parseC4` yields no diagram to interact with.
- Alias generation is a slug of the label with a numeric suffix on collision, since the issue only requires uniqueness and validity.
- Confirming an empty inline label falls back to the placeholder rather than inserting an empty label; cancelling (Escape or `pointercancel`) inserts nothing.
- Adding elements and relationships is undone through whatever undo the host already has; this package adds none.
- The `liminis-editor` merge-positions change is separate work in that repo; this issue only makes the right host behaviour easy and documents it.
- The pinning in FR-027 applies the first time a diagram receives a structural edit in a session; subsequent edits only need the new element's position, since all nodes are then manual.

## Out of Scope *(optional)*

- Delete, rename, re-parent, and editing an existing relationship (the edit API is shaped so these can be added later).
- The `liminis-editor` host change (replacing its clear-layout-on-id-change effect with merge behaviour), to be filed in that repo.
- Deployment nodes and the boundary macros as addable kinds; `_Ext` and `Queue` variants as addable kinds.
- Relationships that start or end on a boundary.
- Enforcing or warning about C4 nesting rules in the UI.
- Any persistence or file writing by this package.

## Source References *(optional)*

- `ideas/structural-editing.md` — pre-spec sketch with the settled constraints and the full open-question list
- `docs/src/content/docs/index.mdx` — Limitations section (items 1 and 2)
- #27 — diagram-wiki goal (plain-text, line-diffable storage)
