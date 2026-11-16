# Feature Specification: C4InteractiveRenderer: let the host own the context menu (onContextMenu hook with the diagram's items)

**Feature Branch**: `fabrik/issue-107`
**Created**: 2026-11-15
**Status**: Specified
**Input**: User description: "## Problem

In edit mode, `C4InteractiveRenderer` opens its own add-element menu (`EditMenu`) on right-click and long-press. A host that already has a context menu on the diagram then shows **two menus at once**. `handleContextMenu` calls `preventDefault()` but not `stopPropagation()`, so the event still reaches the host's `onContextMenu` on an ancestor.

Seen in `@liminis/editor` while trying liminisapp/liminis-editor#204 (structural editing). The editor's C4 node has its own menu on its container (Edit text…, Edit/Exit layout mode, Reset to auto layout, Copy image to clipboard), shared with its Mermaid node. A right-click on the canvas in layout mode opens both, overlapping.

A host shouldn't have to choose between its own menu and the diagram's. It should be able to show **one** menu that holds both sets of items.

## Desired outcome

The renderer can hand its context-menu actions to the host instead of drawing its own menu.

Sketch only. The Plan stage owns the final shape:

```ts
interface C4MenuItem {
  id: string;                 // stable, e.g. 'add:element:person'
  label: string;              // 'Person', 'System boundary', …
  group: 'element' | 'boundary';
  select(): void;             // same effect as picking it in EditMenu today: places it at the opened point
}

interface C4ContextMenuRequest {
  clientX: number;
  clientY: number;
  pointerId: number | null;   // long-press origin, as MenuState has today
  items: C4MenuItem[];        // the diagram's actions at this point; [] where none apply (e.g. on a node)
}

// C4InteractiveRenderer prop
onContextMenu?: (request: C4ContextMenuRequest) => void;
```

- When `onContextMenu` is supplied, the renderer never renders `EditMenu`. It calls the hook for both right-click and long-press, the touch path from `useC4LongPress`.
- It calls the hook even where it has no items of its own (on a node, or outside edit mode while still interactive), so the host's own items are still reachable there.
- It handles the event once: `preventDefault()` plus `stopPropagation()`, so a host with an ancestor handler doesn't open a second menu.
- `select()` keeps today's placement rules (centred on the opened point, clamped inside an enclosing boundary), then hands off to the existing pending-add flow and `onEdit`.
- Without the prop, behaviour is unchanged. This is additive.

## Acceptance criteria

- [ ] With `onContextMenu`, a right-click on the canvas in edit mode calls it once, with the add-element and boundary items, and no `EditMenu` appears.
- [ ] A long-press does the same, with `pointerId` set.
- [ ] A right-click on a node, or anywhere `isMenuTarget` currently refuses, calls the hook with `items: []`.
- [ ] Calling an item's `select()` gives exactly the same `onEdit`/positions result as picking that kind in `EditMenu` today, including the clamp inside a parent boundary.
- [ ] The event doesn't propagate past the renderer while it's handled. A test covers an ancestor `onContextMenu` that must not fire.
- [ ] Without the prop, the existing menu tests pass unchanged.
- [ ] The docs recipe (\"The host's half\") shows a host merging the diagram's items into its own menu. The playground does this too, or the recipe explains why not.

## Pointers

- `src/react/C4InteractiveRenderer.tsx`: `MenuState`, `handleContextMenu`, `openMenuAt`, `handleSelectKind`
- `src/react/EditMenu.tsx`: item labels and grouping (the host needs the same labels)
- `src/react/hooks/useC4LongPress.ts`
- Consumer: liminisapp/liminis-editor `src/app/editor/nodes/DiagramContextMenu.tsx`, `C4Component.tsx`"

## Background

In edit mode the renderer draws its own add-element menu on right-click and long-press. That menu lists element kinds and, in a separate group, boundary kinds (shipped in #92/#93/#95). A host that already has a context menu on the diagram ends up with two menus open at once: the renderer swallows the browser's default menu but still lets the event bubble to the host's ancestor handler.

This was seen in `@liminis/editor` while trying structural editing (liminisapp/liminis-editor#204). Its C4 node has a container menu (Edit text…, Edit/Exit layout mode, Reset to auto layout, Copy image to clipboard) shared with its Mermaid node. A right-click on the canvas in layout mode opens both menus, overlapping.

A host should not have to choose between its own menu and the diagram's. It should be able to show **one** menu holding both sets of items. So the renderer needs an opt-in way to hand its context-menu actions to the host instead of drawing a menu, and to stop the event reaching the host's own handler so the host controls the single menu.

The change is additive: a host that does not opt in sees no change. As everywhere in this package, the renderer never writes anywhere and never applies an edit. Choosing an item leads, as today, to a label prompt and then an edit reported through `onEdit`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One merged menu on right-click (Priority: P1)

A host with its own diagram context menu supplies the new hook. When the user right-clicks the canvas in edit mode, the host receives the click position and the diagram's add-element and add-boundary items, and shows a single menu with its own items and the diagram's together.

**Why this priority**: This is the reported bug: two overlapping menus. Everything else builds on it.

**Independent Test**: Render the renderer in edit mode, with `onEdit` and the hook, inside an ancestor that has its own `onContextMenu`. Right-click empty canvas. The hook is called once with element and boundary items, the ancestor handler does not fire, and no built-in menu is in the DOM.

**Acceptance Scenarios**:

1. **Given** edit mode, `onEdit` and the hook, **When** the user right-clicks empty canvas, **Then** the hook is called exactly once with the click's client coordinates, `pointerId: null`, and the element items followed by the boundary items; and no built-in menu appears.
2. **Given** the same setup inside an ancestor with its own context-menu handler, **When** the user right-clicks the canvas, **Then** the ancestor handler is not invoked and the browser's default menu is suppressed.
3. **Given** a right-click inside a boundary, **When** the host calls an item's `select()`, **Then** the element is placed centred on the clicked point, clamped inside that boundary, and goes through the same label prompt and `onEdit` flow as the built-in menu.

---

### User Story 2 - Long-press hands the same request to the host (Priority: P1)

On touch, a long-press on the canvas opens the host's menu the same way, and the host can tell which pointer started it.

**Why this priority**: The renderer has two ways to open its menu today (right-click and long-press). A host that only gets one still shows a second menu or loses touch support.

**Independent Test**: Simulate a long-press on empty canvas with the hook supplied. The hook is called once with `pointerId` set to the pressing pointer and the same items as a right-click; no built-in menu appears.

**Acceptance Scenarios**:

1. **Given** edit mode and the hook, **When** the user long-presses empty canvas, **Then** the hook is called once with `pointerId` set and the same items as right-click.
2. **Given** a long-press that starts on a boundary, **When** it fires, **Then** any move-drag it started is dropped without reporting positions, as it is today, and the hook is called with the boundary-scoped items.

---

### User Story 3 - Host items stay reachable where the diagram has none (Priority: P1)

Right-clicking a node, a relationship label or other places where the diagram offers no add actions still reaches the host, with no items, so the host can show its own menu there.

**Why this priority**: Because the renderer now stops the event, a host's own menu would otherwise become unreachable over most of the diagram.

**Independent Test**: With the hook supplied, right-click a node. The hook is called once with `items: []` and the ancestor handler does not fire.

**Acceptance Scenarios**:

1. **Given** the hook, **When** the user right-clicks an element, a relationship label, a connect handle or the legend, **Then** the hook is called once with `items: []`.
2. **Given** the hook and edit mode off, **When** the user right-clicks the diagram, **Then** the hook is called once with `items: []`.

---

### User Story 4 - Choosing an item behaves exactly like the built-in menu (Priority: P2)

Calling an item's `select()` produces the same result as picking that kind in the built-in menu today: same placement, same clamp inside a parent boundary, same pending-add label prompt, same `onEdit` edit and positions.

**Why this priority**: The host menu is a second front end to an existing flow. A divergence would make the same action behave differently depending on the host.

**Independent Test**: For each element and boundary kind, at top level and inside a boundary, run the flow once through the built-in menu and once through `select()`, and compare the resulting `onEdit` calls and positions.

**Acceptance Scenarios**:

1. **Given** an item for each addable element and boundary kind, **When** `select()` is called then a label is confirmed, **Then** `onEdit` receives the same edit and positions as the built-in menu produces for that kind at that point.
2. **Given** an item for a nested boundary near its parent's top-left edge, **When** `select()` is called, **Then** the new boundary is clamped inside the parent's content area, as in the built-in menu.

---

### User Story 5 - Existing hosts are unaffected, and the docs show the recipe (Priority: P2)

A host that does not supply the hook sees no change. A host author finds a documented recipe for merging the diagram's items into their own menu.

**Why this priority**: The package is published and the change must be safe to ship. The recipe is how the feature is discovered.

**Independent Test**: Run the existing menu tests unchanged. Read the recipe and follow it to build a merged menu.

**Acceptance Scenarios**:

1. **Given** no hook, **When** the user right-clicks or long-presses, **Then** the built-in menu opens exactly as today and the existing menu tests pass without modification.
2. **Given** the docs, **When** a host author reads "The host's half", **Then** it shows a host merging the diagram's items into its own menu, and the playground does the same or the recipe says why it does not.

---

### Edge Cases

- A right-click while a drag or a connect is in flight: swallowed (default menu suppressed, propagation stopped), and the hook is not called.
- A right-click while a label input, rename input or other overlay is open: handled like any other right-click; the hook is called.
- A request whose items are never used (the host closed its menu): nothing is left pending in the renderer. No state is retained between the hook call and `select()`.
- An item's `select()` called after the diagram changed: the placement uses the point and enclosing boundary captured when the request was made, not a stale or re-hit-tested position. If that boundary no longer exists, the item behaves as at top level (or is a no-op); it must not throw.
- A long-press that the browser later cancels: the host can see `pointerId` and decide whether to close its menu, as the built-in menu does on `pointercancel`.
- Edit mode on without `onEdit`: the diagram cannot report an edit, so it offers no items (see Assumptions).
- A host that supplies the hook but renders it conditionally or sets it to `undefined` later: the renderer reverts to built-in behaviour on the next render.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `C4InteractiveRenderer` accepts an optional `onContextMenu` hook that receives a request describing the position, the originating pointer, and a list of menu items.
- **FR-002**: The request carries the client coordinates of the event, `pointerId` (the pressing pointer for a long-press, `null` for a right-click), and `items`.
- **FR-003**: Each item carries a stable `id` (for example `add:element:person`, `add:boundary:systemBoundary`), a human-readable `label` identical to the one in the built-in menu, a `group` of `element` or `boundary`, and a `select()` action.
- **FR-004**: Items cover every kind the built-in menu offers, in the same order and grouping: element kinds first, then boundary kinds.
- **FR-005**: The labels and the list of kinds are defined once, so the built-in menu and the hook cannot drift apart.
- **FR-006**: When the hook is supplied, the renderer never renders the built-in menu, for either right-click or long-press.
- **FR-007**: In edit mode with `onEdit`, a right-click on empty canvas or inside a boundary calls the hook exactly once with the element and boundary items.
- **FR-008**: In edit mode with `onEdit`, a long-press on the same targets calls the hook exactly once with `pointerId` set and the same items. A long-press that started a move-drag drops that drag without reporting positions, as it does today.
- **FR-009**: A right-click on a node, relationship label, connect handle, legend, or anywhere the built-in menu currently refuses to open, calls the hook with `items: []`.
- **FR-010**: With the hook supplied and edit mode off, or edit mode on without `onEdit`, a right-click calls the hook with `items: []`.
- **FR-011**: When the hook is supplied, the renderer handles the context-menu event once: it suppresses the browser default menu and stops propagation, so an ancestor `onContextMenu` handler does not fire.
- **FR-012**: A right-click during a drag or a connect is swallowed without calling the hook. An open label or rename input does not count as busy for this purpose: the hook is still called (see Edge Cases). While such an input is open, an item's `select()` is a no-op.
- **FR-013**: Calling an item's `select()` is equivalent to picking that kind in the built-in menu at the point where the request was made: the new element or boundary is centred on that point, a new nested boundary is clamped inside its enclosing boundary's content area, the enclosing boundary becomes the new item's parent, and the existing label-prompt flow then reports the edit and positions through `onEdit`.
- **FR-014**: The point and enclosing boundary used by `select()` are those captured when the request was made. The renderer keeps no menu state of its own between the hook call and `select()`.
- **FR-015**: Opening the host menu clears any selected element, as opening the built-in menu does.
- **FR-016**: Without the hook, behaviour is unchanged: the built-in menu opens on right-click and long-press, the event's propagation is unchanged, and the existing menu tests pass without modification.
- **FR-017**: The documentation's "The host's half" recipe shows a host merging the diagram's items into its own context menu. The docs playground does the same, or the recipe says why it does not.
- **FR-018**: The new request and item types are exported from the package's React entry point alongside the existing edit types, and the `onEdit`/`onContextMenu` prop documentation is updated.

### Key Entities *(if applicable)*

- **Context-menu request**: What the renderer hands the host when the user asks for a menu on the diagram: where, which pointer, and which diagram actions apply there (possibly none).
- **Menu item**: One diagram action, identified by a stable id, with a label, a group and a way to run it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a host that supplies the hook and has its own ancestor context-menu handler, a right-click or long-press on the canvas results in exactly one host-drawn menu, with the diagram's items and the host's, and zero built-in menus.
- **SC-002**: A right-click on any part of the diagram, including nodes and non-edit mode, reaches the host through the hook exactly once, so no region of the diagram leaves the host's own items unreachable.
- **SC-003**: For every addable element and boundary kind, at top level and inside a boundary, the edit and positions reported via `select()` are identical to those reported via the built-in menu.
- **SC-004**: All existing menu tests pass unchanged.
- **SC-005**: A test shows an ancestor `onContextMenu` handler is not invoked for a right-click the renderer handles when the hook is supplied.

## Assumptions

- **Outside edit mode the hook still fires on right-click.** When the hook is supplied, the renderer takes ownership of the context-menu event over the whole diagram, with `items: []` where it has no actions (the issue's "outside edit mode while still interactive"). Without edit mode there are no diagram actions to offer, and a host that passes the hook accepts that propagation stops at the renderer.
- **Long-press is unchanged outside edit mode.** The long-press gesture exists today only for editing; this issue does not enable it elsewhere. In non-edit mode a host that wants a touch menu uses its own gesture.
- **Without `onEdit`, items are empty.** Edit mode alone, with no way to report an edit, offers no add actions, matching today's rule that the built-in menu appears only with both.
- **Right-click mid-drag or mid-connect is swallowed silently**, with no hook call. An open label or rename input does not swallow it: the hook is called as for any other right-click, and `select()` is a no-op until the input closes.
- **The host owns closing its menu.** The renderer has nothing to close; a host that dismisses its menu simply never calls `select()`.
- **Labels are the existing built-in labels**; localisation is not part of this issue.
- The final type and field names are the Plan stage's call; the issue's sketch is a starting point, and the requirements above fix behaviour, not names.

## Out of Scope *(optional)*

- Restyling or repositioning the built-in menu, or removing it.
- Host-contributed items inside the built-in menu (the reverse direction): the host draws the merged menu.
- Context-menu items for existing nodes (delete, rename, and so on). The hook reports `items: []` there; adding actions is separate follow-up work.
- Enabling long-press outside edit mode.
- Changes in `@liminis/editor` (liminisapp/liminis-editor#204 and its `DiagramContextMenu.tsx`); this issue covers only this package, the consumer adopts it separately.
- A shipped menu component for hosts.

## Source References *(optional)*

- `src/react/C4InteractiveRenderer.tsx`: `MenuState`, `handleContextMenu`, `openMenuAt`, `handleSelectKind`
- `src/react/EditMenu.tsx`: item labels and grouping
- `src/react/hooks/useC4LongPress.ts`
- `adrs/92-structural-editing-edit-api.md`, `adrs/95-multi-line-boundary-insertion.md`
- Consumer: liminisapp/liminis-editor `src/app/editor/nodes/DiagramContextMenu.tsx`, `C4Component.tsx`; liminisapp/liminis-editor#204
- `docs/src/content/docs/recipes.mdx` ("The host's half")
