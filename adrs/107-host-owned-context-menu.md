# ADR-107: A host-owned context menu (`onContextMenu`)

**Status**: Accepted
**Issue**: #107 — C4InteractiveRenderer: let the host own the context menu
**Builds on**: ADR-92 (the renderer reports edits, never applies them), ADR-95 (boundary adds and the nested clamp).

## Context

In edit mode the renderer draws its own add-element menu on right-click and long-press. It
calls `preventDefault()` but not `stopPropagation()`, so a host with its own context menu on
the diagram (`@liminis/editor` has one on its container) shows two menus at once. The host
should be able to show **one** menu holding both sets of items.

## Decision

1. **An opt-in `onContextMenu(request)` prop.** `request` is `{ clientX, clientY, pointerId,
   items }`. Each item is `{ id, label, group, select() }`. With the prop set the renderer never
   renders `EditMenu`; without it nothing changes (same handlers, same propagation, same state).
2. **The renderer owns the `contextmenu` event over the whole diagram while the hook is set.**
   It calls `preventDefault()` and `stopPropagation()` on every `contextmenu` it receives, and
   calls the hook with `items: []` wherever it has no actions (on a node, a relationship label,
   a handle, the legend, outside edit mode, in edit mode without `onEdit`, or if the SVG cannot
   be measured). Stopping propagation would otherwise make the host's own menu unreachable over
   most of the diagram. A right-click during a drag or a connect is swallowed without a call;
   an open label input does not block it.
3. **Long-press uses the same request**, with `pointerId` set. Long-press stays edit-only; a
   host wanting a touch menu elsewhere uses its own gesture.
4. **No menu state between the request and `select()`.** `select()` closes over the SVG point
   and enclosing boundary captured when the request was made. A host that closes its menu never
   calls it, and nothing is left pending in the renderer. If the boundary has gone by the time
   `select()` runs it places at top level; if edit mode has gone it does nothing.
5. **One placement function.** `handleSelectKind` is split so the built-in menu and a host item
   both end in `startPendingAdd(choice, {x, y, parent})` (centre on the point, clamp a nested
   boundary inside its parent, then the existing label prompt and `onEdit`). They cannot drift.
6. **Labels and order are defined once**, in `src/react/menuItems.ts`, which both `EditMenu` and
   the item builder read. The kind lists stay in `core/alias.ts`; the labels are UI strings and
   `core` is the headless entry point.
7. **A native `contextmenu` right after a long-press is one gesture.** Some touch browsers fire
   both. The renderer remembers the time and source of the last host request and ignores the
   *other* source within 750 ms. This is transient bookkeeping, not menu state. A real
   right-click has no long-press partner and is never suppressed.

## Alternatives considered

- **Only `stopPropagation()` with the built-in menu.** Fixes the overlap but the host cannot merge
  its items into the diagram's, which is what it wants.
- **A `renderMenu` prop.** Couples the host to renderer internals (positioning, focus, dismissal).
- **Keeping the menu state in the renderer and exposing it.** It goes stale when the diagram changes.

## Consequences

- A host that supplies the hook accepts that propagation of `contextmenu` stops at the renderer,
  including outside edit mode. React delegates at the root, so this stops React ancestors; a
  native listener on a non-root ancestor DOM node still sees the event.
- The host draws, positions and dismisses the menu, and must close it (and return focus) around
  `select()`: the label input the renderer shows cancels on blur.
- Context-menu items for existing nodes (delete, rename…) are not offered; the hook reports `[]` there.
