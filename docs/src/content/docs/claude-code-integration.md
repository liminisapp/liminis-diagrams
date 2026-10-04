---
title: Rendering diagrams in Claude Code
description: Get Claude to render real C4 diagrams through this library — as a Claude Code skill, or as an MCP tool for any MCP-connected client.
---

Claude's Artifacts support a fixed set of natively-rendered content — HTML, SVG,
Mermaid diagrams, React components, code — with no plugin mechanism to register a new
file extension or "artifact type" and hand it to a custom renderer. There is no
equivalent of a browser's MIME-type handler registry here. So a `.c4` (or any other
custom extension) file does not get intercepted and routed to this library
automatically the way, say, a `.md` file is.

What *is* available, and is what this integration uses, is that Claude reads plain SVG
natively. So the trick isn't getting Claude to recognize a new file type — it's getting
it to run this library's renderer *before* it builds an Artifact, and paste the
resulting `<svg>` markup directly into the page, instead of hand-drawing an
approximation of a C4 diagram or reaching for Mermaid's (partial, non-conforming) C4
support.

There are two ways to make that happen, and they compose — use either or both:

## 1. A Skill (what's shipped here)

[`integrations/claude-code/skills/render-c4-diagram/`](https://github.com/liminisapp/liminis-diagrams/blob/main/integrations/claude-code/skills/render-c4-diagram/)
is a ready-to-copy Claude Code skill. It tells Claude: when you see C4-PlantUML source
(a fenced ` ```c4 ` block, a `.puml` file, pasted text using `Person`/`System`/
`Container`/`Rel` macros), pipe it through
`npx --package=@liminis/diagrams --package=react --package=react-dom -- render-c4 --stdin` and embed the resulting SVG
rather than drawing your own.

Install it by copying the directory into a skills folder Claude Code loads from — either
project-local (`.claude/skills/render-c4-diagram/` in the repo you're working in) or
your personal one, so it applies across every project:

```bash
cp -r integrations/claude-code/skills/render-c4-diagram ~/.claude/skills/
```

This only works in Claude Code, which can execute shell commands (`npx`) — plain
Claude.ai or Claude Desktop chat without Code has no shell to invoke the CLI from, which
is what the MCP tool below is for.

## 2. An MCP tool

For Claude Desktop, Claude.ai, or any other MCP-connected client — not just Claude
Code — expose the renderer as an MCP tool instead of a shelled-out CLI. This library
already has a consumer doing exactly that: the doc comment on
[`renderC4DiagramToSVG`](https://github.com/liminisapp/liminis-diagrams/blob/main/src/server/render-to-string.ts) notes it's "used by the
`app_render_c4_diagram` MCP tool for Confluence publishing" in `@liminis/editor`. That
tool isn't part of this repo, but the shape is a small wrapper:

```ts
import { renderC4DiagramToSVG } from '@liminis/diagrams/server';

server.tool(
  'render_c4_diagram',
  { code: z.string(), isDarkMode: z.boolean().optional() },
  async ({ code, isDarkMode }) => {
    const { svg, errors } = renderC4DiagramToSVG(code, isDarkMode);
    if (errors.length > 0) {
      return { content: [{ type: 'text', text: JSON.stringify(errors) }], isError: true };
    }
    return { content: [{ type: 'text', text: svg }] };
  },
);
```

An MCP tool is the more portable option — it works anywhere the client is MCP-connected,
without a shell — and is the right choice if you want this to work outside Claude Code
specifically. The skill above is the lighter-weight option when you're already in
Claude Code and don't want to stand up and host an MCP server.

## Both point at the same CLI

Whichever path you take, the actual rendering goes through `render-c4`
(`@liminis/diagrams`'s bundled CLI — see
[the GitHub integration page](../github-integration/) for its full flag reference) or
the `renderC4DiagramToSVG` function it wraps. Neither the skill nor the MCP tool
reimplements any parsing or layout logic; they're both thin adapters onto the same
engine this package already ships.
