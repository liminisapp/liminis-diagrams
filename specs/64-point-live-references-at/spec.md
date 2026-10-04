# Feature Specification: Point live references at liminisapp and docs.liminis.app after the org move

**Feature Branch**: `fabrik/issue-64`
**Created**: 2026-10-04
**Status**: Specified
**Input**: User description: "This repository moved from `verveguy/liminis-diagrams` to `liminisapp/liminis-diagrams` on 2026-10-04, and its docs moved from `v3rv.com/liminis-diagrams/` to `https://docs.liminis.app/liminis-diagrams/`. Old URLs redirect, but live references should point at the new homes."

## Background

The repository moved to the `liminisapp` GitHub organisation, and the documentation site moved from the `v3rv.com` user-site domain to `https://docs.liminis.app/liminis-diagrams/`. GitHub and the old domain redirect, so nothing is broken for readers today. Two things still need fixing:

- **Publishing will fail.** `npm publish --provenance` checks the `repository` field in `package.json` against the repository the workflow ran in. Until the field names `liminisapp/liminis-diagrams`, the next release fails. `scripts/verify-package.mjs` also hard-codes the old repo URL and rejects the new one.
- **Live references are stale.** Package metadata, docs-site config, README and doc links, CLI help text and generator scripts still advertise the old locations. Relying on redirects indefinitely is fragile, and the old URLs are what new users copy.

Historical records (ADRs, release notes, changelogs, specs, issue/PR links) correctly describe where things were at the time and must not be rewritten.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The next release publishes (Priority: P1)

A maintainer cuts a release and the provenance-enabled publish succeeds.

**Why this priority**: This is the only change with a functional consequence. Without it, releases are blocked.

**Independent Test**: Run `node scripts/verify-package.mjs`; it passes with the updated `package.json`. Then check that `repository.url` equals `git+https://github.com/liminisapp/liminis-diagrams.git`.

**Acceptance Scenarios**:

1. **Given** `package.json` points at `liminisapp/liminis-diagrams`, **When** `node scripts/verify-package.mjs` runs, **Then** it passes.
2. **Given** `package.json` still points at `verveguy/liminis-diagrams`, **When** `verify-package.mjs` runs, **Then** it fails (the check enforces the new owner, not the old).
3. **Given** a `repository.url` ending in `liminisapp/liminis-diagrams-fork`, **When** `verify-package.mjs` runs, **Then** it still fails (the exact-match behaviour is preserved).

---

### User Story 2 - Readers land on the new docs and repo (Priority: P2)

A reader of the README, the docs site, the CLI help or the Claude Code skill follows a link and goes straight to `docs.liminis.app` or `github.com/liminisapp/...`, with no redirect.

**Why this priority**: User-visible correctness, but redirects keep the old links working in the meantime.

**Independent Test**: Build the docs site and search the built HTML. Run the `git grep` from the success criteria.

**Acceptance Scenarios**:

1. **Given** the docs are built, **When** the output HTML is searched, **Then** it contains no `v3rv.com/liminis-diagrams` and no `github.com/verveguy/liminis-diagrams` outside historical pages.
2. **Given** the docs are built, **When** the site config is inspected, **Then** `site` is `https://docs.liminis.app` and `base` is still `/liminis-diagrams`, so pages resolve under `https://docs.liminis.app/liminis-diagrams/`.
3. **Given** a docs page, **When** the "Edit page" link and the GitHub social link are followed, **Then** both target `github.com/liminisapp/liminis-diagrams`.

---

### Edge Cases

- `github.com/verveguy/liminis-diagrams/issues/NNN` (and PR/discussion) links stay as they are.
- The private app repo `verveguy/liminis`, and sibling repos such as `verveguy/liminis-editor`, are different repositories and are not touched.
- `.github/workflows/**` contains historical comments and a user reference (`--assignee verveguy`). Nothing there is edited.
- Existing specs under `specs/**` that cite `v3rv.com/liminis-diagrams` are historical and unchanged.
- `scripts/bootstrap-npm-name.sh` has `GH_OWNER`, which is a repo owner and moves to `liminisapp`. Any literal `verveguy` that names a user rather than the repo owner stays.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `package.json` MUST set `repository.url` to `git+https://github.com/liminisapp/liminis-diagrams.git`, and `homepage` and `bugs.url` to the `liminisapp` equivalents.
- **FR-002**: `scripts/verify-package.mjs` MUST update `EXPECTED_REPO_URL`, the exact-match repository check (and its failure message) and the explanatory comment to `github.com/liminisapp/liminis-diagrams`. The match MUST remain exact, not a substring.
- **FR-003**: `scripts/bootstrap-npm-name.sh` MUST set `REPO_URL` and `GH_OWNER` to `liminisapp`.
- **FR-004**: `docs/astro.config.mjs` MUST set `site` to `https://docs.liminis.app`, point the GitHub social link and `editLink.baseUrl` at `liminisapp`, and update the comment about the user site so it no longer claims the site resolves under `v3rv.com`.
- **FR-005**: `docs/astro.config.mjs` MUST keep `base` as `/liminis-diagrams`. Only the host changes.
- **FR-006**: `README.md`, `docs/src/content/docs/**`, `integrations/claude-code/skills/render-c4-diagram/SKILL.md` and `src/bin/render-c4.ts` MUST replace `v3rv.com/liminis-diagrams/…` with `docs.liminis.app/liminis-diagrams/…`. They MUST replace non-issue `github.com/verveguy/liminis-diagrams/…` links with `liminisapp`.
- **FR-007**: Historical references MUST NOT change: ADRs, `docs/releases/**`, `CHANGELOG*`, history and spike docs, specs, test-fixture READMEs, and issue/PR/discussion links.
- **FR-008**: Nothing under `.github/workflows/` MUST be edited.
- **FR-009**: References to `verveguy/liminis` (the private app repo) MUST remain unchanged, as must references to other repos (e.g. `verveguy/liminis-editor`).

### Key Entities

- **Live reference**: A URL or identifier that users, tooling or npm act on today (package metadata, site config, links, install commands, CLI help, generator scripts).
- **Historical reference**: A URL in a document that records past state and is intentionally frozen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `node scripts/verify-package.mjs` passes.
- **SC-002**: The docs site builds, and its built HTML contains no `v3rv.com/liminis-diagrams` and no `github.com/verveguy/liminis-diagrams` outside historical pages.
- **SC-003**: `git grep -nE 'v3rv\.com/liminis-diagrams|github\.com/verveguy/liminis-diagrams'` lists only historical references.
- **SC-004**: `git diff` shows no changes under `.github/workflows/`, `docs/releases/`, `specs/` (other than this spec), or any `CHANGELOG*`.

## Assumptions

- Redirects from the old URLs remain in place, so historical links keep working.
- `https://docs.liminis.app/liminis-diagrams/` is already serving the docs, so no deployment change belongs to this issue.
- The `v3rv.com` host is not used elsewhere in this repo's live references besides those listed in the issue (the docs-site `site` value is the only host-level config).
- The release workflow's publish identity is already registered for `liminisapp/liminis-diagrams`. Registering the npm trusted publisher is outside this change.

## Out of Scope

- Edits to `.github/workflows/**`.
- Rewriting ADRs, release notes, changelogs, specs, history/spike docs, test-fixture READMEs, or issue/PR/discussion links.
- References to `verveguy/liminis` and `verveguy/liminis-editor`.
- Changing the docs `base` path or any docs-hosting or DNS configuration.
- Cutting a release.

## Source References

- Issue #64
- `package.json`, `scripts/verify-package.mjs`, `scripts/bootstrap-npm-name.sh`
- `docs/astro.config.mjs`, `docs/src/content/docs/**`, `README.md`
- `integrations/claude-code/skills/render-c4-diagram/SKILL.md`, `src/bin/render-c4.ts`
