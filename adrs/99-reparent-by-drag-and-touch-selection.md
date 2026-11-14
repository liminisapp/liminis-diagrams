# ADR-99: Re-parent by drag, and touch selection with an action bar

**Status**: Accepted
**Issue**: #99 — Move elements into and out of boundaries by drag and drop (re-parent)
**Amends**: ADR-92 and ADR-95 (the "one contiguous block inserted" guarantee), ADR-92 decision 2
(the edit union).
**Supersedes**: ADR-94 decision 9 for *elements* (touch long-press rename).

## Context

Which boundary an element belongs to is decided only by where its line sits in the source. From
the diagram there was no way to change it: dragging a child past its boundary's edge made the
boundary grow (the layout sizes a boundary to contain its children), and dropping an element on
a boundary changed only its position. Users had to leave the diagram, cut a line and paste it
into another block.

A move is the first edit that also *removes* text, so ADR-92/95's pure-insertion guarantee cannot
hold for it. Touch has no ⌥ key and no double-click, and ADR-94's long-press rename on an
element collides with press-then-drag: a pause before moving turned the drag into a rename
(visibly broken on iPad).

## Decision

1. **"One contiguous block inserted" becomes "one block moved".** A `reparent` removes a block at
   its old place and inserts it at the new one. Only that block changes, in position and
   indentation; every other byte is identical (comments, `Rel` arguments, direction variants,
   blank lines, line endings). The block is an element's one line, or a boundary's whole
   `{ … }` block from its opening line to its closing `}`. Comments and blank lines *next to* an
   element's line are not part of it and stay put.
2. **`C4Edit` gains `{ kind: 'reparent', id, parent? }`** (additive). `parent` omitted means the
   top level. New failure code `move-into-self` (a boundary moved into itself or a descendant);
   the others reuse `unknown-element`, `unknown-parent`, `boundary-cannot-take-children` and
   `invalid-result`. A move to the current parent returns the source unchanged and ok (the
   rename precedent).
3. **Destination.** At the end of the parent's block, immediately before its closing `}`; for the
   top level, after the last top-level element or block (ADR-92's rule). The anchor and the
   last-sibling indent ignore the moved block, otherwise moving the last top-level item would
   anchor on itself. The insertion offset and the removal range are both computed on the
   original text and applied later-offset first, so a destination before or after the source, or
   adjacent to it, cannot shift the other.
4. **Re-indent.** The moved block is shifted by one uniform amount: the first line's indent is
   replaced by the destination's sibling indent (the last sibling's, else the parent's plus one
   unit) on every non-blank line that starts with it. Blank lines stay blank, internal relative
   indentation is preserved, and lines keep their own line terminators.
5. **`verifyReparent`** re-parses the result and requires the same elements (id, type, name,
   properties), every element under its original parent except the moved id, the same
   relationships *as a multiset* (a moved block containing `Rel` lines changes parse order, so
   the index-by-index comparison of `verifyRename` does not apply), and a moved boundary's block
   of the same length. An unterminated moved boundary, or any shape that does not survive a move,
   returns `invalid-result` rather than mis-nesting children.
6. **Gesture: drop onto a boundary, ⌥-drag to move out.** The target is the innermost boundary
   under the pointer at release, excluding the dragged item and its descendants. Plain drop:
   target exists and is not the current parent → reparent into it; otherwise nothing structural.
   A plain drop onto an *ancestor* of the current parent therefore lifts the item into that
   ancestor; that is intended (the pointer is over it) and is tested. ⌥: no target and a
   parent → top level; target other than the parent → into it; anything else is a plain move.
   ⌥ is read at release (the `pointerup` event), which avoids a stuck-modifier state.
7. **Hit-test against a drag-start snapshot of the layout.** During a drag the live layout is
   recomputed and the old parent boundary grows to contain the child, so hit-testing it finds the
   old parent nearly every time: ⌥-drag could never find empty canvas and the highlight would
   stay on the old parent. The renderer snapshots `layout.nodes` when the press starts. No other
   node moves during a drag, so the snapshot cannot go stale. The highlight is drawn from the
   same rectangle: a dashed (not colour-only) accent outline with a faint tint.
8. **Reported through `onEdit` only.** A re-parent drop calls `onEdit(edit, { positions })` and
   not `onPositionChange`; the host applies source and positions together and merges, never
   clears, as for every edit. Positions are pinned from the pre-drag layout, so the old boundary
   shrinks back and no other position moves; the moved item keeps the dropped position, clamped
   into the new parent's content area (as for a new nested boundary) so the parent does not
   shift its own origin, and a moved boundary's descendants keep their offsets. If the host
   rejects the edit the dropped preview lingers until the next drag.
9. **`useC4DiagramDrag` is extended additively.** `onNodeDrag` / `onNodeDragEnd` gain a trailing
   `info` argument (`point`, client coordinates, `altKey`, `pointerType`). A new optional
   `onNodeDragCancel` opts in to cancel semantics: `pointercancel` and Escape abandon the drag
   (no end callback, no position change). Without it the hook behaves exactly as before, and
   the renderer passes it only with `isEditMode && onEdit`, so a plain `isEditMode` is
   unchanged.
10. **Touch: tap to select, with an action bar.** A tap (touch or pen, pointer moved no more than
    the long-press tolerance) selects the node and shows a small HTML bar beside it with
    **Rename** (elements only) and **Move out** (nodes with a parent boundary). Move out
    reports a top-level `reparent` with every position pinned as it is, whatever the nesting.
    A top-level boundary offers nothing and is not selected. Selection is transient UI state
    (not reported, not persisted); it is cleared by any press on the canvas, Escape, an add
    menu or rename starting, leaving edit mode, or the alias disappearing. A tap does not report
    positions; a mouse click keeps doing so. The bar is touch and pen only: on desktop it
    would appear after every click, which is also the first half of a double-click rename.
11. **This reverses ADR-94 decision 9 for elements.** Long-press on an element no longer renames:
    a pause between pressing an element and dragging it never becomes a rename, and rename on
    touch is the bar's Rename. Long-press stays on boundaries and empty canvas (the add menu)
    and, unchanged, on a relationship label: it does not collide with a move-drag and ADR-94's
    reasons for it still hold.
12. **Rules unchanged.** Pointer events and `pointercancel`; edit mode with `onEdit` only; move,
    connect, the menu and rename stay mutually exclusive; no warning for relationship-heavy
    moves; nesting rules are not enforced (any boundary kind accepts any child).

## Consequences

- A user can move an element or boundary into and out of boundaries with no source editing, on
  desktop and touch. Aliases never change, so relationships and manual positions survive.
- ADR-92/95's "pure insertion" test no longer describes every edit; the guarantee for a move is
  the one stated in decision 1, and `verifyReparent` is its safety net.
- Taps on touch no longer report `onPositionChange`; hosts that relied on the side effect of a
  bare touch tap writing the seeded positions lose it. Mouse clicks are unchanged.
- A `pointercancel` during an editing drag no longer reports a position (it used to behave like
  a release). Hosts that use the hook directly are unaffected unless they pass `onNodeDragCancel`.
- Docs that said "long-press on touch" for renaming an element are updated; a missed mention
  would contradict this ADR.

## Not built

Wrapping existing elements in a new boundary, delete, multi-select, reordering siblings within
one boundary, and the C4 nesting rules.
