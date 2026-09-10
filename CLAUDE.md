# Claude Code guidance for liminis-diagrams

## ADR numbers are issue numbers (NON-NEGOTIABLE)

There are no ADRs in this repo yet. When the first one is written it goes in
`adrs/<issue_number>-<slug>.md` — the **GitHub issue number that motivated the
decision** — with the heading `# ADR-<issue_number>: Title`. Never "the next
free number".

**Why fix this before there is anything to fix.** Sequential numbering allocates
at *write* time, when two branches cannot see each other, so it collides
whenever two issues are in flight — and **the collision is invisible to git**:
the files have different slugs, so both apply cleanly and nothing conflicts
except the index. It surfaces only when the second branch merges, by which point
both have been reviewed and approved. A Fabrik stage that hits it fails,
retries, fails again, exhausts its attempts and pauses, because rebasing and
renumbering is outside any stage's scope.

Every sibling repo that started sequential has paid for it:

- `liminis-editor` — issues #79 and #84 both produced `adr-091.md` (2026-08-19)
- `liminis-context-graph` — #279 and #281 both claimed `0051`
- `fantasy` — 33 duplicated numbers accumulated before the rule was adopted
- `concept-maps` — three collisions in two days

Issue numbers are unique by construction, so the collision cannot occur.

If a single issue genuinely needs two ADRs, suffix them (`0030-a-...`,
`0030-b-...`).

This mirrors the spec convention used across the Liminis repos,
`specs/<issue>-<slug>/`.
