# Feature Specification: Let the canvas grow live while dragging past its bounds, without drift (amends ADR-100)

**Feature Branch**: `fabrik/issue-104`
**Created**: 2026-11-14
**Status**: Specified
**Input**: User description: "## Problem

#100 (ADR-100) fixed drag drift by **freezing the SVG frame** (size and viewBox) for the whole drag, then recomputing it once on release. That works, but the drawing area no longer grows while you drag something past its bounds. The pane's scroll extent and the editor's block height only catch up when you let go. We want the canvas to resize **live** during the drag again, without bringing back the drift that #100 fixed.

What the freeze actually needs to guarantee is narrower than freezing the frame: **the diagram must not move on screen under the pointer during a drag.** Freezing was the simplest way to get that.

## Desired outcome

While dragging a node past any edge, the frame grows on every move, and:

- the dragged node stays exactly under the pointer;
- no other node appears to slide;
- this holds at a fixed zoom (100%) and in zoom-to-fit (the ⤡ button), where the scale is allowed to change live.

## Design (decided; do not re-open)

1. **Fixed scale: hold the origin still.**
   - Let the frame update live, as it did before #100.
   - After each update, measure where the diagram origin sits on screen, using `getScreenCTM()` or the bounding rect, against where it was at drag start.
   - Cancel the difference with a CSS `transform: translate(...)` on the SVG for the rest of the drag.
   - A transform doesn't affect layout, so the page or pane still grows, but the content stays put on screen. The pointer mapping locked at drag start stays valid.
   - **Measure, don't assume.** This must also cover right or bottom growth under horizontal centring. The playground uses `margin: auto`, and the editor uses `justify-content: center`; both shift content left by half the growth.
2. **Changing scale (fit mode): remap on every move.**
   - When the rendered scale changes during the drag, map the pointer through the **current** screen CTM on each move, instead of the matrix locked at drag start.
   - The dragged node stays under the pointer. Other nodes shrink and shift visibly; that is expected.
3. **Feedback cap.** Dragging outward grows the frame, which shrinks the scale, which maps the same pointer position further out, and so on. That loop settles while the pointer is inside the container, but runs away as the pointer nears the container's edge. Cap it, for example by not growing the frame once the pointer is within a small margin of the container edge, or by limiting growth per frame. Specify should choose one, and a unit test must prove that it settles.
4. **On release**, drop the transform and render the final frame. A one-time shift when growth was at the top or left is still accepted here. Host scroll compensation stays deferred to liminis-editor#194.
5. **Amend ADR-100** rather than writing a new ADR: the invariant becomes \"the origin is held still on screen; the frame may grow\". Per the repo rule, the ADR number is the issue number, so if Specify concludes a new ADR is needed instead, it is `adrs/<this issue>-...`.

## Acceptance criteria

- [ ] At 100% zoom, dragging a node 160 px past the top, left, right and bottom edges keeps the node under the pointer (within 1 px) on every move. Every other node's screen position is unchanged during the drag. The frame (SVG size and viewBox) grows during the drag, not only on release.
- [ ] In fit mode, the dragged node stays under the pointer (within 1 px) on every move while the scale changes.
- [ ] Near the container edge in fit mode, growth stays bounded, with no runaway. There's a test for this.
- [ ] Release behaviour, and everything #100 fixed, is unchanged: a long-press on a boundary doesn't move the diagram; the playground stays top-pinned.
- [ ] `pointercancel` and Escape during the drag restore the pre-drag frame and remove the transform.
- [ ] The geometry tests from #100 (`src/react/test-utils/svgGeometry.ts`, `C4InteractiveRenderer.drag-frame.test.tsx`) are updated or extended. Add a manual check in the playground at both zoom modes.

## Out of scope

Host scroll compensation (liminis-editor#194), any change to touch-drag cancellation (being checked on real hardware separately), and changes to boundary auto-grow (it already updates live).

## Pointers

- `src/react/C4InteractiveRenderer.tsx`: the frame-freeze block (`frameRef`, `liveFrame`, around the \"Freeze the frame for the whole of a drag (ADR-100)\" comment), plus `liveScale`.
- `src/react/hooks/useC4DiagramDrag.ts`: `lockedCtmInverseRef`.
- `adrs/100-freeze-svg-frame-during-drag.md`, and #100's spec under `specs/100-*`.
- `src/playground/playground.css`: the canvas pane layout.

Put any open questions to the user; don't answer them silently."

## Background

ADR-100 (#100) fixed a bug where dragging a node past the top or left edge made the whole diagram slide and the node drift away from the pointer (about 41 px after a 160 px drag). The cause was that the SVG's frame (size and viewBox) grew during the drag while the host centred the SVG, so the content moved on screen under the pointer. The fix froze the frame for the entire drag and recomputed it once on release.

The side effect is that the drawing area no longer grows live while an element is dragged past its bounds. The pane's scroll extent and the editor's block height only catch up on release.

The freeze was broader than the actual requirement. What must hold is narrower: **the diagram must not move on screen under the pointer during a drag.** This issue restores live growth of the frame during a drag while keeping that guarantee, at a fixed zoom and in zoom-to-fit mode, where the scale can change live.

The issue author has already decided the approach, which this spec treats as a constraint (see Assumptions): at a fixed scale, the diagram origin is held still on screen by measuring its drift and cancelling it; when the rendered scale changes, the pointer is mapped through the current screen matrix on every move; and a feedback cap keeps the fit-mode grow/shrink loop bounded. ADR-100 is amended rather than replaced: its invariant becomes "the origin is held still on screen; the frame may grow".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live growth at fixed zoom without drift (Priority: P1)

A user at 100% zoom drags a node past any edge of the diagram. The drawing area (SVG frame, and with it the pane's scroll extent or the editor block's height) grows as they drag, and the node stays exactly under the pointer while every other node stays put on screen.

**Why this priority**: This is the core regression-free restoration of live growth. It is the common case, and the one where #100's drift bug lived.

**Independent Test**: At 100% zoom in the playground (and in the geometry test harness), drag a node 160 px past each of the top, left, right and bottom edges. Check on every move that the node is within 1 px of the pointer, that the other nodes' screen positions are unchanged, and that the SVG size and viewBox have grown before release.

**Acceptance Scenarios**:

1. **Given** a diagram at 100% zoom, **When** a node is dragged 160 px past the top edge, **Then** on every pointer move the node is within 1 px of the pointer, no other node's screen position changes, and the frame has grown by the time the drag ends, not only after release.
2. **Given** the same setup, **When** a node is dragged 160 px past the left edge, **Then** the same holds.
3. **Given** a host that centres the SVG horizontally (the playground's `margin: 0 auto`, the editor's `justify-content: center`), **When** a node is dragged 160 px past the right or bottom edge, **Then** the content does not shift left by half the growth, and the same holds.
4. **Given** a drag past an edge that has grown the frame, **When** the pointer is released, **Then** the final frame is rendered, the compensation is dropped, and a one-time shift is accepted when growth was at the top or left.

---

### User Story 2 - Live growth in zoom-to-fit mode (Priority: P1)

A user has zoom-to-fit active (the ⤡ button) and drags a node past an edge. The frame grows live, so the fit scale shrinks. The dragged node stays under the pointer throughout. Other nodes visibly shrink and shift, which is expected.

**Why this priority**: The issue requires the guarantee in both zoom modes, and in fit mode the origin-hold approach alone cannot work because the scale changes.

**Independent Test**: In fit mode, drag a node outward past the edge in the geometry test harness and in the playground. Check on every move that the node is within 1 px of the pointer while the scale changes.

**Acceptance Scenarios**:

1. **Given** fit mode and a diagram, **When** a node is dragged past an edge so the fit scale changes on successive moves, **Then** on every move the node stays within 1 px of the pointer.
2. **Given** fit mode, **When** the pointer approaches the container's edge during an outward drag, **Then** frame growth stays bounded and the scale and node position settle instead of running away.

---

### User Story 3 - Cancel and release restore a clean state (Priority: P2)

A user abandons a drag with Escape or a `pointercancel`, or completes it by releasing. In every case the temporary on-screen compensation is removed, and an abandoned drag leaves the pre-drag frame as it was.

**Why this priority**: Without this, the new compensation could leak into the idle state. This is a correctness guard on Stories 1 and 2, and not a new capability.

**Independent Test**: Start a drag that grows the frame, then press Escape (or dispatch `pointercancel`). Check that the frame equals the pre-drag frame and no compensating transform remains on the SVG. Repeat with release and check that the transform is removed and the final frame is rendered.

**Acceptance Scenarios**:

1. **Given** a drag that has grown the frame, **When** Escape is pressed, **Then** the pre-drag frame is restored and the SVG has no compensating transform.
2. **Given** the same, **When** a `pointercancel` is dispatched, **Then** the same holds.
3. **Given** the same, **When** the pointer is released, **Then** the compensating transform is removed and the final frame is rendered.

---

### User Story 4 - Nothing fixed by #100 regresses (Priority: P2)

Everything #100 fixed stays fixed: a long-press on a boundary does not move the diagram, the playground stays top-pinned, and release behaviour is unchanged.

**Why this priority**: This is a regression guard. The existing geometry tests encode these guarantees.

**Independent Test**: Run the existing #100 geometry tests, updated for live growth, plus a long-press on a boundary and a visual check that the playground stays top-pinned.

**Acceptance Scenarios**:

1. **Given** a boundary, **When** it is long-pressed without moving, **Then** the diagram does not move.
2. **Given** the playground, **When** a drag grows the frame, **Then** the diagram stays pinned to the top of the pane.

---

### Edge Cases

- **Right or bottom growth under horizontal centring.** Centring shifts content left by half the growth. The compensation must be measured from the actual on-screen position, not computed assuming a top-left-pinned host.
- **Top or left growth.** The origin moves because the viewBox origin goes negative. The compensation keeps the origin where it was at drag start.
- **Pointer near the container edge in fit mode.** The grow/shrink feedback loop can run away; the cap must bound it.
- **Pointer moves back inward after growth was capped.** Growth must resume or stay consistent. The dragged node must still stay under the pointer while growth is paused.
- **Scale changes mid-drag.** The scale may change in fit mode, or because of a resize such as a scrollbar appearing, so the pointer mapping must use the current matrix rather than the drag-start matrix whenever the scale differs.
- **Drag ends by release, re-parent drop, tap-select, `pointercancel` or Escape.** Compensation is removed in every case.
- **A node dragged beyond the pane's own top or left edge** may be clipped by the scroll container. This is existing ADR-100 behaviour and stays unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While a node is dragged, the SVG frame (size and viewBox) MUST update live as the layout grows, rather than staying frozen at the pre-drag frame until release.
- **FR-002**: At a fixed zoom, the on-screen position of the diagram origin MUST stay at its drag-start position for the whole drag, so the dragged node stays within 1 px of the pointer on every move and every other node's screen position is unchanged.
- **FR-003**: The on-screen position of the origin MUST be measured after each frame update, not computed from assumptions about the host layout. This MUST hold for growth at the top, left, right and bottom, including hosts that centre the SVG horizontally.
- **FR-004**: The compensation for origin drift MUST NOT change layout, so the host pane's scroll extent or the editor block's height still reflects the grown frame during the drag.
- **FR-005**: When the rendered scale changes during a drag (zoom-to-fit), the pointer MUST be mapped to diagram space through the current screen matrix on every move, so the dragged node stays within 1 px of the pointer on every move.
- **FR-006**: Frame growth in fit mode MUST be capped so the grow/shrink feedback loop settles. The cap is to stop growing the frame while the pointer is within a small margin of the container edge. The tests MUST prove that it settles. While growth is paused the dragged node MUST still follow the pointer, and growth resumes once the pointer is back outside the margin.
- **FR-007**: On release, the compensation MUST be removed and the final frame rendered. A one-time shift at release is accepted when growth was at the top or left, and release behaviour is otherwise unchanged from #100.
- **FR-008**: On `pointercancel` or Escape during a drag, the pre-drag frame MUST be restored and the compensation removed.
- **FR-009**: Everything #100 fixed MUST remain: a long-press on a boundary does not move the diagram, and the playground stays top-pinned.
- **FR-010**: ADR-100 MUST be amended, keeping its number, so that its invariant reads "the origin is held still on screen; the frame may grow", and its rejected alternatives and consequences are revised to match. A new ADR is only to be written if the amendment proves insufficient, and it would then be named `adrs/104-<slug>.md`.
- **FR-011**: The geometry tests from #100 (`src/react/test-utils/svgGeometry.ts` and `C4InteractiveRenderer.drag-frame.test.tsx`) MUST be updated or extended to cover live growth in all four directions at 100% zoom, fit-mode remapping, the cap's settling, and cancel/Escape restoring the frame. A manual check at both zoom modes MUST be added to the playground's documented manual checks.

### Key Entities *(if applicable)*

- **Frame**: The SVG's viewBox origin, rendered size and zoom scale. It is live during a drag and is recomputed finally on release.
- **Drag-start origin position**: The on-screen position of the diagram origin when the drag began. It is the reference the compensation holds the origin to.
- **Compensation**: The temporary on-screen offset that cancels origin drift during a drag. It does not affect layout, and it is removed when the drag ends.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 100% zoom, dragging a node 160 px past each of the top, left, right and bottom edges keeps the node within 1 px of the pointer on every move, with zero change in any other node's screen position, and the frame has grown before release.
- **SC-002**: In fit mode, the dragged node is within 1 px of the pointer on every move while the scale changes.
- **SC-003**: With the pointer near the container edge in fit mode, frame growth is bounded and the scale settles within a bounded number of moves. An automated test shows it.
- **SC-004**: After Escape or `pointercancel`, the frame equals the pre-drag frame and no compensation remains. After release, no compensation remains.
- **SC-005**: Every #100 geometry test still passes, or is updated with an equivalent assertion that live growth does not move the diagram. A long-press on a boundary still moves nothing, and the playground stays top-pinned.

## Assumptions

- **Approach is decided.** The issue author fixed the approach: hold the origin still at a fixed scale by measurement and on-screen compensation, remap the pointer through the current matrix when the scale changes, and cap the feedback loop. This spec does not reopen it, and the Plan stage chooses the mechanics.
- **Cap choice (the issue left this to Specify).** The cap is to **stop growing the frame while the pointer is within a small margin of the container edge**, rather than limiting growth per frame. A per-frame limit only slows the runaway, while a pointer-margin rule bounds it directly and can be tested for settling. The margin's size is a tuning value for Plan to choose, and it must be small compared with the container.
- **While capped, the scale stays constant**, so the locked-style mapping stays consistent and the node stays under the pointer. Growth resumes when the pointer moves back out of the margin.
- **Release shift.** When the compensation is dropped on release, a one-time shift can occur, because the final frame is rendered without it. This covers top/left growth and, in centring hosts, the half-growth centring shift. This matches release behaviour under #100 and is accepted. Host scroll compensation stays deferred to liminis-editor#194.
- **#100 is the baseline.** This work builds on #100 (ADR-100, its spec and its geometry tests) as merged on `main`, so the working branch needs to be on top of that commit.
- **Both hosts are covered by measurement.** The playground (`margin: 0 auto`) and the editor (`justify-content: center`) are covered through the same measure-and-compensate mechanism, with no host-specific code.
- **The pointer-mapping lock stays valid at a fixed scale**, and `useC4ConnectDrag` is unaffected unless the Plan stage finds otherwise.

## Out of Scope *(optional)*

- Host scroll compensation after release (liminis-editor#194).
- Any change to touch-drag cancellation (being checked on real hardware separately).
- Changes to boundary auto-grow, which already updates live.
- Animating the release shift.
- A scroll of the host container mid-drag (an existing ADR-100 limitation).

## Source References *(optional)*

- ADR-100: `adrs/100-freeze-svg-frame-during-drag.md`, and #100's spec under `specs/100-*`.
- `src/react/C4InteractiveRenderer.tsx`: the frame-freeze block and `liveScale`.
- `src/react/hooks/useC4DiagramDrag.ts`: `lockedCtmInverseRef`.
- `src/react/test-utils/svgGeometry.ts` and `src/react/C4InteractiveRenderer.drag-frame.test.tsx`: the #100 geometry tests.
- `src/playground/playground.css`: the canvas pane layout.
- liminis-editor#194: host scroll compensation (deferred).
