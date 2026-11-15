# Feature Specification: Keep a dragged node under the pointer when it passes the top or left edge

**Feature Branch**: `fabrik/issue-100`
**Created**: 2026-11-13
**Status**: Specified
**Input**: User description: "## Problem

When a node is dragged up past the top of the diagram, or left past the left edge, **the whole diagram slides the other way on screen and the node stops tracking the pointer.** It happens on desktop with a mouse and on iPad with touch. On iPad it looks like the page is scrolling, but it isn't: `window` and the scroll container both stay at scroll 0 for the whole drag (confirmed from a live event log taken on a real iPad).

## Cause

1. The canvas grows to contain the dragged node. Dragging upward makes `viewBox.y` negative, and the SVG's rendered height grows by the same amount.
2. The pane centres the SVG (`playground.css`, `.c4-playground__canvas`). Each pixel of growth moves the SVG's top edge up by half a pixel, which shifts the rest of the content down by half a pixel.
3. The drag hook locks the screen→SVG matrix at drag start (`lockedCtmInverseRef` in `useC4DiagramDrag.ts`) to avoid a runaway feedback loop. So the node follows the pointer in *SVG* coordinates, but the SVG itself is moving on screen, and the node drifts away from the finger.

Measured with a mouse in Chromium on `main` (`81b052a`), dragging `customer` up from a pointer y of 487:

| Pointer moved | `viewBox` | SVG top / height on screen | Node top on screen |
|---|---|---|---|
| 0 | `-50 0 952 555` | 321 / 484 | 434 |
| −40 | unchanged | 321 / 484 | 394 (tracks) |
| −120 | `-50 -47.6 952 602.6` | 300 / 525 | 335 (40 px behind) |
| −160 | `-50 -93.5 952 648.5` | 280 / 565 | 315 (41 px behind) |

Every other node moves down by the same amount, so the whole picture appears to scroll.

This predates structural editing. The CTM lock and canvas growth come from the original drag code. Structural editing makes it far more noticeable, because adding and connecting means a lot more dragging.

## Desired outcome

While dragging, the node stays under the pointer, and nodes that aren't being dragged don't move on screen. The canvas can still grow so the node stays reachable and scrollable.

## Acceptance criteria

- [ ] Dragging any node in any direction, including past the top and left edges, keeps its screen position equal to the pointer's (within 1 px). No other node's screen position changes during the drag.
- [ ] This holds in the playground (centred pane) and in a host that places the SVG top-left in a scrolling container.
- [ ] It holds at zoom levels other than 100%.
- [ ] The feedback loop the CTM lock prevents does not come back. Add a test for that.
- [ ] Touch and mouse behave the same. Pointer events with `pointercancel` handling are kept.
- [ ] A regression test drives a drag past the top-left edge and asserts screen positions, using real layout (a browser test) or a geometry-level unit test, whichever Specify picks.

## Open questions for Specify. Put these to the user; don't answer them silently.

1. Pick the approach:
   - (a) Freeze the canvas size and `viewBox` during a drag, with `overflow: visible`, and grow once on drop. This leaves a single jump on release.
   - (b) Keep the viewBox origin fixed while a drag grows the canvas, by compensating the container's scroll or the SVG's offset.
   - (c) Recompute the CTM every frame against an anchored origin.
   - (d) Something else.
2. Should the playground stop vertically centring the SVG, given that hosts generally anchor it top-left? Even if it does, the renderer fix is still needed.

## Pointers

- `src/react/hooks/useC4DiagramDrag.ts` (`lockedCtmInverseRef`, `screenToSvg`)
- `src/react/C4InteractiveRenderer.tsx` (canvas and `viewBox` computation, `applyDragWithChildren`, the zoom notes around `zoom?:`)
- `src/playground/playground.css` (`.c4-playground__canvas` centring, around lines 90–120)"

## Background

Dragging a node in the interactive diagram renderer is meant to feel like holding the node: it stays under the pointer. That breaks when the node is dragged past the top or left edge of the diagram. The canvas grows to contain the node, and in the playground, where the diagram is centred in its pane, the growth shifts the whole picture on screen. The node then lags the pointer, and every other node moves, so on iPad it looks like the page is scrolling, although the scroll position never changes.

Measured in Chromium on `main` (`81b052a`): after the pointer had moved 160 px up, the node sat about 41 px behind the pointer, and the SVG's on-screen top and height had both changed.

The drag code locks the screen→SVG coordinate mapping at drag start. This exists to prevent a runaway feedback loop: if the mapping were recomputed from a canvas that is itself being resized by the drag, each update would feed the next. The lock fixes that loop but leaves the node tracking in SVG space while the SVG moves on screen.

The bug predates structural editing. Structural editing (add, connect, rename) involves much more dragging, so it is now far more noticeable.

**Desired outcome:** during a drag the node stays under the pointer, and nodes that are not being dragged do not move on screen. The canvas may still grow so the node stays reachable and scrollable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Drag a node past the top or left edge without the diagram sliding (Priority: P1)

A person drags a node up or left beyond the current bounds of the diagram, with mouse or touch. The node follows the pointer exactly, and the rest of the diagram stays still. The node may be drawn outside the diagram's current bounds while the drag is in progress.

**Why this priority**: This is the reported defect. It makes dragging near the diagram's edges unreliable on every device.

**Independent Test**: In the playground, press on a node, move the pointer up and left past the diagram's edges in steps, and compare the node's screen position and every other node's screen position against the pointer and their starting positions at each step.

**Acceptance Scenarios**:

1. **Given** a diagram in the playground, **When** a node is dragged 160 px above its start so it passes the top edge, **Then** the node's screen position equals the pointer's within 1 px at every step.
2. **Given** the same drag, **When** it is in progress, **Then** every other node's screen position is unchanged (within 1 px) from drag start.
3. **Given** a drag past the left edge, **When** it is in progress, **Then** the same two guarantees hold horizontally.
4. **Given** a touch drag on iPad, **When** the node is dragged past the top or left edge, **Then** it behaves the same as with a mouse.
5. **Given** a drag that went past the top or left edge, **When** the pointer is released, **Then** the canvas is resized once to contain the node, the diagram content shifts once on screen as a result, and this happens without animation.

---

### User Story 2 - Opening the add menu does not move the diagram (Priority: P1)

A person long-presses a boundary and the add menu opens. The diagram does not move, and the pane does not change size. Holding still on an element moves nothing.

**Why this priority**: Testing on an iPad simulator (iPad Pro 11-inch, iPadOS 26.2) showed that the "diagram slides without my finger moving" symptom is, in this case, not drag drift. The menu is positioned absolutely, yet the playground's canvas pane grows by 24 px (946 → 970) when it appears. Because the playground centres the diagram vertically, the diagram moves down 12 px. The page itself does not scroll. This is the same visible symptom as the drag bug and has to be fixed with it.

**Independent Test**: In the playground, long-press a boundary so the menu opens, and compare the pane size and every node's screen position before and after.

**Acceptance Scenarios**:

1. **Given** a diagram in the playground, **When** the add menu opens from a long-press on a boundary, **Then** the canvas pane's size is unchanged and no node moves on screen.
2. **Given** the menu is open, **When** it closes, **Then** the pane size and node positions are again unchanged.

---

### User Story 3 - Same behaviour in a top-anchored host layout (Priority: P1)

An integrator embeds the diagram top-left in a scrolling container, as hosts typically do. Dragging past the top-left edge works as well there as in the playground.

**Why this priority**: The fix cannot be specific to the playground's layout, since the library is embedded by other hosts.

**Independent Test**: Render the diagram top-left in a scrolling container and repeat the drag from Story 1.

**Acceptance Scenarios**:

1. **Given** a diagram placed top-left in a scrolling container, **When** a node is dragged past the top or left edge, **Then** the node stays under the pointer and other nodes do not move on screen during the drag.
2. **Given** a container that has been scrolled before the drag, **When** a node is dragged past an edge, **Then** the same guarantees hold during the drag.

---

### User Story 4 - Correct at any zoom level (Priority: P2)

At zoom levels other than 100%, dragging past the top-left edge still keeps the node under the pointer.

**Why this priority**: Zoom changes the screen-to-diagram scale, so a fix that only works at 1:1 would be incomplete.

**Independent Test**: Repeat the Story 1 drag at, for example, 50% and 200% zoom.

**Acceptance Scenarios**:

1. **Given** zoom at 50% or 200%, **When** a node is dragged past the top or left edge, **Then** its screen position equals the pointer's within 1 px and other nodes do not move.

---

### User Story 5 - No return of the feedback loop (Priority: P1)

Whatever the fix, the drag must remain stable: the canvas must not feed back into the pointer-to-diagram mapping during a drag and cause runaway movement.

**Why this priority**: This is the failure the existing mapping lock was introduced to prevent. A fix that reintroduces it trades one bug for another.

**Independent Test**: An automated test that drags a node well past the top and left edges and checks the canvas size and `viewBox` do not change during the drag and the node's position stays a stable function of the pointer.

**Acceptance Scenarios**:

1. **Given** a drag past the top or left edge, **When** the pointer moves during the drag, **Then** the SVG size and `viewBox` stay exactly as they were at drag start.
2. **Given** a drag in progress, **When** the pointer holds still, **Then** the node's position does not keep changing.
3. **Given** a drag in progress, **When** the pointer moves back and forth across the original edge, **Then** the node's position stays consistent with the pointer and does not oscillate.
4. **Given** a completed drag, **When** the pointer is released, **Then** the size and `viewBox` are recomputed exactly once.

---

### Edge Cases

- Dragging past the top and the left edges at the same time (diagonal).
- Dragging past the bottom or right edge, which should keep working as it does now.
- Dragging a node that has children (children move with it) past the edge.
- Cancelling a drag (`pointercancel`, for example a system gesture on iPad) must leave the diagram in a sane state, with the canvas size consistent with the final node positions.
- Releasing the pointer after the node was dragged outside the original bounds: content shifts once, without animation (see FR-009).
- Dragging back toward the interior before release: the single recompute on release should then leave the layout consistent with the final node positions.
- A pre-scrolled host container.
- Zoom levels below and above 100%.
- A node dragged outside the original bounds is drawn in full during the drag (not clipped by the SVG).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While a node is dragged in any direction, including past the top and left edges, its on-screen position equals the pointer's position (offset by the original grab point) within 1 px.
- **FR-002**: While a node is dragged, the on-screen position of every node not being dragged (and not a child moving with it) stays within 1 px of its position at drag start.
- **FR-003**: FR-001 and FR-002 hold in the playground, where the diagram is anchored to the top of the pane and horizontally centred.
- **FR-004**: FR-001 and FR-002 hold when the diagram is placed top-left in a scrolling container, including when that container is already scrolled.
- **FR-005**: FR-001 and FR-002 hold at zoom levels other than 100%.
- **FR-006**: The canvas still grows so a dragged node stays reachable and scrollable, but only once, on release (see FR-009).
- **FR-007**: The runaway feedback loop that the existing screen-to-diagram mapping lock prevents does not recur.
- **FR-008**: Mouse and touch drags behave the same, and pointer-event handling, including `pointercancel`, is preserved.
- **FR-009**: For the whole duration of a drag, the diagram's SVG size and `viewBox` are frozen, and the dragged node may be drawn past the edges of the SVG (overflow visible while dragging). The size and `viewBox` are recomputed once on release. The resulting one-time shift of content when the diagram grows at the top or left is accepted, with no animation.
- **FR-010**: The playground pins the diagram to the top of its canvas pane and no longer centres it vertically. Horizontal centring is kept. Centring must still not use a method that makes overflowing content unscrollable (the existing reason for not using `justify-content`/`align-items: center` on the pane stays).
- **FR-011**: Automated geometry-level unit tests cover: no size or `viewBox` change during a drag; exactly one recompute on release; and the dragged node staying under the pointer when dragged past the top or left edge. A manual playground check complements them: long-press a boundary and confirm the diagram does not move, then drag a node above the top edge and confirm it tracks the pointer.
- **FR-012**: An automated test covers the feedback-loop guarantee in FR-007.
- **FR-013**: Opening or closing the add menu (long-press on a boundary) does not change the playground canvas pane's size and does not move any node on screen.

### Key Entities *(if applicable)*

- **Canvas**: the drawing area whose size is recomputed to contain the nodes. It is frozen during a drag and recomputed on release.
- **Diagram coordinate origin**: the point that defines where diagram coordinates start. It moves when the canvas is recomputed after content extends past the top or left.
- **Pointer-to-diagram mapping**: the transform that converts a screen position into a diagram position, locked at drag start and valid for the whole drag because the canvas does not change.
- **Playground canvas pane**: the playground's container for the diagram. It anchors the diagram to the top and centres it horizontally.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a drag that carries a node at least 160 px past the top edge or the left edge, the node's on-screen offset from the pointer stays within 1 px at every sampled step. Before the fix this offset reached about 41 px.
- **SC-002**: The maximum on-screen displacement of any non-dragged node during a drag is at most 1 px.
- **SC-003**: SC-001 and SC-002 hold in the playground's top-anchored pane, in a top-left scrolling host, and at zoom levels of at least 50% and 200%.
- **SC-004**: With the pointer held still, the node's position is unchanged across consecutive updates, and the SVG size and `viewBox` are identical at every step of the drag.
- **SC-005**: The automated regression and feedback-loop tests fail on `main` at `81b052a` and pass after the change.
- **SC-006**: Opening the add menu changes the playground canvas pane's size by 0 px and moves every node by at most 1 px. Before the fix the pane grew by 24 px (946 → 970) and the diagram moved 12 px.

## Assumptions

- The bug is reproduced with a mouse in Chromium, and iPad touch behaves the same, so one fix serves both input types.
- The 1 px tolerance in the acceptance criteria is measured in screen (CSS) pixels.
- Behaviour at the bottom and right edges is already correct (growth there does not shift content) and must only not regress.
- A single, non-animated shift of content on release is acceptable when the diagram grows at the top or left (decided by the issue owner).
- Hosts that need the viewport to stay put after release can handle that themselves in a later change (see Out of Scope).
- Following the project convention, any ADR written for this work is numbered `100`.

## Out of Scope *(optional)*

- Scroll compensation for hosts, meaning the renderer reporting how far its frame shifted so a host can scroll to match. Deferred until liminis-editor#194 adopts the new version.
- Touch-drag cancellation (`pointercancel` on the first move). This is being checked on real hardware and will be filed separately if it is real.
- Changes to drag behaviour unrelated to canvas growth (snapping, collision, multi-select).
- Redesigning zoom or pan.
- New diagram editing features.
- Animating the shift on release.

## Source References *(optional)*

- Issue #100 original report, including the Chromium measurement table on `main` (`81b052a`)
- Issue owner's iPad simulator finding (iPad Pro 11-inch, iPadOS 26.2, playground debug overlay): the long-press add menu grows the canvas pane from 946 to 970 px, shifting the vertically centred diagram down 12 px with no page scroll
- Related: #92 and #94 (structural editing) made the bug more visible
