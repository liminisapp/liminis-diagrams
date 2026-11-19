# ADR-114: Replace ESLint with Oxlint and move to TypeScript 7

**Status**: Accepted
**Issue**: #114 — Replace ESLint with Oxlint (type-aware) and move to TypeScript 7
**Supersedes**: Dependabot PR #72 (the TypeScript bump this unblocks)
**Sibling**: liminisapp/liminis-editor#209 (the same change in the editor)

## Context

`typescript-eslint` was the only thing holding the package on TypeScript 5.9. Its latest 8.x
declares `typescript: >=4.8.4 <6.1.0`, and on TypeScript 7 ESLint crashes with "typescript-eslint
does not support TS 7.0" (typescript-eslint/typescript-eslint#10940). That is why #72 could not
land.

Oxlint's type-aware mode went stable on 2026-07-22. `oxlint-tsgolint` v7 is built on TypeScript 7
(it tracks 7.0.2) and covers 59 of typescript-eslint's 61 type-aware rules, so the linter and the
compiler can move together.

## Decision

1. **Oxlint, type-aware, replaces ESLint.** `lint` is `oxlint --type-aware src/`; `lint:fix` adds
   `--fix`. `.oxlintrc.json` was generated once with `@oxlint/migrate --type-aware
   --with-nursery` and reviewed by hand; the migrator is not a dependency. `eslint`,
   `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
   and `globals` are removed (`react-hooks` and `react-refresh` rules are built into Oxlint's
   `react` plugin). Rules sit at the top level of the config rather than under a `src/**`
   override: scope comes from passing `src/` to the script, and the fixtures below then see the
   same rules as real code.
2. **TypeScript `^7.0.2`**, at the root and in `demo/`, so the repo is on one major. TypeScript is
   a devDependency; the peer ranges are unchanged. A build on TypeScript 7 emits `.d.ts` files
   byte-identical to the published 0.2.2 tarball (the only `.js` differences are the one-line
   rewrite below and an import-specifier order in `dist/react/renderer.js`), and those declarations
   compile, without `skipLibCheck`, for a TypeScript 5.9 and a TypeScript 6 consumer. There is no
   consumer-facing effect.
3. **Dependabot groups `oxlint`, `oxlint-tsgolint` and `typescript`** as `oxlint-toolchain`, ahead
   of the non-major and `majors` groups (a dependency joins the first group it matches), with no
   `update-types` so majors land in it. tsgolint tracks a specific TypeScript release, so the
   three must move together.
4. **Biome was not adopted.** The editor rejected it in #209: it misses `n as number`, and every
   `no-restricted-*` rule would need a GritQL plugin.

### The host-boundary guard (`no-restricted-syntax`)

Oxlint does not implement `no-restricted-syntax`, which ESLint used for the guard that stops the
package reaching into its host through `window.api` / `globalThis.api`. Dropping it silently would
remove a real architectural protection, so the guard is an in-repo Oxlint JS plugin,
`scripts/oxlint/host-boundary-plugin.mjs`, registered through `jsPlugins`. It has three rules, one
per pattern, each with its own message so a regression in one cannot hide behind the others:

| Rule | Reports |
|---|---|
| `host-boundary/no-window-api` | `window.api`, `window?.api`, `globalThis.api` |
| `host-boundary/no-window-computed-api` | `window['api']`, `window?.['api']` |
| `host-boundary/no-window-cast-api` | `(window as X).api`, `(window as unknown as X).api`, and the computed spelling |

The rules are plain `MemberExpression` visitors, not selector strings, so they depend only on
ESTree node shapes and not on the alpha selector engine. The cast rule is anchored to the cast
*operand* being `window`/`globalThis`, so `(someService as unknown as { api: Client }).api` is not
flagged; it peels `as`, `<T>x`, `!` and `satisfies` wrappers rather than only two `as` levels. The
plugin needs no type information, so it runs happily next to `--type-aware`.

The messages and the `no-restricted-imports` message were carried over from the editor and named
`@liminis/editor`, `EditorHostServices` and ADR-075, none of which exist here. They now say that
`@liminis/diagrams` must not reach into its host and that the capability should arrive through a
component prop or an option (the pattern of ADR-107's host-owned context menu).

### Proof that it keeps working

`scripts/oxlint/lint-guard.test.mjs` runs the real `oxlint` binary, type-aware, over committed
fixtures in `scripts/oxlint/fixtures/` and asserts rule, line and message. It covers every guard
spelling, benign look-alikes (zero findings), the rule-probe categories (floating promises local
and imported, a promise in a conditional, an async `forEach` callback, unnecessary `as` and `!`,
`confirm()` and `window.alert` with their custom messages), and the `eslint-disable-next-line
no-control-regex` directive in `src/core/edit.ts` (suppressed, with a control fixture proving the
rule is live). End to end is deliberate: a `RuleTester` alone would not notice a plugin that
silently stopped loading, which is exactly the failure that would report nothing. Removing the
plugin from the config fails five of its tests.

The fixtures live under `scripts/`, outside the lint scope, because they must fail lint. They are
linted through `scripts/oxlint/fixtures/.oxlintrc.json`, which extends the root config and empties
`ignorePatterns`: `--no-ignore` does not bypass a config's own `ignorePatterns`.

### The extra `prefer-optional-chain` finding

tsgolint's port of `prefer-optional-chain` flags `editing !== null && editing.menu === null && …`
at `src/react/C4InteractiveRenderer.tsx`, which typescript-eslint leaves alone because it ignores
comparisons with `=== null`. It was resolved by rewriting the line to `editing?.menu === null && …`
rather than suppressing the rule. `editing` is `EditingProps | null`, never `undefined`, so a null
`editing` gives `undefined === null`, which is false: the same result as before, and TypeScript
still narrows `editing` for the `&&` tail. The rule stays on repo-wide.

## Consequences

- `pnpm lint` reports the same two `react-refresh/only-export-components` warnings as before and
  nothing else, in about 0.5 s against ESLint's 4.5 s.
- The guard is now our code. If Oxlint's JS plugin API (alpha) changes, the plugin and its test are
  the places to look; if Oxlint ever ships `no-restricted-syntax`, the plugin can be retired in
  favour of three selectors.
- Rules outside Oxlint's 59-of-61 type-aware coverage, and any rule tsgolint implements differently
  from typescript-eslint, can produce new findings on upgrade. Treat those as findings to decide,
  as `prefer-optional-chain` was, not as noise to switch off wholesale.
