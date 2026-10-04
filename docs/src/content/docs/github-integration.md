---
title: Rendering diagrams on GitHub
description: Pre-render C4 diagrams to committed SVGs so github.com shows a picture, with a CI check that catches a stale one.
---

GitHub's markdown renderer shows `.svg` files and `<img>` references natively. It has
no extension point for rendering diagram source itself, and no "register a custom image
provider" hook — so there is no way to make it call this library when someone browses a
diagram in a repo.

What works instead — the same pattern people already use for Mermaid, Graphviz and
PlantUML — is **pre-rendering**: turn each diagram into a checked-in `.svg` as part of
CI, and reference that `.svg` from markdown. GitHub then just renders an image, which
it already knows how to do.

## Where diagrams actually live

Two shapes, and the CLI handles both. Which one you have matters, because the CI recipe
differs.

**Fenced blocks inside markdown** — a ` ```c4 ` fence in a `README.md` or a docs page.
This is the common case: it is how `@liminis/editor` stores diagrams, how this
package's own documentation is written, and what a markdown-based diagram wiki
produces. The prose and the diagram stay in one file, and the fence is readable on
GitHub even before anything is rendered.

**Standalone `.puml` files** — one diagram per file, referenced from markdown with an
`![...](./x.svg)` link.

`.puml` is the right extension for the standalone case, and not merely by convention:
this parser *skips* `@startuml`/`@enduml`, `!include`, `!define`, `SHOW_*`/`HIDE_*` and
`title` rather than rejecting them, so an ordinary
[C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML) file — includes and all —
renders here unmodified, and the same file still renders through PlantUML proper. You
get editor syntax highlighting and the existing ecosystem for free.

The compatibility is a subset, though. What is understood is the C4 macro vocabulary
(`Person`, `System`, `Container`, `Component`, `Rel`, the boundary forms) — see the
[C4-PlantUML reference](../dsl-reference/). A `.puml` file that is a
sequence diagram, or one leaning on `skinparam` and general PlantUML styling, is not
an error so much as not this tool's subject.

## The `render-c4` CLI

This package ships a small CLI for the rendering step. It wraps `renderC4DiagramToSVG` —
the same function `@liminis/diagrams/server` exports for programmatic use — so a
checked-in diagram renders with the same engine as anything you render in-app.

```bash
# Fences inside markdown. Each fence in page.md becomes page-1.svg, page-2.svg, …
npx --package=@liminis/diagrams --package=react --package=react-dom -- \
  render-c4 --from-markdown docs/architecture.md

# A standalone file.
npx --package=@liminis/diagrams --package=react --package=react-dom -- \
  render-c4 docs/architecture.puml
# docs/architecture.puml -> docs/architecture.svg

# Validate only — writes nothing, non-zero if anything fails to parse.
npx --package=@liminis/diagrams --package=react --package=react-dom -- \
  render-c4 --check $(git ls-files '*.puml')
```

`$(git ls-files …)` rather than a `**` glob: the CLI takes each argument as a
literal path and does not expand globs itself, and `**` is inert in bash unless
`globstar` is set — so `docs/**/*.puml` is liable to arrive as one nonexistent
filename and fail with `ENOENT`. Letting git do the expansion also skips
anything untracked or ignored, which is usually what you meant.

### Why react and react-dom are named on that command line

The renderer builds the SVG with `react-dom/server`. React is an **optional peer**
dependency, so that `./core` — parsing and layout — can be installed with no React
anywhere near it, which is the whole reason the package is split. Optional peers are
not installed automatically, so a bare
`npx --package=@liminis/diagrams -- render-c4 …` runs in an environment that has the
CLI but not what it renders with, and fails with `ERR_MODULE_NOT_FOUND: Cannot find
package 'react-dom'`. Naming all three packages puts them in the same temporary install.

**In a project that already depends on the package, none of this applies** — React is
already there, and the CLI is on your path:

```bash
pnpm add -D @liminis/diagrams react react-dom
pnpm render-c4 --from-markdown docs/architecture.md
```

That form is the better one for a repository that renders diagrams regularly: the
version is in your lockfile rather than resolved afresh on every CI run.

`--package=@liminis/diagrams --` is deliberate, not decoration: the package name
(`diagrams`) doesn't match its bin name (`render-c4`), so plain
`npx @liminis/diagrams render-c4 ...` already resolves to the package's sole bin before
`render-c4` is even read — the same way `npx @vue/cli create app` runs the `vue` bin,
not a command named `create`. The literal word `render-c4` then gets passed straight
through as this CLI's *first argument*, which is treated as a file path, producing an
immediate `ENOENT`. `--package=<name> -- <command>` names the package and the command
separately, so there is nothing left to misinterpret.

| Flag | Effect |
|---|---|
| `--from-markdown` | Read ` ```c4 ` fences out of markdown inputs instead of treating each whole file as source |
| `--dark` | Render in dark mode |
| `-o, --out <file>` | Output path (only valid with exactly one input file, and not with `--from-markdown`, which emits one file per fence) |
| `--out-dir <dir>` | Write outputs here, preserving basenames, extension replaced with `.svg` |
| `--check` | Validate only — write nothing, exit non-zero on any parse/validation error |
| `--stdin` | Read source from stdin, write SVG to stdout — no filesystem involved |

Exit code is `0` on success, `1` on a usage error, `2` if any input failed to render.
Errors print as `path:line:column: message`, one per line, so they read like a linter's
output in a CI log — and in `--from-markdown` mode the line is the line **in the
containing markdown file**, not in the fence, so the message is navigable.

A fence tagged `invalid` is skipped rather than failed. A page documenting parse errors
needs source that does not parse; that is content, not a defect.

If a glob resolves to zero files, that is success rather than a usage error — nothing to
render is not a mistake — so the recipe below does not fail on a repo that has no
diagrams yet.

## Wiring it into a GitHub Action

The check that matters is **not** "does the source parse". A diagram whose source parses
perfectly can still be committed alongside an SVG rendered from an older version of it,
and then the picture every reader sees on github.com is a lie that CI approved.

So check for **drift** instead: re-render, and fail if the working tree changed. A clean
tree then means every committed SVG is current.

That check only holds if the renderer is deterministic, which is worth being precise
about. Rendering is a pure function of the source **for a given version of the
package** — so pin the version in CI rather than letting `npx` resolve whatever is
latest, or the check turns red on the day a release changes any coordinate. Across
machines it is byte-identical from 0.1.2 onward; before that, `atan2` results differed
by one unit in the last place between macOS and Linux, and the check would pass or fail
depending on who last ran the renderer.

```yaml
# .github/workflows/render-diagrams.yml
name: render-diagrams

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      # Pinned, not floating: a release that changes any coordinate would
      # otherwise turn this check red on a pull request that touched nothing.
      - name: Re-render diagrams
        run: |
          npx --package=@liminis/diagrams@0.1.2 --package=react --package=react-dom -- \
            render-c4 --from-markdown $(git ls-files '*.md')
          npx --package=@liminis/diagrams@0.1.2 --package=react --package=react-dom -- \
            render-c4 $(git ls-files '*.puml')

      - name: Fail if any committed SVG is stale
        run: |
          git diff --exit-code -- '*.svg' \
            || { echo '::error::Diagrams are out of date. Re-render and commit the result.'; exit 1; }
```

`permissions: contents: read` is the whole grant this needs, and it is declared on the
job rather than the workflow so it cannot silently widen later.

Adjust the `git ls-files` globs to where your sources actually live.

### Why not commit the SVGs back automatically?

You can — render on push to `main`, commit the result, and never think about it. It is a
legitimate choice, and for a repo whose diagrams are edited by people who do not run the
tooling locally it may be the right one. The cost is worth stating plainly:

- It needs `contents: write` and a bot push on your default branch.
- The rendered output arrives in a commit *after* review, so nobody looked at it.
- `[skip ci]` in that commit message is load-bearing — without it the workflow retriggers
  itself.
- Every branch cut before the bot commit is now behind by a file nobody edited.

The drift check above pushes the work one step earlier instead: whoever changed the
diagram re-renders it and commits both in the same reviewable change. The picture and
the source move together, and `main` only ever gets commits a person made.

If you would rather not commit SVGs at all, render them as a build artifact and
reference their published location (GitHub Pages, say) from markdown instead of a
relative repo path. The CLI does not care; it only produces files on disk.

## What this site does

This documentation runs a variant worth knowing about, because it goes one step further:
[`docs/scripts/render-diagrams.mjs`](https://github.com/liminisapp/liminis-diagrams/blob/main/docs/scripts/render-diagrams.mjs)
renders each fence *and* maintains the `<img>` tag next to it, so nothing has to be
written by hand. On the docs site a remark plugin strips that `<img>` and replaces the
fence with a live, draggable island; on github.com there is no build step, so the
committed SVG is what a reader sees.

Same file, two renderings, one source. `pnpm diagrams --check` is the drift gate, and it
fails on an orphaned SVG too — a diagram you deleted should not leave its picture behind.
