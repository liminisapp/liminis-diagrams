---
name: render-c4-diagram
description: Render C4-PlantUML architecture diagram source (Person/System/Container/Component/Rel macros, often in a fenced ```c4 or ```plantuml block, or a .puml file) into real SVG using the @liminis/diagrams engine, instead of hand-drawing it or relying on Mermaid's C4 support. Use whenever the user shares C4-PlantUML source and wants to see it, embed it in an artifact, or export it as an image.
---

# Render C4 diagrams with `@liminis/diagrams`

Claude has no native support for C4-PlantUML — Artifacts render Mermaid diagrams and
raw SVG natively, but C4-PlantUML is neither, so left alone Claude will either hand-draw
an approximation or refuse. This skill wraps the `render-c4` CLI from
[`@liminis/diagrams`](https://github.com/liminisapp/liminis-diagrams) so a real, correctly
laid-out diagram gets produced instead — see
[Rendering diagrams on GitHub](https://docs.liminis.app/liminis-diagrams/github-integration/) for the CLI's full flag
reference.

## When this applies

The source uses C4-PlantUML macros: `Person`, `System`, `Container`, `Component` (and
their `_Ext`/`Db`/`Queue` variants), boundary macros, `Rel`/`BiRel`. It may arrive as a
fenced ` ```c4 ` or ` ```plantuml ` block, a `.puml` file, or pasted directly into the
conversation. Plain PlantUML that isn't C4 (sequence diagrams, class diagrams, etc.) is
out of scope — this renderer only understands the C4-PlantUML macro subset.

## How to render it

1. Write the diagram source to a temp file, then run the CLI over stdin so no
   intermediate file has to be cleaned up:

   ```bash
   npx --yes --package=@liminis/diagrams -- render-c4 --stdin <<'EOF' > /tmp/diagram.svg
   Person(user, "User", "End user")
   System(app, "My App", "Does things")
   Rel(user, app, "Uses")
   EOF
   ```

   `--package=@liminis/diagrams --` is required, not optional style: the package name
   (`diagrams`) doesn't match its bin (`render-c4`), so a bare
   `npx @liminis/diagrams render-c4 --stdin` resolves the package's one bin first and
   then passes the literal word `render-c4` through as that CLI's first argument —
   which crashes it trying to open a file named `render-c4`.

   Pass `--dark` before `--stdin` if the target surface is dark-mode.

2. Check the exit code before trusting the output:
   - `0` — `/tmp/diagram.svg` contains real SVG. Read it.
   - non-zero — stderr has `path:line:column: message` parse/validation errors. Surface
     those to the user rather than guessing at a fix; don't fall back to hand-drawing a
     diagram that silently disagrees with the source.

3. To embed the result in an Artifact, inline the `<svg>...</svg>` markup directly into
   the HTML — do not re-wrap it in a `<pre class="mermaid">` block or re-encode it as an
   image `src`; it is already a rendered SVG, not diagram source. Scale/position it as
   you would any inline SVG (viewBox is already set by the renderer); no further
   diagramming skill is needed for placement.

4. If `npx` has no network access to fetch the package in this environment, say so
   explicitly rather than silently falling back to a hand-drawn approximation; the
   diagram would otherwise look plausible while being wrong.

## Why not Mermaid or plain PlantUML rendering

Mermaid's C4 support is partial and diverges from the C4-PlantUML macro set this
library implements (`docs/dsl-reference.md` in the `liminis-diagrams` repo has the exact
macro table); rendering through it silently drops or reinterprets constructs. Routing through a public PlantUML rendering server is unnecessary network dependence
for something `@liminis/diagrams` already does locally. That server is a reasonable
fallback for diagrams outside the C4-PlantUML macro subset this skill covers, but the
two should not be conflated: prefer this renderer whenever the source is genuinely
C4-PlantUML.
