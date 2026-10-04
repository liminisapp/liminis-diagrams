# @liminis/diagrams

C4 architecture diagrams: parse [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML)
macro syntax, lay it out with dagre, render it to SVG — with optional drag-to-position
editing.

Extracted from [`@liminis/editor`](https://github.com/verveguy/liminis-editor), where it
renders ` ```c4 ` fenced code blocks. Nothing here is bound to that editor.

Documentation: **[docs.liminis.app/liminis-diagrams](https://docs.liminis.app/liminis-diagrams/)**.

## Demo

**[https://docs.liminis.app/liminis-diagrams/demo/](https://docs.liminis.app/liminis-diagrams/demo/)** — edit
C4-PlantUML source and see it re-render live, drag nodes to reposition them, toggle dark
mode, and switch between a few preset diagrams. The demo keeps dragged positions in
memory only, for as long as the tab is open — this package has no persistence of its
own (see [Recipe 3](https://docs.liminis.app/liminis-diagrams/recipes/#recipe-3-position-persistence--the-hosts-choice)),
and neither does this demo.

## Install

```bash
npm install @liminis/diagrams
```

`react` and `react-dom` are **optional** peers. Installing the package gets you
`@dagrejs/dagre` and nothing else, so `@liminis/diagrams/core` works in a CLI or CI job
with no React on disk. Install the peers if you use `/react` or `/server` — see
[Architecture](https://docs.liminis.app/liminis-diagrams/architecture/) for why the split exists and which entry
point to pick.

## Not sure this package does what you're assuming?

Read [Limitations](https://docs.liminis.app/liminis-diagrams/#limitations--read-this-first) before you build
against this package. In short: no editing UI, no persistence, element IDs aren't
stable across diagrams, no cross-diagram links.

## Parse and lay out

```ts
import { parseC4, layoutC4Diagram } from '@liminis/diagrams/core';

const { diagram, errors } = parseC4(`
Person(user, "User", "End user")

System_Boundary(app, "My App") {
  Container(fe, "Frontend", "React")
  ContainerDb(db, "Database", "PostgreSQL", "Stores data")
}

Rel(user, fe, "Uses", "HTTPS")
Rel(fe, db, "Reads/writes", "SQL")
`);

if (!diagram) {
  throw new Error(`parse failed: ${JSON.stringify(errors)}`);
}

const layout = layoutC4Diagram(diagram);  // nodes, routed edges, width, height
```

## Render to SVG

```ts
import { renderC4DiagramToSVG } from '@liminis/diagrams/server';

const { svg, errors } = renderC4DiagramToSVG(source, /* isDarkMode */ false);
```

## Render in React, with dragging

`C4InteractiveRenderer` is **controlled**: it takes positions in and calls back with new
ones. Persisting them is the host's job.

```tsx
import { C4InteractiveRenderer } from '@liminis/diagrams/react';

<C4InteractiveRenderer
  diagram={diagram}
  isDarkMode={false}
  isEditMode={true}
  manualPositions={positions}
  onPositionChange={setPositions}
/>
```

Pass `manualPositions` to `layoutC4Diagram` to bypass dagre for the elements you have
positions for. Persisting them is entirely your call — see
[Recipe 3](https://docs.liminis.app/liminis-diagrams/recipes/#recipe-3-position-persistence--the-hosts-choice) for a worked
example (including how `@liminis/editor` does it) and why this package itself never
writes them anywhere.

## Render on the command line

```bash
npx --package=@liminis/diagrams --package=react --package=react-dom -- render-c4 diagram.puml
# diagram.puml -> diagram.svg
```

Useful for pre-rendering diagrams so a plain `![Diagram](diagram.svg)` is enough for
GitHub (or any markdown renderer) to show them — see
[Rendering diagrams on GitHub](https://docs.liminis.app/liminis-diagrams/github-integration/) for the CI recipe, and
[Rendering diagrams in Claude Code](https://docs.liminis.app/liminis-diagrams/claude-code-integration/) for getting Claude
to render real diagrams instead of hand-drawing them.

## Supported syntax

`Person`, `System`, `Container`, `Component` and their `_Ext` / `Db` / `Queue` variants,
plus `Deployment_Node`, `Node`, and `InfrastructureNode` variants; boundary macros;
`Rel` (with directional variants) and `BiRel`. See
[the C4-PlantUML reference](https://docs.liminis.app/liminis-diagrams/dsl-reference/) for the full macro table and exactly
which directives (`@startuml`, `!include`, `SHOW_LEGEND()`, `LAYOUT_*`, …) are applied
versus silently stripped.

## Documentation

Building a tool on top of this package? [the documentation site](https://docs.liminis.app/liminis-diagrams/) covers the
entry-point boundary, the full DSL reference, the data model, and runnable recipes for
headless rendering, embedding the interactive renderer, and position persistence.

## Provenance

The commit history predates this repository: it was recovered from
`verveguy/liminis` (`liminis-app/src/editor/app/editor/c4/`, later
`packages/editor/src/app/editor/c4/`) and carries development from 2026-03-18 onward.
`git log --follow` works across the move.

## License

MIT
