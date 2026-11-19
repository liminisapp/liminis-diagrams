# Feature Specification: Replace ESLint with Oxlint (type-aware) and move to TypeScript 7

**Feature Branch**: `fabrik/issue-114`
**Created**: 2026-11-18
**Status**: Specified
**Input**: User description:

> ## Goal
>
> Replace ESLint and typescript-eslint with **Oxlint** (type-aware, via `oxlint-tsgolint`), and move the package to **TypeScript 7**. typescript-eslint is the only thing keeping diagrams on TypeScript 5.9. This is the same change as liminisapp/liminis-editor#209.
>
> ## Why
>
> - **typescript-eslint blocks TypeScript 7.** Its latest 8.x declares `typescript: >=4.8.4 <6.1.0`, and on TypeScript 7 ESLint crashes with *"typescript-eslint does not support TS 7.0"* (typescript-eslint/typescript-eslint#10940). This is why Dependabot's TypeScript bump (#72) can't land.
> - **Oxlint's type-aware mode is now stable** ([announcement, 2026-07-22](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable)). tsgolint v7 is built on TypeScript 7 (it tracks 7.0.2) and covers 59 of typescript-eslint's 61 type-aware rules.
>
> ## Evidence from a local trial (2026-11-18, nothing committed)
>
> I ran a throwaway worktree of `main` at `436f7b1` (0.2.2) with Oxlint 1.94.0 and `oxlint-tsgolint` 7.0.2007. Both were installed in a separate tools directory, so the repo lockfile wasn't touched.
>
> - **Config conversion.** `npx @oxlint/migrate --type-aware --with-nursery --details eslint.config.js` wrote a `.oxlintrc.json` with **128 rules**. It carried over `no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports`, including their messages. It skipped 5 rules, which are the same 5 the editor saw:
>   - `no-restricted-syntax`: not implemented in Oxlint. This is the only one that matters.
>   - `no-dupe-args` and `no-octal`: strict mode already covers them.
>   - `react-hooks/config` and `react-hooks/gating`: these are React Compiler options, which Oxlint fixes.
> - **Findings on `src/`.** Tests live alongside the source, so `src/` is the whole lint surface.
>   - ESLint reports 2 warnings: `react-refresh/only-export-components` at `src/react/renderer.tsx:416` and `:1004`.
>   - `oxlint --type-aware` reports the same 2 warnings, plus **one finding ESLint doesn't report**: `typescript(prefer-optional-chain)` at `src/react/C4InteractiveRenderer.tsx:1462`, an error. The code is `editing !== null && editing.menu === null && …`. typescript-eslint leaves comparisons with `=== null` alone. tsgolint's port flags it.
>   - That one finding needs a decision: rewrite the line, or relax the rule there. Don't leave the baseline red.
>   - Timing: Oxlint took about 0.5 s, ESLint about 4.5 s.
> - **Rule probe.** I ran a file seeded with known bugs through both linters. They agreed on all of these:
>   - floating promises, both local and imported
>   - a promise used in a conditional, and an async `forEach` callback (`no-misused-promises`)
>   - an unnecessary `as number` and an unnecessary `!` (`no-unnecessary-type-assertion`)
>   - `confirm()` (`no-restricted-globals`) and `window.alert` (`no-restricted-properties`), with their custom messages
>
>   The one miss: `(window as unknown as { api: unknown }).api`. ESLint reports it through `no-restricted-syntax`; Oxlint has nothing for it.
> - **TypeScript 7.0.2 in the trial worktree:**
>   - typecheck: 0 errors, under 0.4 s
>   - `build` (`tsc` plus `tsc-alias`): passes
>   - `pnpm test`: 723 passed
>   - `verify:package`: all checks pass
>   - `oxlint --type-aware`: unchanged
>   - ESLint: crashes as described above
> - **Emitted package.** `dist/` built on TypeScript 7 matches the published 0.2.2 tarball byte for byte: **every `.d.ts` file is identical**. The only difference is the order of one import specifier in `dist/react/renderer.js`. Consumers on TypeScript 5 or 6 are therefore unaffected.
> - **Demo and docs.** Both have their own lockfiles. `demo/` builds on its current TypeScript `^5.9.3`, and also with `typescript@7.0.2` (`tsc -b && vite build`). `docs/` (Astro) has no TypeScript dependency of its own and builds cleanly.
> - **Biome was not re-tested here.** The editor rejected it in #209: it misses `n as number`, and every `no-restricted-*` rule would need a GritQL plugin.
>
> ## Scope
>
> 1. **Dependencies**
>    - Remove `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` and `globals`, if `globals` is used only by the ESLint config.
>    - Add `oxlint` and `oxlint-tsgolint`.
>    - Bump `typescript` to `^7.0.2`, which supersedes #72; close it.
>    - Bump `demo/`'s `typescript` to `^7.0.2` as well, so the repo is on one major. It builds there.
> 2. **Config**
>    - Add `.oxlintrc.json`, generated with `@oxlint/migrate` and then reviewed, with `options.typeAware: true`.
>    - Keep the `src/**` scoping and the `ignores` equivalent to today's: `dist`, `coverage`, `examples`, `demo`, `scripts`, and the config files.
>    - Delete `eslint.config.js`.
>    - The `// eslint-disable-next-line no-control-regex` in `src/core/edit.ts` must still suppress that rule. Oxlint honours `eslint-disable` comments; confirm it does here.
> 3. **Scripts**
>    - `lint`: `oxlint --type-aware src/`. `lint:fix`: the same with `--fix`.
>    - `ci.yml` and `publish.yml` already call `pnpm lint`. Verify that the publish job's lint step works with the Oxlint binary under the pinned Node 24 and npm 12.0.2.
> 4. **`no-restricted-syntax` (the host-boundary guard) must keep working.** ESLint currently enforces three selectors that stop the package from reaching into a host via `window.api` or `globalThis.api`:
>    - the dotted and optional forms
>    - the computed `['api']` form
>    - the `(window as …).api` cast
>
>    Use the same approach the editor settles on in #209. That is preferably a small Oxlint JS plugin (`jsPlugins`) kept in the repo, which reports the same three patterns with the same messages. Do not drop the guard silently. Add a fixture or probe that proves each of the three patterns still fails lint.
>
>    While porting, fix the messages for this package. The guard messages and the `no-restricted-imports` message still say `@liminis/editor` and point at `EditorHostServices` and ADR-075, which were carried over from the editor and don't exist here.
> 5. **Dependabot**
>    - Group `oxlint`, `oxlint-tsgolint` and `typescript` so they move together, because tsgolint tracks a specific TypeScript release.
>    - Remove anything that exists only for ESLint packages.
> 6. **Docs**
>    - Record the decision in an ADR, `adrs/<this issue number>-oxlint-and-typescript-7.md`. Cover the `no-restricted-syntax` approach and the extra `prefer-optional-chain` finding.
>    - Update any text that names ESLint as the linter. `pages.yml`'s comment says "lint"; check that it still reads correctly.
>    - This is a dev-only change with no consumer-facing effect. TypeScript is a devDependency, the peer range is unchanged, and the `.d.ts` output is identical.
>
> ## Acceptance criteria
>
> - `pnpm lint` runs Oxlint type-aware and reports nothing beyond today's ESLint baseline of 2 `only-export-components` warnings. The `prefer-optional-chain` finding is resolved one way or the other.
> - The rule probe above fails lint under the new setup: floating and misused promises, unnecessary assertions, `confirm()` and `window.alert`.
> - Each of the three `window.api` patterns fails lint with its message.
> - `typescript` is `^7.0.2`, at the root and in `demo/`. Typecheck, build, test and `verify:package` pass, the demo and docs builds pass, and all CI jobs are green.
> - No ESLint packages or config remain.
> - The published package is unchanged in content. `verify:package` passes, and the emitted `.d.ts` files still type-check for a consumer on TypeScript 5.9 or 6.
>
> ## Out of scope
>
> - Biome adoption.
> - Any change to the package's runtime code beyond what the lint baseline needs (the `prefer-optional-chain` line).

## Background

`typescript-eslint` is the only thing holding this package on TypeScript 5.9. Its latest 8.x supports `typescript >=4.8.4 <6.1.0`, and on TypeScript 7 ESLint crashes with "typescript-eslint does not support TS 7.0" (typescript-eslint/typescript-eslint#10940). That is why Dependabot's TypeScript bump (#72) cannot land. Oxlint's type-aware mode went stable on 2026-07-22 (tsgolint v7, built on TypeScript 7, covering 59 of typescript-eslint's 61 type-aware rules), so the linter can be replaced and TypeScript upgraded together. This is the same change as liminisapp/liminis-editor#209.

A local trial on 2026-11-18 (nothing committed; `main` at `436f7b1`, Oxlint 1.94.0, `oxlint-tsgolint` 7.0.2007) found:

- **Config migration works for almost everything.** `@oxlint/migrate` produced 128 rules, including the `no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports` rules with their messages. Five rules were skipped. Three need no action: `no-dupe-args` and `no-octal` (covered by strict mode) and `react-hooks/config` and `react-hooks/gating` (React Compiler options that Oxlint fixes). `no-restricted-syntax` is not implemented in Oxlint and is the one that matters.
- **Baseline.** ESLint reports 2 `react-refresh/only-export-components` warnings in `src/react/renderer.tsx`. Oxlint reports the same 2, plus one error ESLint does not: `typescript(prefer-optional-chain)` at `src/react/C4InteractiveRenderer.tsx:1462` (`editing !== null && editing.menu === null && …`). Oxlint is also faster (about 0.5 s vs 4.5 s).
- **Rule parity.** A seeded-bug probe showed both linters agree on floating promises, misused promises, unnecessary type assertions, `confirm()` and `window.alert`. The only miss is the `(window as unknown as { api: unknown }).api` cast, which ESLint catches through `no-restricted-syntax`.
- **TypeScript 7.0.2 is safe for the package.** Typecheck, build, tests (723) and `verify:package` pass. The emitted `.d.ts` files are byte-identical to the published 0.2.2 tarball, so consumers on TypeScript 5 or 6 are unaffected. `demo/` builds on both `^5.9.3` and 7.0.2. `docs/` has no TypeScript dependency and builds.
- Biome was rejected by the editor in #209 (it misses `n as number`, and every `no-restricted-*` rule would need a GritQL plugin) and is not reconsidered here.

The `no-restricted-syntax` rules are a host-boundary guard: they stop the package from reaching into a host application through `window.api` / `globalThis.api`. Dropping them silently would remove a real architectural protection.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lint with Oxlint, on TypeScript 7 (Priority: P1)

A maintainer runs `pnpm lint` and gets type-aware linting from Oxlint, with the same signal as today's ESLint run (2 known warnings, no errors). The repo is on TypeScript `^7.0.2`, so Dependabot's TypeScript bump is no longer blocked.

**Why this priority**: This is the core of the change and unblocks TypeScript 7 for the whole repo.

**Independent Test**: On a clean checkout of the branch, run `pnpm install`, `pnpm lint`, typecheck, build, `pnpm test` and `verify:package`; all succeed, with lint reporting only the 2 `only-export-components` warnings.

**Acceptance Scenarios**:

1. **Given** the branch is installed, **When** `pnpm lint` runs, **Then** Oxlint runs in type-aware mode over `src/` and exits 0 with only the 2 known `react-refresh/only-export-components` warnings.
2. **Given** a file seeded with a floating promise, a promise in a conditional, an async `forEach` callback, an unnecessary `as number`, an unnecessary `!`, a `confirm()` call and a `window.alert` call, **When** lint runs, **Then** each is reported, and the `confirm()` / `window.alert` reports carry their custom messages.
3. **Given** `src/core/edit.ts` contains `// eslint-disable-next-line no-control-regex`, **When** lint runs, **Then** that line is still suppressed and no `no-control-regex` finding appears.
4. **Given** the lint surface, **When** lint runs, **Then** `dist`, `coverage`, `examples`, `demo`, `scripts` and the config files are still excluded, and `src/**` is still the scope.

---

### User Story 2 - Host-boundary guard keeps working (Priority: P1)

A contributor who writes code that reaches into the host through `window.api` or `globalThis.api` gets a lint failure, exactly as with ESLint today, with a message that makes sense for this package.

**Why this priority**: Without this the migration silently removes an architectural guard, so it must land in the same change.

**Independent Test**: Run lint against a fixture or probe containing each of the three patterns; each produces a failure with its message. A fixture with benign code produces none.

**Acceptance Scenarios**:

1. **Given** code using `window.api.x` or `globalThis.api?.x`, **When** lint runs, **Then** it fails with the guard message.
2. **Given** code using the computed form `window['api']` / `globalThis['api']`, **When** lint runs, **Then** it fails with the guard message.
3. **Given** code using the cast form `(window as unknown as { api: unknown }).api`, **When** lint runs, **Then** it fails with the guard message.
4. **Given** the guard and `no-restricted-imports` messages, **When** a developer reads them, **Then** they refer to this package (`@liminis/diagrams`) and contain no references to `@liminis/editor`, `EditorHostServices` or ADR-075.

---

### User Story 3 - Dependency, CI and Dependabot hygiene (Priority: P2)

The repository carries no ESLint leftovers, CI and publish pipelines run Oxlint successfully, and Dependabot upgrades the linter and TypeScript together.

**Why this priority**: Required for a complete migration, but it follows once the lint and guard behaviour is in place.

**Independent Test**: Search the repo for ESLint packages and config; run CI and confirm the publish job's lint step passes under the pinned Node 24 / npm 12.0.2.

**Acceptance Scenarios**:

1. **Given** the branch, **When** `package.json`, lockfiles and config are inspected, **Then** `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` and `eslint.config.js` are gone, and `globals` is gone if it was used only by the ESLint config.
2. **Given** `typescript` is bumped, **When** the root and `demo/` manifests are inspected, **Then** both declare `^7.0.2`.
3. **Given** the Dependabot config, **When** a new `oxlint`, `oxlint-tsgolint` or `typescript` release appears, **Then** they are grouped in one update PR, and no ESLint-only entries remain.
4. **Given** the CI and publish workflows, **When** they run, **Then** all jobs, including the publish job's lint step, pass, and the demo and docs builds pass.

---

### User Story 4 - Decision recorded and docs accurate (Priority: P3)

A future maintainer can find why the repo uses Oxlint, how the host-boundary guard is enforced, and why the extra `prefer-optional-chain` finding was handled as it was.

**Why this priority**: Documentation does not change behaviour but preserves the rationale.

**Independent Test**: Read `adrs/114-oxlint-and-typescript-7.md` and grep the docs and workflow comments for stale ESLint references.

**Acceptance Scenarios**:

1. **Given** the ADR, **When** read, **Then** it is titled `# ADR-114: …`, and covers the choice of Oxlint and TypeScript 7, the `no-restricted-syntax` replacement approach, and the `prefer-optional-chain` resolution.
2. **Given** text anywhere in the repo that names ESLint as the linter, **When** the change is complete, **Then** it names Oxlint instead, and `pages.yml`'s "lint" comment still reads correctly.

---

### Edge Cases

- The `prefer-optional-chain` finding at `src/react/C4InteractiveRenderer.tsx:1462` is an error under Oxlint and must not leave the baseline red. Whichever resolution is chosen must keep behaviour identical.
- `globals` may be used by something other than the ESLint config; it is removed only if it is not.
- Oxlint's handling of `eslint-disable` comments for rules not present in its rule set (for example `no-control-regex`) must be verified, not assumed.
- The guard must not flag legitimate uses unrelated to `window` / `globalThis` (for example other objects with an `api` property).
- Tests live alongside the source in `src/`, so test files are in the lint surface and must also pass.
- The publish job runs under pinned Node 24 and npm 12.0.2; the Oxlint and tsgolint binaries must install and run there (including their platform-specific optional packages).
- `demo/` and `docs/` have their own lockfiles; the `demo/` lockfile must be updated for TypeScript 7, and `docs/` must continue to build.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `pnpm lint` MUST run Oxlint in type-aware mode (via `oxlint-tsgolint`) over `src/`, and `pnpm lint:fix` MUST do the same with fixing enabled.
- **FR-002**: `pnpm lint` MUST exit successfully on the branch and report nothing beyond the 2 existing `react-refresh/only-export-components` warnings.
- **FR-003**: A reviewed `.oxlintrc.json` (generated from the existing ESLint config with `@oxlint/migrate`, then checked by hand) MUST be added with type-aware linting enabled, and `eslint.config.js` MUST be deleted.
- **FR-004**: The lint scope MUST remain `src/**`, excluding the equivalents of today's ignores: `dist`, `coverage`, `examples`, `demo`, `scripts` and the config files.
- **FR-005**: The migrated `no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports` rules MUST remain active, with their messages corrected for this package.
- **FR-006**: The existing `// eslint-disable-next-line no-control-regex` in `src/core/edit.ts` MUST still suppress that rule under Oxlint, confirmed by running lint.
- **FR-007**: The host-boundary guard MUST be preserved: lint MUST fail on (a) dotted and optional-chained `window.api` / `globalThis.api` access, (b) computed `['api']` access, and (c) the `(window as …).api` cast form, each with a guard message.
- **FR-008**: The guard's implementation MUST be kept in the repo, following the approach settled in liminis-editor#209 (preferably a small Oxlint JS plugin registered through `jsPlugins`), and MUST NOT be dropped silently.
- **FR-009**: A fixture or probe committed to the repo MUST demonstrate that each of the three guard patterns fails lint, and that it is exercised by an automated check (not only by hand).
- **FR-010**: The guard messages and the `no-restricted-imports` message MUST be rewritten for this package, removing references to `@liminis/editor`, `EditorHostServices` and ADR-075.
- **FR-011**: The `typescript-eslint` `prefer-optional-chain` error at `src/react/C4InteractiveRenderer.tsx:1462` MUST be resolved, either by rewriting the expression with no behaviour change or by relaxing the rule narrowly at that location with a stated reason. The rule MUST NOT be disabled repo-wide.
- **FR-012**: The rule-probe categories (floating promises, misused promises, unnecessary type assertions, `confirm()`, `window.alert`) MUST be reported by lint under the new setup.
- **FR-013**: `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` and `eslint.config.js` MUST be removed; `globals` MUST be removed unless something other than the ESLint config uses it. `oxlint` and `oxlint-tsgolint` MUST be added as devDependencies.
- **FR-014**: `typescript` MUST be `^7.0.2` in the root `package.json` and in `demo/package.json`, with lockfiles updated; Dependabot PR #72 MUST be closed as superseded.
- **FR-015**: Typecheck, build (`tsc` plus `tsc-alias`), the test suite, `verify:package`, the `demo/` build and the `docs/` build MUST all pass.
- **FR-016**: The emitted `.d.ts` files MUST remain identical to the published 0.2.2 output and MUST still type-check for a consumer on TypeScript 5.9 or 6. The package's peer-dependency ranges MUST be unchanged.
- **FR-017**: `ci.yml` and `publish.yml` MUST continue to call `pnpm lint`, and the lint step MUST pass in the publish job under the pinned Node 24 and npm 12.0.2.
- **FR-018**: The Dependabot config MUST group `oxlint`, `oxlint-tsgolint` and `typescript` so they update together, and MUST drop any entries that exist only for ESLint packages.
- **FR-019**: An ADR MUST be added at `adrs/114-oxlint-and-typescript-7.md`, headed `# ADR-114: …` (issue-number naming per CLAUDE.md), recording the decision, the `no-restricted-syntax` replacement approach and the `prefer-optional-chain` finding and its resolution.
- **FR-020**: All text that names ESLint as the project's linter (docs, README, contributor guidance, workflow comments) MUST be updated, and `pages.yml`'s "lint" comment MUST be checked for accuracy.
- **FR-021**: No runtime source change is made beyond what is needed to satisfy FR-011.

### Key Entities *(if applicable)*

- **Host-boundary guard**: The set of lint rules that prevent the package from reaching into a host application via `window.api` / `globalThis.api` (three syntactic forms).
- **Lint baseline**: The accepted result of linting `src/`: 2 `react-refresh/only-export-components` warnings, no errors.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm lint` exits 0 with exactly the 2 baseline warnings and no errors.
- **SC-002**: Each of the 3 host-boundary patterns and each of the 5 rule-probe categories fails lint when present in a fixture, and an automated check verifies this.
- **SC-003**: `typescript` resolves to a 7.x version at both the root and `demo/`, and no ESLint package or config file remains in the repo.
- **SC-004**: Typecheck, build, tests (currently 723 passing), `verify:package`, the demo build, the docs build and all CI jobs pass.
- **SC-005**: The built `.d.ts` files are byte-identical to the published 0.2.2 tarball's, and compile for a TypeScript 5.9 and a TypeScript 6 consumer.
- **SC-006**: Full-repo lint time is no worse than today's ESLint run (about 4.5 s locally; the trial measured about 0.5 s).
- **SC-007**: Dependabot proposes `oxlint`, `oxlint-tsgolint` and `typescript` upgrades in a single grouped PR.

## Assumptions

- The guard will be implemented as a small in-repo Oxlint JS plugin, following whatever liminis-editor#209 settles on. If #209 settles on a different mechanism, this issue follows it so the two repos stay aligned.
- For the `prefer-optional-chain` finding, rewriting the single line to the optional-chain form is preferred. A narrowly scoped suppression with a comment is acceptable if the rewrite would change semantics or readability. Either way, behaviour must not change.
- Oxlint and `oxlint-tsgolint` are pinned to versions compatible with TypeScript 7.0.x (tsgolint tracks 7.0.2); exact versions are chosen at implementation time.
- The trial results (Oxlint 1.94.0, tsgolint 7.0.2007, TypeScript 7.0.2) hold on the actual branch; any divergence is reported, not worked around silently.
- `@oxlint/migrate` is a one-time generation tool, not a permanent dependency.
- This is a dev-only change with no consumer-facing effect and needs no changelog entry or version bump beyond the normal release process.

## Out of Scope *(optional)*

- Biome adoption.
- Any change to package runtime code beyond the single `prefer-optional-chain` line.
- Changes to the package's peer-dependency ranges or published API.
- Upgrading `docs/`'s dependencies (it has no TypeScript dependency of its own).

## Source References *(optional)*

- Oxlint type-aware linting stable announcement (2026-07-22): https://oxc.rs/blog/2026-07-22-type-aware-linting-stable
- typescript-eslint TypeScript 7 support issue: typescript-eslint/typescript-eslint#10940
- Sibling change in the editor repo: liminisapp/liminis-editor#209
- Dependabot TypeScript bump superseded by this issue: #72
- Repo ADR naming rule: `CLAUDE.md` ("ADR numbers are issue numbers")
