# Feature Specification: Add boundaries from the diagram's context menu

**Feature Branch**: `fabrik/issue-95`
**Created**: 2026-11-13
**Status**: Specified
**Input**: User description: "## Problem

After #93, elements can be added *inside* an existing boundary from the diagram's context menu, but a boundary itself can't be created from the diagram. To show what is inside a container or system (for example `Container_Boundary(api, \"API Application\") { Component(...) }`), the user has to write the boundary block in the source first.

## Desired outcome

In edit mode, the context menu also offers boundary kinds. Choosing one inserts an empty boundary block at the clicked point, at top level or nested in another boundary. Elements can then be added into it with the existing flow.

## Hard constraints (carried over from #92)

- **A minimal insertion.** This is the first edit that inserts more than one line: an opening line `X_Boundary(alias, \"Label\") {` plus a closing `}`, inserted together at one point. No existing line changes. The \"exactly one line\" rule from #92 becomes \"exactly one contiguous block\" for this kind only.
- Indentation follows the same sibling rules as `add-element`, with the closing brace aligned to the opening line.
- The alias is generated and validated exactly as for elements.
- An additive `add-boundary` member of the edit union (or a boundary `elementKind` on `add-element`, whichever Specify prefers). The package never writes anywhere.

## Acceptance criteria

- [ ] `applyC4Edit` inserts `System_Boundary`, `Container_Boundary` and `Boundary` blocks at top level and nested. The result parses, and its `parseC4WithSpans` span has a `closeLine`, so `add-element` into it works straight away.
- [ ] Fixture tests show every pre-existing line is byte-identical after the edit.
- [ ] An **empty** boundary renders and lays out sensibly (a visible, placeable box) and is a valid click target for adding a child. Verify this. Today's layout may assume boundaries have children.
- [ ] The context menu lists the boundary kinds, visually separated from element kinds. The label flow is the same as for elements.
- [ ] The new boundary appears where it was placed, and existing manual positions don't move.
- [ ] The playground and recipes are updated.

## Out of scope

Wrapping *existing* elements in a new boundary (that is re-parenting). Deployment nodes. `Enterprise_Boundary`, unless it comes for free. Relationships to and from boundaries, which stay excluded as in #92 Q4.

## Open questions for Specify

1. Should there be a separate `add-boundary` kind, or a boundary `elementKind` on `add-element`?
2. Which boundary macros go in the first cut?
3. How is a manual position stored for an empty boundary, and how does the layout size it?
4. Should the playground's \"insert into boundary\" hit-testing prefer the innermost boundary when they are nested? Check what #93 does today.

## Pointers

- `src/core/edit.ts`, `src/core/alias.ts`, `parseC4WithSpans`
- `src/react/EditMenu.tsx`, `src/react/hit-test.ts`
- the layout code in `src/core` (how boundaries are sized)
- #92 / #93; `ideas/structural-editing.md` open question 2"

## Background

After #92/#93, a user can add elements from the diagram's context menu, at top level or inside an existing boundary. A boundary itself still cannot be created from the diagram. To show what is inside a container or system (for example `Container_Boundary(api, "API Application") { Component(...) }`), the user has to write the boundary block in the source first, which breaks the flow the context menu was built for.

The governing principle from #92 (ADR-92) is unchanged: an edit is a **minimal patch to the source text**. Nothing existing is re-serialised or changed, comments and directives survive, diffs stay small, and the package never writes anywhere; the host applies the returned text. This is the first edit that inserts more than one line (an opening line plus a closing `}`), so the "exactly one line" wording of that principle becomes "exactly one contiguous block".

Findings from reading the merged #93 work on `main` (this branch is behind it), which shaped the answers to the open questions below:

- The edit union is `add-element | add-relationship`; the result reports a single `insertedLine`. ADR-92 states boundaries as addable kinds were "not built".
- Adding into a boundary inserts immediately before its closing `}`, and boundaries that cannot take a pure insertion are rejected with `boundary-cannot-take-children`. A newly created boundary must therefore have a real, separate closing-brace line.
- Click-target resolution already prefers the **deepest** boundary containing the point (geometric, by nesting depth, not paint order). Nested boundaries are therefore already handled; this issue only needs to keep it true.
- Manual positions are `{ x, y }` keyed by alias; a boundary's size is not stored. In the manual-position layout, a boundary with no children takes the same default box dimensions as any other node, and one with children grows to contain them. Auto layout does the same for a childless boundary. So an empty boundary should already render as a default-sized box, but this has never been exercised and must be verified.
- Every structural edit pins all currently laid-out nodes and merges host positions, so existing positions never move (ADR-92 decision 8). That behaviour must extend to boundary edits.
- Boundaries currently get no connect handle, and relationships on boundaries are blocked in the UI. This stays.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a boundary to the source programmatically (Priority: P1)

A host, test or agent calls `applyC4Edit` to add an empty boundary of kind `System_Boundary`, `Container_Boundary` or `Boundary`, at top level or inside an existing boundary, and gets back new source text.

**Why this priority**: The headless edit is the foundation. Everything else (menu, playground) is a thin layer over it, and it carries the hard minimal-insertion constraint.

**Independent Test**: Run `applyC4Edit` with a boundary edit over the existing fixtures and a few hand-written sources; compare before and after line by line.

**Acceptance Scenarios**:

1. **Given** valid source with elements and a top-level boundary, **When** a `Container_Boundary` is added at top level, **Then** the result contains two new lines (the opening line ending in `{`, and a closing `}`) inserted together at one point, and every original line is byte-identical and in the same order.
2. **Given** an existing boundary with sibling elements, **When** a `System_Boundary` is added inside it, **Then** the new block is indented like its siblings and the closing `}` is aligned with the new opening line.
3. **Given** the result of any boundary edit, **When** it is passed to `parseC4WithSpans`, **Then** it parses without errors, the new boundary exists with the requested macro kind, label and parent, and its span has a `closeLine`.
4. **Given** the result of a boundary edit, **When** `add-element` targets the new boundary as `parent`, **Then** it succeeds and the element lands between the new boundary's opening and closing lines.
5. **Given** a label that collides with an existing alias, or an explicit alias that is invalid or already used, **When** a boundary is added, **Then** the outcome is exactly what `add-element` gives in the same situation (generated alias with suffix, or `invalid-alias` / `alias-collision`).
6. **Given** source that does not parse, an unknown `parent`, or a `parent` that cannot take children, **When** a boundary is added, **Then** a typed error result is returned (same codes as `add-element`) and nothing is thrown.
7. **Given** CRLF line endings or a missing trailing newline, **When** a boundary is added, **Then** the new lines use the file's line ending and untouched bytes are preserved exactly.

---

### User Story 2 - Add a boundary from the context menu (Priority: P1)

In edit mode with `onEdit` supplied, the user opens the context menu on empty canvas or inside a boundary, sees boundary kinds listed apart from element kinds, picks one, names it, and an empty boundary appears where they clicked.

**Why this priority**: This is the user-visible feature the issue exists for.

**Independent Test**: In the playground (and a component test), open the menu, choose a boundary kind, type a label, confirm; check the source diff and the diagram.

**Acceptance Scenarios**:

1. **Given** edit mode with `onEdit`, **When** the menu opens, **Then** it lists the boundary kinds in a group visually separated from the element kinds, and the menu remains keyboard-navigable across both groups.
2. **Given** the user chooses a boundary kind, **When** the label input appears and they confirm (or press Enter), **Then** `onEdit` is called once with the boundary edit and a `positions` map; Escape or an empty cancel reports nothing, exactly as for elements.
3. **Given** the user confirms with an empty label, **When** the edit is reported, **Then** a per-kind default placeholder label is used, as for elements.
4. **Given** the menu was opened on empty canvas, **When** a boundary is added, **Then** it is top level; **Given** it was opened inside a boundary, **Then** the new boundary is nested in the innermost boundary containing the click point.
5. **Given** a diagram with some manually positioned nodes and some auto-laid-out ones, **When** a boundary is added, **Then** the new boundary appears at the clicked point and no other node moves.

---

### User Story 3 - Fill the new boundary straight away (Priority: P1)

After creating an empty boundary, the user right-clicks inside it and adds an element, or another boundary, with the existing flow.

**Why this priority**: The point of the feature is to show what is inside a boundary; an unusable empty box would defeat it.

**Independent Test**: Create a boundary, then right-click inside its box and add an element; check the element is inside the boundary in both source and diagram.

**Acceptance Scenarios**:

1. **Given** a just-added empty boundary rendered as a visible box, **When** the user opens the menu inside it, **Then** it is the resolved parent and a new element or boundary goes inside it.
2. **Given** nested boundaries, **When** the menu opens inside the inner one, **Then** the inner boundary is the parent, not the outer.
3. **Given** a hand-written source containing an empty boundary (`X_Boundary(a, "A") {` then `}`), **When** it is rendered, **Then** it also shows as a visible, draggable box and accepts children the same way.

---

### User Story 4 - Docs and playground show it (Priority: P2)

The playground demonstrates adding a boundary, and the recipes and docs describe the new edit and its multi-line exception.

**Why this priority**: Required by the issue, but it follows the behaviour.

**Independent Test**: Read the recipes page and use the playground; both match the shipped behaviour.

**Acceptance Scenarios**:

1. **Given** the playground, **When** a user adds a boundary and then an element inside it, **Then** the source pane shows the inserted block and diff as described in the recipe.
2. **Given** the recipes and docs, **When** read, **Then** they describe the boundary edit, state that "one line" is now "one contiguous block" for boundaries, and no longer list boundaries as not addable.

---

### Edge Cases

- A boundary added at top level goes where a top-level element would (after the last top-level element or boundary block, else before `@enduml`); inside a boundary it goes immediately before that boundary's closing `}`, after its existing children.
- Adding into a boundary that cannot take a pure insertion (no braces, single-line `{ }`, unterminated) fails with the existing error code, with no change to the source.
- An empty parent boundary with no siblings to copy indentation from still gets sensible indentation (the parent's indentation plus one indent unit as used elsewhere in the file).
- A sanitised or empty label behaves as for elements (quotes, backslashes and control characters are neutralised; empty falls back to the placeholder).
- Adding a boundary must not hide or reorder existing nodes: the parent of a nested new boundary may grow to contain it, but no node that already has a manual position changes position.
- A new boundary has no connect handle and cannot be a relationship endpoint (unchanged from #93).
- Source that does not parse offers nothing to click, so editing stays unavailable until it parses (unchanged).
- Hosts that pass `isEditMode` without `onEdit` see no menu and no change.
- Menu opened over an element, a connect handle or the legend does not open (unchanged); this includes not opening a boundary menu there.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `applyC4Edit` MUST support adding a boundary of kind `System_Boundary`, `Container_Boundary` or `Boundary`, at top level or inside an existing boundary (`parent`).
- **FR-002**: Adding a boundary MUST be a pure insertion of exactly one contiguous block of two lines (an opening line `<Macro>(<alias>, "<label>") {` and a closing `}`) at a single point. No existing byte of the source may change, and all original lines MUST remain byte-identical and in order.
- **FR-003**: Boundaries MUST be added through a dedicated additive member of the `C4Edit` union (`add-boundary`), rather than as a boundary kind on `add-element`; the existing `add-element` and `add-relationship` shapes and the `C4AddableElementKind` list MUST NOT change.
- **FR-004**: The new block's indentation MUST follow the same sibling rules as `add-element` (including a sensible indentation when the parent has no existing children), and the closing `}` MUST be aligned with the opening line.
- **FR-005**: Insertion points MUST follow the `add-element` rules: top level after the last top-level element or boundary block, else before the first `@enduml`, else end of text; inside a boundary immediately before its closing `}`.
- **FR-006**: The boundary alias MUST be generated, validated and collision-handled exactly as for elements: caller-supplied aliases are validated and never silently renamed; a collision with the host's current text fails with `alias-collision`; an invalid alias fails with `invalid-alias`; the alias is returned in the result.
- **FR-007**: The label MUST be sanitised exactly as for elements, with a per-kind default placeholder used when it is empty. Boundaries take no technology and no description.
- **FR-008**: Errors MUST be returned as typed results (same codes and semantics as `add-element`: `parse-error`, `unknown-parent`, `boundary-cannot-take-children`, `alias-collision`, `invalid-alias`, `invalid-result`), never thrown, and the output MUST be re-parsed and rejected with `invalid-result` unless it contains exactly the intended addition.
- **FR-009**: The result MUST report what was inserted in a form that is accurate for a multi-line block (the inserted text as lines), while existing callers of `add-element` and `add-relationship` continue to get their current single-line information unchanged.
- **FR-010**: After a boundary edit, `parseC4WithSpans` MUST give the new boundary a span with a `closeLine`, so `add-element` and `add-boundary` with that boundary as `parent` succeed immediately. CRLF endings and a missing trailing newline MUST be preserved as for other edits.
- **FR-011**: An empty boundary (no children), whether created by this edit or hand-written, MUST render as a visible box and be laid out as a placeable node in both automatic layout and manual-position layout. When it later gains children it MUST resize to contain them as boundaries do today. The exact minimum size is an implementation choice, provided the box is visible and clickable.
- **FR-012**: An empty boundary MUST be a valid target for the context menu: opening the menu inside it resolves it as the parent. When boundaries are nested, the innermost boundary containing the point MUST be preferred, and a test MUST lock this in.
- **FR-013**: The context menu, in edit mode with `onEdit`, MUST list the boundary kinds in a visually separated group from the element kinds, with accessible labels and keyboard navigation across both groups.
- **FR-014**: Choosing a boundary kind MUST follow the same label flow as elements (inline input over the SVG; Enter confirms; Escape or cancel reports nothing; empty falls back to the placeholder) and report via `onEdit(edit, { positions })` only on confirmation.
- **FR-015**: `positions` for a boundary edit MUST follow ADR-92 decision 8: every currently laid-out node is pinned from the effective layout, host values win, and the new boundary's alias is keyed at the clicked point. No existing manual position moves or is re-rounded. A boundary's position is stored as `{ x, y }` keyed by alias, like any node; boundary size is never stored.
- **FR-016**: The new boundary MUST appear at the point where the menu opened, for both top-level and nested placement.
- **FR-017**: Boundaries MUST remain excluded from relationships: no connect handle on any boundary, no new relationship endpoint, as in #93.
- **FR-018**: The package MUST NOT write anywhere; gesture rules from #93 (pointer events, `pointercancel` handling, mutual exclusion with move, connect and open inputs) MUST apply to the boundary flow, and nothing changes when `isEditMode` or `onEdit` is absent.
- **FR-019**: The playground MUST let a user add a boundary and then an element inside it, and the docs recipes and any docs/README text that list boundaries as not addable MUST be updated, including a note that "exactly one line" is now "exactly one contiguous block" for boundary edits.
- **FR-020**: The multi-line exception MUST be recorded as a decision, in an ADR (`adrs/95-<slug>.md`, numbered by this issue) that amends ADR-92's "exactly one line" rule.
- **FR-021**: Tests MUST include: fixture-based byte-identical checks of pre-existing lines for each of the three kinds at top level and nested; a round trip that adds a boundary and then an element into it; empty-boundary layout and render tests (auto and manual, hand-written and created); hit-test tests for nested and empty boundaries; and component tests for the menu groups and the reported edit and positions.

### Key Entities *(if applicable)*

- **Boundary edit**: A request to add an empty boundary: its macro kind, label, optional alias, optional parent boundary id. Distinct from an element edit because it inserts a two-line block and has no technology or description.
- **Empty boundary**: A boundary whose block contains no children. It has an opening line and a separate closing `}` line, and is rendered as a default-sized, placeable, clickable box.
- **Boundary kind**: One of `System_Boundary`, `Container_Boundary`, `Boundary`, offered in the menu apart from element kinds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every fixture and each of the three boundary kinds, at top level and nested, the edited source differs from the original by exactly two inserted contiguous lines and zero changed or removed bytes elsewhere.
- **SC-002**: 100% of boundary edits that succeed re-parse with no errors and a `closeLine` on the new boundary, and a follow-on element edit into it succeeds.
- **SC-003**: A user can create a boundary and put an element inside it using only the context menu, with no source editing, in the playground.
- **SC-004**: After a boundary edit, every node that had a manual position keeps exactly the same position, and the new boundary appears at the clicked point.
- **SC-005**: An empty boundary renders with a non-zero visible box and is selected as the parent when the menu opens inside it, in both auto and manual layout.
- **SC-006**: When boundaries are nested, the menu's parent is the innermost boundary containing the point in every tested case.

## Assumptions

- **Separate edit kind (Q1).** `add-boundary` is a separate union member, because the insertion differs (a multi-line block, no technology or description, its own result information) and keeping `add-element` unchanged leaves `C4AddableElementKind` and existing callers untouched. Easily reversed at Plan if a strong reason appears.
- **First-cut macros (Q2).** `System_Boundary`, `Container_Boundary` and `Boundary`, the three named in the acceptance criteria. `Enterprise_Boundary` is parsed already but is not offered in the menu; it is not required and can be added later without breaking anything.
- **Position and size (Q3).** An empty boundary's position is an `{ x, y }` entry keyed by alias, exactly like other nodes. Size is not stored: a childless boundary takes a default minimum box, and grows when it gets children. The current layout code appears to already do this; verification is part of this issue, and any fix needed for an empty boundary is in scope.
- **Hit-testing (Q4).** Resolution already prefers the innermost boundary (#93). No behaviour change is intended; this issue adds a test locking it in for empty and nested boundaries.
- No nesting rules are enforced (for example `Container_Boundary` inside `System_Boundary` or vice versa is allowed), as in #93 and consistent with the parser.
- The placeholder label for each boundary kind is chosen at Plan, consistent with the element placeholders.
- A boundary's alias and label are written on one line with the opening `{` last, matching what the parser recognises for a boundary opening.
- The `liminis-editor` host change (merging rather than clearing positions) is separate work in that repo, as in #92.

## Out of Scope *(optional)*

- Wrapping *existing* elements in a new boundary (re-parenting).
- Deployment nodes (`Deployment_Node`, `Node` and variants).
- `Enterprise_Boundary` in the menu (the parser already accepts it).
- Relationships to and from boundaries (stay excluded as in #92).
- Renaming, deleting or moving a boundary into another boundary, or editing a boundary's properties.
- Enforcing C4 nesting rules.
- Changes to `liminis-editor`.

## Source References *(optional)*

- `adrs/92-structural-editing-edit-api.md` (decisions 1-3, 5, 7-10); `specs/92-add-elements-and-relationships-from-the-diagram/spec.md`
- `src/core/edit.ts`, `src/core/alias.ts`, `src/core/parser.ts` (`parseC4WithSpans`), `src/core/layout.ts` (boundary sizing), `src/react/EditMenu.tsx`, `src/react/hit-test.ts`, `src/react/C4InteractiveRenderer.tsx` (all on `main`; this branch predates #93)
- `ideas/structural-editing.md`, open question 2
- `docs/src/content/docs/recipes.mdx` (Recipe 4)
- #92, #93
