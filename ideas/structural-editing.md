# Structural editing: adding elements and relationships from the diagram

**Status**: pre-spec sketch, superseded. Implemented in #92 — see `specs/92-add-elements-and-relationships-from-the-diagram/` and `adrs/92-structural-editing-edit-api.md`. Kept for the background and the reasoning; do not implement from this file.
**Raised**: 2026-11-13.
**Related**: #27 (diagram wiki: identity, link syntax, the document graph); the
[Limitations](../docs/src/content/docs/index.mdx) section of the docs site, items 1 and 2;
`liminis-editor` `src/app/editor/nodes/C4Component.tsx` (the main host).

## The idea

Today a diagram can be **rendered** and its nodes **dragged**. Everything else — adding a
box, connecting two boxes — means leaving the diagram and editing C4-PlantUML text.

The idea is to let a user do both from the diagram itself:

- **add an element**: pick a kind, place it on the canvas, optionally inside a boundary;
- **add a relationship**: drag from one element to another to draw a `Rel` between them.

Dragging stays as it is.

## What exists today

These facts shape every option below.

- **The source text is the source of truth.** `C4InteractiveRenderer` is controlled. It takes
  an already-parsed `C4Diagram` plus `manualPositions`, and reports drags through
  `onPositionChange`. It never sees the text. Positions are a separate sidecar that the host
  persists. `liminis-editor` keeps them in the fence meta as `@layout {…}`.
- **The package never writes anywhere** (Limitations item 2). Persistence is always the
  host's call.
- **The parser is line-based.** It handles one macro per line, and boundaries open with `{`
  and close with `}`. While parsing it knows the line of every element, every relationship
  and every closing brace, but it throws that away: **the AST carries no source locations.**
- **The AST is lossy, and on purpose.** It is a rendering model, not a syntax tree:
  - a `Rel`'s technology argument is dropped, because `C4Relationship` has only `label`;
  - the `Rel_D` / `Rel_U` / … direction variants collapse to plain relationships;
  - `ContainerDb_Ext` becomes `{type: container, shape: cylinder, external: true}`;
  - comments, `!include`, `SHOW_LEGEND()` and `title` are stripped.
- **The playground already owns both halves.** `C4Playground` holds `text` and `positions` in
  React state, so the feature can be shown end to end in this repo with no other host.

## The principle: an edit is a minimal patch to the source text

Adding an element should change the source exactly as a careful person would by hand. That
means inserting one macro line in the right place and touching nothing else.

Why this is the principle and not merely an option:

- **Re-serialising the model loses data.** If an edit mutates the `C4Diagram` and the text is
  regenerated from it, every comment, every `Rel` technology, every direction variant and
  every stripped directive disappears on the first edit. That would be unacceptable even for a
  demo.
- **It keeps diffs line-sized.** #27's wiki stores diagrams as "plain text, line-diffable" in
  git. Adding one box should produce a one-line diff, not a reformatted file.
- **It keeps the controlled contract.** The renderer still never owns state. It tells the host
  what the user did, and the host decides what happens to its text. That is exactly how
  positions work today, and it keeps Limitations item 2 true.
- **Undo comes free.** An edit is just a change to text the host already owns, so whatever
  undo the host has covers it. In `liminis-editor` that is Lexical history, through
  `node.setCode`. The package needs no undo of its own.

The rejected alternative is "the model is the truth, the text is an export". That is a
different product, and it would break every hand-written diagram that exists.

## A plausible shape, in three layers

1. **Source spans in `./core`.** The parser records where each element, relationship and
   boundary sits: its line range, plus the line of the boundary's closing brace. This is cheap
   because the parser already has `lineNum`. Adding the fields is additive, so no existing
   consumer breaks.
2. **A pure edit function in `./core`.** Something like `applyC4Edit(source, edit)` returns the
   new source. `edit` is a discriminated union, starting with:
   - `addElement` — macro, label, optional parent boundary, optional technology and
     description;
   - `addRelationship` — source id, target id, label, optional technology.

   It finds the insertion point, matches the siblings' indentation, quotes and escapes the
   arguments, and generates an alias. Being headless, it works the same from a CLI, a test or
   an agent. "Claude, add a cache between the API and the database" becomes one call against
   the same function the UI uses.
3. **Interaction in `./react`.** An add-element affordance places a new element where the
   user clicks. A connection handle on each node starts a relationship drag that ends on a
   target node. The renderer reports `onEdit(edit, { position })` and the host applies it.
   Nothing about the controlled pattern changes.

## The host contract has to change too

This is the trap. **`liminis-editor` clears the whole manual layout whenever the set of
element ids changes.** See its `C4Component.tsx`, the effect commented "TASK 7: Clear manual
layout when DSL code changes (elements added/removed)". That made sense while adding an
element meant retyping the source. In a place-and-connect UI it is exactly wrong: placing one
new box would throw away every position the user had arranged.

So the new element's position should travel with the edit, which is why `onEdit` carries
`{ position }`. Hosts should then **merge** positions instead of clearing them. Hosts also need
a rule for the elements that have no manual position yet. They are laid out by dagre, and
adding a node can move them. That needs deciding: either pin every currently visible node at
its current spot when the first structural edit happens, or accept the reshuffle.

The editor-side change belongs in `liminis-editor` and is a separate piece of work. This
package can make the right behaviour easy, but it cannot impose it.

## Lessons the existing code already paid for

- **Pointer events, not mouse events,** and handle `pointercancel`. `useC4DiagramDrag`
  documents why: mouse-only drag silently failed on iPadOS, where the page panned instead of
  the node moving. A connect-drag has the same exposure.
- **Move-drag and connect-drag must be distinguishable.** Today pressing anywhere on a node
  starts a move. A connection needs its own handle, or a modifier, or a mode. An ambiguous
  gesture is worse than either feature alone.
- **Everything stays behind `isEditMode`.** A read-only render must not grow affordances.

## Open questions

1. **How does a new element get its name?** This is the biggest scope question.
   - Create it with a placeholder label and let the user rename it in the source. This is
     cheap, but it feels unfinished.
   - Edit the label inline in the diagram, with an HTML input over the node. This is the
     natural experience, but it is a real piece of work. It is also the first text input this
     package would own.
   - Hand the request to the host through a callback, so the host prompts. This is flexible,
     but it pushes UI out to every host.

   My lean is inline editing, scoped to the label only.
2. **Which kinds can be added?** There are four types, each with `_Ext`, `Db` and `Queue`
   variants, plus boundaries and deployment nodes. A first cut could offer Person, System,
   Container and Component, plus the `Db` variant, and leave everything else to the source.
   *Answered for boundaries by #95 (ADR-95): `System_Boundary`, `Container_Boundary` and
   `Boundary` can be added, as an empty two-line block, from a separate menu group.*
3. **Should C4 nesting rules be enforced?** For example, Components only inside a
   `Container_Boundary`. The parser does not enforce them today. The UI could warn, block, or
   stay out of it.
4. **Can relationships start or end on boundaries?** C4-PlantUML allows it. The renderer's
   edge clipping may or may not handle it well.
5. **How are aliases generated?** A slug from the label with a collision suffix is the obvious
   rule. It matters more than it looks, because positions are keyed by id (Limitations
   item 3).
6. **Where does a top-level element go?** After the last top-level element is one answer.
   Before the first `Rel` is another. In either case, it must go before any `@enduml`.
7. **What happens when the source does not parse?** `parseC4` returns `diagram: null` on any
   error, so there is nothing to click. Structural editing is presumably disabled until the
   text parses again.
8. **What comes next: delete, rename, re-parent, edit a relationship?** All are obvious
   followers. The edit union is shaped so that adding them is additive. **Rename is built**
   (#94, ADR-94): the first edit that modifies an existing line, by replacing only a label
   argument; relationships are targeted by index plus a staleness guard. Delete, re-parent,
   changing an element's kind and editing description or technology remain open.

## What would make this worth specifying

A first cut whose acceptance criteria can be checked in the playground:

- add an element at the top level and inside a boundary;
- add a relationship by dragging between two elements;
- confirm by diff that the source changed by exactly the inserted lines, with comments,
  technologies and directives elsewhere in the file untouched;
- confirm that the new element appears where it was placed, without moving the others.

Supporting work:

- source spans and `applyC4Edit` with their own unit tests, including round trips over the
  existing fixtures;
- an update to the docs Limitations section, since item 1 ("No editing affordance") stops
  being true.

The `liminis-editor` host change would be filed in that repo, alongside this work.
