# ADR-100: Hold the diagram origin still on screen while a node is dragged; the frame may grow

**Status**: Accepted (amended by #104 — the original decision froze the frame; amended by #110 — a host may opt out of the hold; the file keeps its name and number)
**Issue**: #100 — Dragging a node past the top/left edge makes the whole diagram slide and the node drift from the pointer. Amended by #104 — Let the canvas grow live while dragging past its bounds, without drift. Amended by #110 — Let the host absorb drag-time origin shifts (opt out of the hold transform) so all edges behave alike.
**Relates to**: ADR-99 §7 (drop targets are hit-tested against a drag-start snapshot because the live layout grows during a drag), §8 (a nested drop is clamped so its parent does not shift its own origin), §9 (additive `useC4DiagramDrag` API).

## Context

`useC4DiagramDrag` locks the screen→SVG matrix at drag start, to avoid a runaway feedback
loop: recomputing the mapping from a canvas that the drag is itself resizing makes each
update feed the next.

The lock fixes the loop but not the frame. The layout is recomputed on every drag update, so a
drag past the top or left edge made `viewBoxX/Y` negative and grew the SVG's rendered size by
the same amount. The playground centred the SVG in its pane, so each pixel of growth moved the
SVG's top edge up by half a pixel and the content down by half a pixel. The node followed the
pointer in SVG space while the SVG moved on screen, so it drifted (about 41 px after a 160 px
drag in Chromium) and every other node appeared to slide. On iPad this looked like page
scrolling although nothing scrolled.

#100 fixed this by freezing the frame for the whole drag. That was the simplest way to
guarantee something narrower: **the diagram must not move on screen under the pointer during a
drag.** Its side effect was that the drawing area no longer grew while an element was dragged
past its bounds: the pane's scroll extent and the editor block's height only caught up on
release. #104 restores live growth while keeping the guarantee.

## Decision

The invariant is: **the diagram origin (SVG user-space point 0,0) is held still on screen; the
frame may grow.**

1. **`C4InteractiveSvg` renders the live frame during a drag** (`viewBox`, `svgWidth/svgHeight`
   and the zoom scale), as it did before #100, so the host's scroll extent or block height
   follows the drag.
2. **At a fixed scale, the origin is held still by measurement.** A layout effect runs after
   every render during a drag. It clears `svg.style.transform`, reads `getScreenCTM()` (whose
   `e, f` is the screen position of the origin), records that as the drag-start origin on the
   first drag render, and thereafter sets `transform: translate(Δx px, Δy px)` with
   `Δ = start − current`. A transform does not affect layout, so the pane still grows, and the
   locked pointer mapping stays valid. Measuring with the transform removed keeps the result
   independent of whether an engine's `getScreenCTM()` includes a CSS transform, and measuring
   the real position covers right and bottom growth under horizontal centring
   (`margin: 0 auto`, `justify-content: center`) with no host-specific code. The effect runs in
   the layout phase, so nothing is painted in between.
3. **When the rendered scale changes (zoom-to-fit), the pointer is mapped through the live
   matrix.** `useC4DiagramDrag` records the locked matrix's scale; when the live scale differs
   by more than a relative 1e-4 it uses the live inverse instead. The grab offset is kept in SVG
   units, so the node stays under the pointer. Because the node renders one commit after the
   scale changes, the hook's `remapDrag()` re-maps the last pointer position after each
   scale-changing commit (a layout effect keyed on the scale), at most `MAX_REMAP_PASSES` (24)
   times between two real pointer moves. Other nodes shrink and shift visibly; that is expected.
4. **A feedback cap bounds the loop.** Dragging outward grows the frame, which shrinks the
   scale, which maps the same pointer position further out. With the origin held, pointer
   distance `u` from it and available extent `A`, the fixed point is `(A − u)/c` for a node of
   extent `c`, it exists only while `u < A`, and the iteration contracts at rate `u/A`: it
   settles with the pointer inside the container and runs away as it nears the edge. So, once
   the scale has changed during the drag, growth is paused while the pointer is within
   `GROWTH_CAP_MARGIN_PX` (48 px) of the edge of its scroll container (the nearest clipping
   ancestor, clamped to the viewport). While paused the last uncapped frame is rendered, so the
   scale and mapping stay constant and the node still follows the pointer; growth resumes
   when the pointer moves back out. The test depends only on the pointer, so a held pointer
   cannot toggle it frame to frame. At a fixed zoom the cap is inert.
5. **The `<svg>` stays `overflow: visible` while dragging**, so a node drawn past a held frame
   is not clipped.
6. **Release drops the transform and keeps the final frame.** A one-time shift is accepted: at
   the top and left (negative origin) and, in a centring host, half the growth at the right
   and bottom. In fit mode the host's scale may also jump to the final fit.
7. **Cancel needs no extra code.** `pointercancel` and Escape (when editing, the existing
   `onNodeDragCancel` opt-in) clear the drag positions, so the layout, and with it the frame,
   returns to the pre-drag one, and the transform is dropped because the drag is over.
8. **A fitting host learns of growth through `onFrameChange`.** `C4InteractiveRenderer` calls
   it from a layout effect when the viewBox size changes. The playground re-measures its fit
   from it, so the new scale lands before paint. A `ResizeObserver` would not do: in a
   width-limited fit the rendered size does not change as the frame grows, and an observer's
   state update could land after a paint.
9. **`useC4ConnectDrag` is unchanged**: a connect drag moves no node and does not change the
   frame. `useC4DiagramDrag` is additive (`remapDrag`, `C4DragInfo.synthetic`).
10. **The playground pins the diagram to the top** (`margin: 0 auto` rather than `margin: auto`),
    keeping horizontal centring. This also removes the 12 px jump seen when the add menu opens.

## Alternatives rejected

- **Freeze the frame for the whole drag (the #100 decision).** Correct, but the drawing area
  stopped growing until release. Replaced by this amendment.
- **Compensate the container's scroll or the SVG's offset (b).** Layout-specific and fragile
  across hosts.
- **Compute the compensation from the host layout.** The measure-and-cancel approach needs no
  knowledge of `margin: auto`, `justify-content` or scroll, and cannot be wrong about them.
- **Track the applied translation and subtract it from a CTM that includes it.** Engines
  disagree on whether `getScreenCTM()` includes a CSS transform. Remove, measure and reapply
  inside one layout effect is engine-independent.
- **Recompute the CTM every frame against an anchored origin (c).** This was rejected by #100
  for reintroducing the feedback loop. It is acceptable again only in fit mode, where the scale
  really does change, because the loop is now bounded by the pointer-margin cap and the remap
  pass limit. At a fixed scale the lock is kept, and the origin hold makes it exact.
- **Limit growth per frame instead of a margin.** It only slows the runaway; a pointer-margin
  rule bounds it directly and can be tested for settling.

## Consequences

- The frame, and with it the host's scroll extent or block height, grows during the drag.
- When a drag grows the diagram, content shifts once on release (top/left; plus half the growth
  in a centring host). No animation. In fit mode the scale can jump too.
- `overflow: visible` frees the node from the SVG's clip, not from a scroll container's. A node
  dragged beyond the pane's top or left edge is clipped until release, though correctly positioned.
- Hosts that need the viewport to stay put after release must handle it themselves. Reporting
  the shift so a host can scroll to match is deferred until liminis-editor#194 adopts this version.
  *(Amendment 2026-11-16, #110: delivered, as an opt-in. See below.)*
- A scroll of the host container mid-drag still invalidates the locked mapping, as before.
  *(Amendment 2026-11-16, #110: with `holdOrigin={false}` the renderer maps through the live
  matrix, so a host scroll is followed. See below.)*
- In fit mode the node can be off the pointer by a bounded amount for a few commits after the
  scale changes, until the remap converges; this is the cost of a one-commit lag between a move
  and its frame. In zoom-to-fit near the container edge growth pauses, so the diagram is not
  re-fitted until the pointer moves back in.
- The compensation is a transient `transform` on the `<svg>`, not the zoom mechanism (zoom is
  still the rendered size). Overlays are siblings of the `<svg>` and do not receive it; none is
  open during a drag, because the menu closes on the pointerdown that starts it and a label
  input on blur.
- The published `playground.css` no longer centres vertically.
- Tests need a CTM stub that models layout, the CSS transform and centring; identity stubs
  cannot fail on this bug. See `src/react/test-utils/svgGeometry.ts` and
  `src/react/C4InteractiveRenderer.drag-frame.test.tsx`.
- Not testable here: flicker (all of it must land before paint) and WebKit's CTM behaviour with a
  transform. The fixed-scale path does not depend on the latter; the fit-mode mapping reads the
  live matrix and does.

## Manual check (playground, both zoom modes)

Run the playground (Chromium, and Safari/iPad since WebKit's CTM handling is the risk):

1. **100% zoom.** Drag a node about 160 px past each of the top, left, right and bottom edges
   in turn. The node stays under the pointer; no other node slides; the pane's scrollbars grow
   during the drag; the diagram stays pinned to the top of the pane. Release: a one-time shift is
   expected when growth was at the top or left.
2. **Fit (⤡).** Drag a node outward toward the pane edge. It stays under the pointer while the
   other nodes shrink and shift; near the edge growth pauses and nothing runs away; moving back
   in resumes it.
3. **Cancel.** In each mode press Escape mid-drag: the pre-drag frame returns and nothing is left
   shifted.
4. **Long-press.** Long-press a boundary without moving: the diagram does not move.

## Amendment 2026-11-16 (#110): the host may absorb the origin shift

**Problem.** The hold is a CSS `transform`, which paints outside the svg's layout box. A host
whose container clips (any `overflow` other than `visible`) cuts off the grown strip, the
dragged node included, until release; a host that does not clip gets the drawing spilling over
neighbouring UI. Growth at the bottom or right moves nothing, so the four edges behaved
differently (liminis-editor#206: a node 180px above the top fully hidden under
`translate(0, -180px)`; the drawing about 300px past the left edge). A host could not repair
this: the transform was unconditional and `onFrameChange` reports only the frame's size.

**Decision.** Two additive props on `C4InteractiveRenderer`. The default is unchanged, so this
is a patch under the 0.x policy.

1. `holdOrigin?: boolean` (default `true`). With `false` the renderer never writes
   `style.transform`, not even `''`, at any point of a drag or after it. The svg's layout box is
   the whole drawing at every edge.
2. `onOriginShift?: (shift: { dx: number; dy: number }) => void`. Called from a layout effect, in
   the commit that changes the frame and so before paint, when the diagram origin moves inside
   the svg box (top/left growth or shrink). It is called **only with `holdOrigin={false}`**: in
   default mode the renderer's own transform already compensates, and a host that scrolled as
   well would compensate twice.
3. The shift is computed from the frame actually rendered, not measured: the origin's offset in
   the box is `-viewBox{X,Y} * scale`, and the report is the difference from the previous commit
   (rendered px, positive = right/down, per commit and not cumulative). It needs no DOM
   measurement, so a host scrolling inside the callback cannot corrupt the baseline; it is
   exactly zero for bottom/right-only changes, which never fire. The previous-commit baseline
   advances on every commit, reported or not. A pure scale change (zoom-to-fit) with a nonzero
   `viewBox` origin is a real shift and is reported, using each commit's own scale. While the
   growth cap holds the last uncapped frame nothing is reported; when growth resumes, one report
   carries the whole delta since the last reported frame.
4. A cancel (pointercancel, Escape) restores the pre-drag frame in the same commit that ends the
   drag, so the effect treats "the previous commit was a drag commit" as in-drag and reports the
   reverse shift, letting the host undo its scroll. A normal release has final frame == last drag
   frame, so nothing fires and nothing jumps (no hold to drop).
5. Pointer mapping. `useC4DiagramDrag` gets `liveMapping?: boolean` (additive, as ADR-99 §9); the
   renderer sets it with `holdOrigin={false}`. The locked matrix is stale once the host scrolls
   by anything but the exact shift (rounding, clamping), so the live `getScreenCTM()` is used
   throughout.
6. Remap. When the host moved the svg on screen inside the callback (its CTM changed across the
   call), the renderer re-maps the last pointer position, bounded by `MAX_REMAP_PASSES`. For an
   exact host this is a no-op; for an inexact one it brings the node back under a stationary
   pointer. A host that does *not* scroll gets no remap: chasing a shift nobody compensates is
   the feedback loop #100 removed.

**Rejected.** Measured `getScreenCTM()` deltas: a host that scrolls in the callback changes the
matrix after the baseline was taken, and a centring host would report right/bottom shifts that
are not origin shifts. `Δ(viewBox) * currentScale`: hides the real on-screen movement when the
scale changes. Firing `onOriginShift` in default mode: double compensation.

**Consequences.**
- A host that opts out and does not compensate sees the drawing shift on screen, by the growth,
  as the drag proceeds. That is its choice; the renderer neither prevents nor works around it,
  and a stationary pointer settles (no runaway).
- Scroll positions round, so a host accumulating `scrollTop += dy` can be under 1px off per
  frame; live mapping absorbs it.
- The host can only scroll by `dy` once the box has grown by `dy` at the top; it has, since the
  shift is reported in the commit that grew it.
- Not testable in happy-dom: paint timing, real scroll clamping and reflow. The tests prove the
  arithmetic and callback timing (`C4InteractiveRenderer.origin-shift.test.tsx`).

**Manual check (Chrome), the liminis-editor#206 scenarios.** Host with an `overflow: auto`
container, `holdOrigin={false}` and `onOriginShift` scrolling by `dx`/`dy`:
1. Drag a node 180px above the top edge: it stays visible and under the pointer; no jump.
2. Drag about 300px past the left edge: nothing paints outside the container; no jump.
3. Drag back inside: the container scrolls back; the frame shrinks.
4. Escape mid-drag past the top: the scroll is restored.
5. Release: nothing moves.
