# ADR-100: Freeze the SVG frame while a node is dragged

**Status**: Accepted
**Issue**: #100 — Dragging a node past the top/left edge makes the whole diagram slide and the node drift from the pointer
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

## Decision

1. **`C4InteractiveSvg` freezes its frame for the whole drag.** The frame is `viewBox`
   origin, `svgWidth/svgHeight` and the zoom scale. It is the last frame rendered while no
   drag was active, which is by construction the pre-drag frame (the render that first sees
   `draggedNodeId` set still has the pre-drag layout). It also feeds every overlay offset.
2. **The `<svg>` is `overflow: visible` while dragging**, so the node can be drawn past the
   frozen edges.
3. **The layout keeps updating live.** Boundaries still grow to contain a dragged child, edges
   re-route and drop-target highlighting still works; only the SVG frame is frozen.
4. **The frame is recomputed exactly once, when the drag ends** (release, re-parent,
   tap-select or `pointercancel`/Escape), without animation.
5. **`useC4DiagramDrag` and `useC4ConnectDrag` are unchanged.** The CTM lock is now valid for
   the whole drag, because nothing it depends on moves.
6. **The playground pins the diagram to the top** (`margin: 0 auto` rather than `margin: auto`),
   keeping horizontal centring. This also removes the 12 px jump seen when the add menu opens.

Zoom is part of the frame because the playground derives it from the pane size through a
`ResizeObserver`; a resize mid-drag (for example a scrollbar appearing) would otherwise change
the rendered size and invalidate the locked mapping.

## Alternatives rejected

- **Compensate the container's scroll or the SVG's offset (b).** Layout-specific and fragile
  across hosts.
- **Recompute the CTM every frame against an anchored origin (c).** Reintroduces the feedback
  loop the lock exists to prevent.

## Consequences

- When a drag grows the diagram at the top or left, content shifts once on release. No animation.
- `overflow: visible` frees the node from the SVG's clip, not from a scroll container's. A node
  dragged beyond the pane's top or left edge is invisible until release, though correctly positioned.
- Hosts that need the viewport to stay put after release must handle it themselves. Reporting
  the shift so a host can scroll to match is deferred until liminis-editor#194 adopts this version.
- A scroll of the host container mid-drag still invalidates the locked mapping, as before.
- The published `playground.css` no longer centres vertically.
- Tests need a CTM stub that models layout; identity stubs cannot fail on this bug. See
  `src/react/test-utils/svgGeometry.ts`.
