# Feature Specification: C4InteractiveRenderer: let the host absorb drag-time origin shifts (opt out of the hold transform) so all edges behave alike

**Feature Branch**: `fabrik/issue-110`
**Created**: 2026-11-16
**Status**: Specified
**Input**: User description: "## Problem

While a node is dragged past an edge, `C4InteractiveRenderer` grows the frame live (ADR-100). Growth toward the **bottom or right** doesn't move the diagram's origin, so nothing moves. Growth toward the **top or left** moves the origin, so the renderer translates the `<svg>` with a CSS `transform` to hold the origin still on screen. A transform paints outside the element's box. Any host whose container clips (any `overflow` other than `visible`) then **cuts off the grown strip, including the node being dragged**, until release. A host that doesn't clip gets the drawing spilling over neighbouring UI instead.

So the four edges behave differently. Down and right: the box grows and nothing clips. Up and left: the drawing leaves its box and is clipped. A host can't fix this. The hold transform is unconditional during a drag, and `onFrameChange` only reports the frame's size, not the origin shift.

Observed in `@liminis/editor` (liminisapp/liminis-editor#206). Recorded per frame in Chrome:
- dragging Author 180px above the top: the node is fully hidden under `transform: translate(0, -180px)`
- dragging past the left: the drawing extends about 300px beyond the container's left edge

## Desired outcome

A host can opt out of the origin-holding transform and absorb the origin shift itself, every frame, so that all four edges behave the same way.

Sketch only. Plan owns the shape:

```ts
// C4InteractiveRenderer props
/** Default true (today's behaviour). When false the renderer never sets a CSS transform during a drag. */
holdOrigin?: boolean;
/**
 * Called from a layout effect whenever the frame's origin moves on screen during a drag (top/left growth or shrink),
 * with the shift in CSS px at the current rendered scale, before paint, so the host can compensate in the same frame.
 */
onOriginShift?: (shift: { dx: number; dy: number }) => void;
```

- With `holdOrigin={false}`, the svg's layout box is always the whole drawing. Nothing is painted outside it, at any edge.
- `onOriginShift` fires in the same commit as the frame change, before paint, so a host that scrolls by `dy` produces no visible jump. Report `dx` and `dy` in rendered px, accounting for the scale when a host's CSS shrinks the svg to fit.
- The dragged node keeps tracking the pointer correctly when the host scrolls in response. The pointer mapping must use the post-scroll geometry.
- Release behaviour stays consistent with the drag: no extra one-time shift on release when the host has been absorbing shifts live.
- With the default (`holdOrigin` omitted), nothing changes. Additive, so a patch release under the 0.x policy.

## Acceptance criteria

- [ ] `holdOrigin={false}`: no `transform` is set on the svg at any point during a drag, at any edge.
- [ ] `onOriginShift` fires with the correct `dx`/`dy` on top and left growth and shrink, and never for bottom/right-only changes. A test checks the values at a non-1 rendered scale (svg shrunk to fit by CSS).
- [ ] A host that scrolls its container by `dy` inside the callback sees no visible jump, and the dragged node stays under the pointer. A test drives this with a scrolling container.
- [ ] Default behaviour unchanged, and the existing ADR-100 tests pass.
- [ ] ADR-100 gets a dated amendment (the opt-out and why). The docs recipe shows a host absorbing the shift by scrolling.

## Pointers

- ADR-100 (`adrs/100-freeze-svg-frame-during-drag.md`): the hold transform, the release shift, and the 48px growth cap
- `src/react/C4InteractiveRenderer.tsx`: where the drag-hold `style.transform` is written and cleared, and `onFrameChange`
- Consumer: liminisapp/liminis-editor `src/app/editor/nodes/C4Component.tsx` (#206)"

## Background

ADR-100 (amended by #104) lets the drawing grow live while a node is dragged past its edge, and keeps the diagram's origin still on screen so the node does not drift from the pointer. Growth at the bottom or right needs nothing: the box grows and the origin stays put. Growth at the top or left moves the origin inside the box, so the renderer compensates with a CSS `transform` on the `<svg>`. A transform paints outside the element's layout box, so a host whose container clips (any `overflow` other than `visible`) cuts off the grown strip, including the node being dragged, until release. A host that doesn't clip gets the drawing spilling over neighbouring UI.

The result is that the four edges behave differently. A host cannot repair this because the hold transform is unconditional during a drag and `onFrameChange` reports only the frame's size, not how far the origin moved.

This was observed in `@liminis/editor` (liminisapp/liminis-editor#206). Per-frame recordings in Chrome showed the dragged node fully hidden under a 180px top translate, and the drawing extending about 300px beyond the container's left edge when dragged past the left.

The wanted capability is for a host to opt out of the renderer's compensation and do the compensating itself, with the renderer telling it, every frame, how far the origin moved. A host with a scrolling container can then scroll by that amount and get identical behaviour at all four edges.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Opt out of the hold transform (Priority: P1)

A host embedding the interactive renderer in a clipping container turns off the origin-holding transform. During a drag past any edge, the svg's layout box is the whole drawing and nothing is painted outside it, so the container's scroll extent grows and nothing is clipped or spilled.

**Why this priority**: This removes the clipping and spilling that motivated the issue.

**Independent Test**: Render with the opt-out enabled inside a container with `overflow: auto`. Drag a node past each of the four edges. Assert that the svg never has a `transform` and that its layout box covers the whole drawing.

**Acceptance Scenarios**:

1. **Given** the opt-out is enabled, **When** a node is dragged past the top or left edge, **Then** no CSS `transform` is ever set on the svg during the drag, and the svg's box grows to contain the whole drawing.
2. **Given** the opt-out is enabled, **When** a node is dragged past the bottom or right edge, **Then** behaviour is as it is today: the box grows, no transform is set.
3. **Given** the opt-out is not set, **When** any drag occurs, **Then** behaviour is exactly as it is today, including the hold transform and the existing ADR-100 tests.

---

### User Story 2 - Be told how far the origin moved (Priority: P1)

A host that has opted out is told, before paint and in the same commit as the frame change, how far the diagram origin moved on screen, in rendered pixels. Compensating by exactly that amount keeps the origin still, with no visible jump.

**Why this priority**: Without the shift value the opt-out is unusable, because the host would have to guess how far to compensate.

**Independent Test**: Render at a non-1 rendered scale (svg shrunk to fit by CSS). Drive top and left growth, then shrink, and bottom/right-only changes. Assert the reported values and the cases where the callback does not fire.

**Acceptance Scenarios**:

1. **Given** a drag that grows the frame toward the top and/or left, **When** the frame changes, **Then** the shift callback fires once for that commit with `dx`/`dy` equal to the origin's on-screen displacement, in CSS px at the current rendered scale.
2. **Given** a drag that shrinks the frame at the top/left (the node moves back inward), **When** the frame changes, **Then** the callback fires with the opposite-sign displacement.
3. **Given** a change that grows or shrinks the frame only at the bottom/right, **When** the frame changes, **Then** the callback does not fire.
4. **Given** the svg is rendered at a scale other than 1 by host CSS, **When** the callback fires, **Then** `dx`/`dy` are in rendered pixels (user-space shift multiplied by the rendered scale), not user-space units.

---

### User Story 3 - Host scrolls in response and the node stays under the pointer (Priority: P1)

A host with a scrolling container adjusts its scroll position by the reported shift inside the callback. The drawing does not visibly jump and the dragged node stays under the pointer for the whole drag.

**Why this priority**: This is the end-to-end behaviour the consumer (liminis-editor#206) needs.

**Independent Test**: Render inside a scrolling container whose handler adds `dx`/`dy` to the scroll offsets. Drag past the top and left. Assert that the origin's screen position is unchanged across frames and that the node's screen position tracks the pointer.

**Acceptance Scenarios**:

1. **Given** a host that scrolls by `dy` in the callback, **When** a node is dragged above the top edge, **Then** the origin's on-screen position is the same before and after each frame.
2. **Given** the same host, **When** the scroll offset changes mid-drag, **Then** pointer-to-diagram mapping uses the post-scroll geometry and the node stays under the pointer.
3. **Given** the same host, **When** the drag is released, **Then** no additional one-time shift or jump occurs.

---

### User Story 4 - A documented recipe (Priority: P2)

A host author reads the docs and finds a short recipe showing how to absorb the shift by scrolling, and ADR-100 records the opt-out and why it exists.

**Why this priority**: The feature is only useful if hosts can discover and apply it, but it does not change behaviour.

**Independent Test**: The docs contain a scrolling-container example using the two new props, and ADR-100 carries a dated amendment.

**Acceptance Scenarios**:

1. **Given** the docs, **When** a host author looks for how to avoid clipping during top/left drags, **Then** they find the recipe.
2. **Given** ADR-100, **When** it is read, **Then** it has a dated amendment explaining the opt-out and its rationale.

---

### Edge Cases

- Cancel (pointercancel, or Escape when editing) returns the frame to its pre-drag size. The origin moves back, so the callback must report that reverse shift, letting the host restore its scroll.
- Release with the opt-out enabled produces no extra shift, because there is no hold transform to drop.
- The shift is reported per commit as the displacement since the previous commit, not cumulatively since drag start.
- The 48px growth cap and zoom-to-fit remapping from ADR-100 keep working. When the scale changes mid-drag, the reported shift uses the scale of the commit in which it is reported.
- If the host does not scroll, or cannot (nothing to scroll), the drawing shifts on screen. That is the host's choice, and the renderer neither prevents nor works around it.
- The shift callback is not called outside a drag.
- A shift of exactly zero is not reported.
- Setting the opt-out without providing the shift callback is allowed. The renderer then holds nothing and reports nothing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `C4InteractiveRenderer` accepts an optional opt-out for the drag-time origin-holding transform. When omitted, behaviour is unchanged from today.
- **FR-002**: With the opt-out enabled, the renderer never sets a CSS `transform` on the svg at any point during a drag, at any edge, including the first frame and after release or cancel.
- **FR-003**: With the opt-out enabled, the svg's layout box is always the whole drawing during a drag, and nothing is painted outside it at any edge.
- **FR-004**: `C4InteractiveRenderer` accepts an optional callback that is invoked with `{ dx, dy }`, the displacement of the diagram origin on screen in CSS px at the current rendered scale, whenever the origin moves during a drag because of top/left growth or shrink. Positive values mean the origin moved right/down, so a host that scrolls by the same amounts keeps the origin still.
- **FR-005**: The callback is invoked from a layout effect in the same commit as the frame change, before paint.
- **FR-006**: The callback is not invoked for changes that only affect the bottom or right of the frame, and is not invoked when the displacement is zero or outside a drag.
- **FR-007**: `dx` and `dy` account for the rendered scale: when host CSS shrinks or scales the svg, the values are in rendered pixels, not SVG user-space units.
- **FR-008**: Shrink at the top/left (including a cancel returning to the pre-drag frame) is reported with the opposite-sign displacement, so a host can undo its compensation.
- **FR-009**: Pointer-to-diagram mapping during a drag uses the post-scroll geometry when the host scrolls inside the callback, so the dragged node stays under the pointer.
- **FR-010**: With the opt-out enabled, release causes no extra one-time shift of the diagram relative to the last drag frame.
- **FR-011**: With the opt-out omitted, all existing behaviour is unchanged: the hold transform, the release shift, the growth cap, and `onFrameChange`. Existing ADR-100 tests pass unmodified.
- **FR-012**: `onFrameChange` keeps its current contract (frame size only).
- **FR-013**: ADR-100 gets a dated amendment recording the opt-out and why it exists. Its number and filename do not change.
- **FR-014**: The docs include a recipe in which a host with a scrolling container absorbs the origin shift by scrolling by `dx`/`dy`.
- **FR-015**: The new props are additive to the public API, with no breaking change, so the release is a patch under the 0.x policy.

### Key Entities *(if applicable)*

- **Origin shift**: The on-screen displacement, in rendered CSS px, of the diagram origin (user-space point 0,0) between two consecutive commits during a drag.
- **Host**: The embedding application. It owns the container and its scroll behaviour, and decides whether to use the renderer's origin hold or absorb shifts itself.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the opt-out enabled, a drag past any of the four edges in a clipping container never hides the dragged node and never paints outside the container.
- **SC-002**: In a test at a non-1 rendered scale, the reported `dx`/`dy` match the independently measured on-screen movement of the origin to within sub-pixel tolerance on every top/left growth and shrink commit.
- **SC-003**: In a test with a scrolling host that scrolls by the reported shift, the origin's screen position is unchanged across every drag frame, and the dragged node's screen position stays within sub-pixel tolerance of the pointer.
- **SC-004**: With the opt-out omitted, the full existing test suite passes with no modifications.
- **SC-005**: ADR-100 carries a dated amendment, and the docs contain a scrolling-host recipe.

## Assumptions

- The sketch's prop names (`holdOrigin`, `onOriginShift`) are non-binding. The Plan stage owns the final API shape, as the issue states.
- The shift is the per-commit displacement (since the previous commit), not a cumulative total. A host that adds it to its scroll offset on each call tracks the origin exactly.
- The 48px growth cap and ADR-100's zoom-to-fit remapping remain as they are, and apply equally with the opt-out enabled.
- The connect drag does not change the frame, so it never reports a shift.
- Hosts that opt out are responsible for compensating. The renderer does not detect or scroll containers itself.

## Out of Scope *(optional)*

- Changing the default behaviour or removing the hold transform.
- Renderer-side detection or automatic scrolling of the host's container.
- Changes to the 48px growth cap or the zoom-to-fit scale logic.
- Changes to `onFrameChange`'s payload.
- The editor-side change in liminis-editor#206, which is the consumer of this feature and tracked there.

## Source References *(optional)*

- ADR-100: `adrs/100-freeze-svg-frame-during-drag.md`
- liminisapp/liminis-editor#206 (the observed consumer problem)
- liminisapp/liminis-diagrams#100, #104 (origin hold and live growth)
