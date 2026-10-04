#!/usr/bin/env node
/**
 * Verify the package as a *shipped artifact*, not as a source tree.
 *
 * Every check here exists because something got through the checks we already
 * had. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` were all
 * green for each of the following:
 *
 *   - **0.1.0's first release attempt failed at the registry** because
 *     `package.json` had no `repository` field. npm matches it against the
 *     GitHub Actions OIDC claim when publishing with `--provenance`, so the
 *     publish was rejected (E422) *after* the release tag had been cut and had
 *     to be deleted again. Nothing in the source tree could have told us.
 *   - **`npm install @liminis/diagrams` silently installed an empty 0.0.0
 *     stub** on Node 20 for the first hour after 0.1.0 shipped. 0.1.0 declares
 *     `engines: node >=22` and the stub declared none, so npm's resolver
 *     preferred the engine-compatible version and said nothing. The tarball was
 *     perfect; the thing people actually typed was broken.
 *
 * The lesson both share: the artifact and the source tree are different things,
 * and only the artifact is what a consumer gets. So this script packs, unpacks,
 * installs and imports rather than reading `src/`.
 *
 * Usage:
 *     pnpm verify:package
 *
 * Runs every check, reports each one, and exits non-zero at the end if any
 * failed -- deliberately not fail-fast, so one release attempt surfaces every
 * problem rather than one per run.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePackOutput } from './pack-output.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
// Matched exactly, not by substring: `github.com/liminisapp/liminis-diagrams` is
// a prefix of `github.com/liminisapp/liminis-diagrams-fork`, so a substring test
// would pass for the wrong repository. The `git+https://` scheme and the `.git`
// suffix are both part of what npm matches against the OIDC claim, so both are
// part of the expected value rather than checked separately.
const EXPECTED_REPO_URL = 'git+https://github.com/liminisapp/liminis-diagrams.git'
const ENTRY_POINTS = ['.', './core', './react', './playground', './remark', './server']
/**
 * Entries that must work with no React installed, each with a probe that
 * actually exercises it.
 *
 * A probe per entry rather than one shared snippet: these export different
 * things, and importing a name an entry never had would fail for the wrong
 * reason — reporting "does not provide an export named …" as though React were
 * the problem.
 *
 * ./remark is here because it runs in Node during a host's build, long before
 * any React exists. A build-time plugin reaching for a UI library would be a
 * defect, and this is the check that would notice.
 */
const REACT_FREE_ENTRIES = [
  {
    entry: '.',
    what: 'parses and lays out',
    probe: `import { parseC4, layoutC4Diagram } from '%s';
       const p = parseC4('Person(u,"U")\\nSystem(a,"A")\\nRel(u,a,"Uses")');
       if (p.errors.length) throw new Error('parse errors: ' + JSON.stringify(p.errors));
       const l = layoutC4Diagram(p.diagram);
       if (l.nodes.length !== 2 || l.edges.length !== 1) throw new Error('unexpected layout');
       console.log('ok');`,
  },
  {
    entry: './core',
    what: 'parses and lays out',
    probe: `import { parseC4, layoutC4Diagram } from '%s';
       const p = parseC4('Person(u,"U")\\nSystem(a,"A")\\nRel(u,a,"Uses")');
       if (p.errors.length) throw new Error('parse errors: ' + JSON.stringify(p.errors));
       const l = layoutC4Diagram(p.diagram);
       if (l.nodes.length !== 2 || l.edges.length !== 1) throw new Error('unexpected layout');
       console.log('ok');`,
  },
  {
    entry: './remark',
    what: 'transforms a fence',
    probe: `import { remarkC4 } from '%s';
       const tree = { type: 'root', children: [{ type: 'code', lang: 'c4', value: 'Person(u,"U")' }] };
       remarkC4()(tree);
       if (!tree.children.some((c) => c.type === 'mdxJsxFlowElement')) throw new Error('no island produced');
       if (!tree.children.some((c) => c.type === 'mdxjsEsm')) throw new Error('no import injected');
       console.log('ok');`,
  },
]

let failures = 0
const pass = (msg) => console.log(`  \x1b[32mok\x1b[0m    ${msg}`)
const fail = (msg, detail) => {
  failures++
  console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`)
  if (detail) console.log(`        ${String(detail).split('\n').join('\n        ')}`)
}
const step = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`)

function run(cmd, args, cwd, opts = {}) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
  })
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// Resolved once: the error paths all report it, and shelling out per message
// risks them disagreeing if anything changes mid-run.
const NPM_VERSION = run('npm', ['--version'], ROOT).trim()

// `--no-build` is passed by ci.yml, which already runs `pnpm build` as its own
// named step (FR-006 requires that). Without it the build runs twice in the same
// job, roughly doubling the slowest part of it against a 10-minute timeout.
// publish.yml does NOT pass it: there is no separate build step there, so this
// script must produce the dist/ it packs.
const SKIP_BUILD = process.argv.includes('--no-build')

// ---------------------------------------------------------------------------
step('Manifest — the fields the registry checks, not the ones tsc checks')

// The #6 failure. Provenance matches this against the OIDC claim; a missing or
// mismatched value fails at the registry, after the tag exists.
const repoUrl = manifest.repository?.url ?? ''
if (!repoUrl) {
  fail('repository.url is present', 'npm --provenance cannot publish without it (E422)')
} else if (repoUrl !== EXPECTED_REPO_URL) {
  // Report the specific way it differs -- scheme, suffix and target are three
  // different mistakes and the fix differs for each.
  const why = []
  if (!repoUrl.startsWith('git+https://')) why.push('scheme is not git+https:// (the SSH form does not match the claim)')
  if (!repoUrl.endsWith('.git')) why.push('missing the .git suffix')
  if (!repoUrl.replace(/^git\+/, '').replace(/\.git$/, '').endsWith('github.com/liminisapp/liminis-diagrams'))
    why.push('does not point at liminisapp/liminis-diagrams')
  fail('repository.url matches this repository exactly', `got  ${repoUrl}\nwant ${EXPECTED_REPO_URL}` + (why.length ? `\n${why.join('\n')}` : ''))
} else {
  pass(`repository.url ${repoUrl}`)
}

// Optional peers are what let ./core install without React. If they ever became
// hard dependencies or lost `optional`, the package's central claim would break
// silently for every consumer.
const peerMeta = manifest.peerDependenciesMeta ?? {}
for (const peer of ['react', 'react-dom']) {
  if (manifest.dependencies?.[peer]) {
    fail(`${peer} is not a hard dependency`, 'it must stay an optional peer or ./core stops being React-free')
  } else if (peerMeta[peer]?.optional !== true) {
    fail(`${peer} is declared an OPTIONAL peer`, `peerDependenciesMeta.${peer}.optional is not true`)
  } else {
    pass(`${peer} is an optional peer`)
  }
}

const runtimeDeps = Object.keys(manifest.dependencies ?? {})
if (runtimeDeps.length === 1 && runtimeDeps[0] === '@dagrejs/dagre') {
  pass('the only runtime dependency is @dagrejs/dagre')
} else {
  fail('runtime dependencies are exactly [@dagrejs/dagre]', `got ${JSON.stringify(runtimeDeps)}`)
}

for (const entry of ENTRY_POINTS) {
  if (manifest.exports?.[entry]) pass(`exports declares ${entry}`)
  else fail(`exports declares ${entry}`, 'entry point missing from the exports map')
}

// ---------------------------------------------------------------------------
step('Tarball — what actually ships')

if (!SKIP_BUILD) run('pnpm', ['run', 'build'], ROOT)
else pass('build skipped (--no-build): the workflow built already')

const packed = parsePackOutput(
  run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], ROOT),
  NPM_VERSION,
)
const files = packed.files.map((f) => f.path)

const leaked = files.filter(
  (f) =>
    f.startsWith('src/') ||
    f.startsWith('specs/') ||
    f.startsWith('demo/') ||
    f.startsWith('docs/') ||
    // .tsx as well as .ts: src/react/*.tsx are real source files, and a filter
    // that only knew about .ts would report a tarball containing them as clean.
    (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')),
)
if (leaked.length) fail('no source, specs, docs or demo in the tarball', leaked.join('\n'))
else pass(`tarball is ${files.length} files, dist/README/LICENSE/package.json only`)

for (const entry of ENTRY_POINTS) {
  const base = entry === '.' ? 'index' : entry.slice(2)
  for (const ext of ['js', 'd.ts']) {
    const want = `dist/${base}.${ext}`
    if (files.includes(want)) pass(`emitted ${want}`)
    else fail(`emitted ${want}`, 'entry point declared in exports but not present in the tarball')
  }
}

// The stylesheet is copied by scripts/copy-assets.mjs rather than emitted by
// tsc, which compiles only what it can typecheck. Nothing else would notice its
// absence: the export map would point at a file that never existed, and the
// symptom would be an unstyled playground in someone else's site.
const CSS = 'dist/playground/playground.css'
if (files.includes(CSS)) pass(`emitted ${CSS}`)
else fail(`emitted ${CSS}`, 'declared as ./playground.css but not in the tarball — did copy-assets run?')

if (manifest.exports?.['./playground.css'] === `./${CSS}`) pass('exports declares ./playground.css')
else fail('exports declares ./playground.css', `got ${JSON.stringify(manifest.exports?.['./playground.css'])}`)

// ---------------------------------------------------------------------------
step('Real install — the tarball, not the source tree')

const tgz = join(ROOT, run('npm', ['pack', '--ignore-scripts'], ROOT).trim())
const scratch = mkdtempSync(join(tmpdir(), 'liminis-diagrams-verify-'))
try {
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'verify-consumer', version: '1.0.0', type: 'module', private: true }),
  )
  // --omit=peer is the point: this consumer has no React on disk at all.
  run('npm', ['install', '--silent', '--omit=peer', tgz], scratch)

  const installed = join(scratch, 'node_modules', '@liminis', 'diagrams')
  if (!existsSync(installed)) {
    fail('the tarball installs', 'package missing from node_modules')
  } else {
    const got = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version
    if (got === manifest.version) pass(`installs as ${got}`)
    else fail('installed version matches the manifest', `installed ${got}, manifest says ${manifest.version}`)
  }

  const reactOnDisk = ['react', 'react-dom'].filter((p) =>
    existsSync(join(scratch, 'node_modules', p)),
  )
  if (reactOnDisk.length) {
    fail('no React on disk in a peer-omitted install', `found ${reactOnDisk.join(', ')}`)
  } else {
    pass('no react or react-dom on disk')
  }

  // The central claim: these entries must work with React absent. Importing is
  // the only honest proof -- a static import graph check would not catch a
  // transitive require.
  for (const { entry, what, probe } of REACT_FREE_ENTRIES) {
    const spec = entry === '.' ? '@liminis/diagrams' : `@liminis/diagrams/${entry.slice(2)}`
    try {
      const out = run('node', ['--input-type=module', '-e', probe.replaceAll('%s', spec)], scratch)
      if (out.includes('ok')) pass(`${spec} ${what} with no React installed`)
      else fail(`${spec} works with no React installed`, out)
    } catch (err) {
      fail(`${spec} works with no React installed`, err.stderr || err.message)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
  rmSync(tgz, { force: true })
}

// ---------------------------------------------------------------------------
console.log()
if (failures) {
  console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mAll package checks passed.\x1b[0m')
