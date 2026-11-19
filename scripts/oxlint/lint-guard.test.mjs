import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * End-to-end proof that the lint setup still enforces what ESLint used to
 * (ADR-114). Runs the real `oxlint` binary, type-aware, over committed fixtures
 * and asserts on the findings — so a plugin that silently stopped loading, a
 * rule that was dropped from the config, or a migration that lost a message
 * fails here rather than reporting nothing.
 *
 * The fixtures live under `scripts/`, outside the lint scope, because they must
 * fail lint and would otherwise turn `pnpm lint` red. They are linted through
 * `fixtures/.oxlintrc.json`, which extends the root config and only empties
 * `ignorePatterns` (`--no-ignore` does not bypass a config's own patterns).
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const fixtures = join(here, 'fixtures')
const rel = (p) => relative(root, p)

/** @type {Array<{ code: string, message: string, file: string, line: number }>} */
let findings

beforeAll(() => {
  const result = spawnSync(
    join(root, 'node_modules', '.bin', 'oxlint'),
    [
      '--type-aware',
      '-c', rel(join(fixtures, '.oxlintrc.json')),
      '--tsconfig', rel(join(fixtures, 'tsconfig.json')),
      '--format', 'json',
      rel(fixtures),
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )
  const out = result.stdout
  const report = JSON.parse(out.slice(out.indexOf('{')))
  findings = report.diagnostics.map((d) => ({
    code: d.code,
    // no-restricted-properties carries its custom text in `help`, not `message`.
    message: [d.message, d.help].filter(Boolean).join(' '),
    file: d.filename.split('/').pop(),
    line: d.labels[0]?.span.line ?? 0,
  }))
}, 150_000)

const inFile = (file, code) => findings.filter((f) => f.file === file && f.code === code)

describe('host-boundary guard', () => {
  it('is registered in the root config as an error', () => {
    const config = JSON.parse(
      // .oxlintrc.json is JSONC: drop whole-line comments before parsing.
      readFileSync(join(root, '.oxlintrc.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
    )
    expect(config.jsPlugins).toContain('./scripts/oxlint/host-boundary-plugin.mjs')
    for (const rule of ['no-window-api', 'no-window-computed-api', 'no-window-cast-api']) {
      expect(config.rules[`host-boundary/${rule}`]).toBe('error')
    }
  })

  it('flags the dotted and optional forms', () => {
    const hits = inFile('guard-violations.ts', 'host-boundary(no-window-api)')
    expect(hits.map((h) => h.line)).toEqual([4, 5]) // window.api, globalThis?.api
    expect(hits[0].message).toContain('window.api')
    expect(hits[1].message).toContain('globalThis.api')
  })

  it('flags the computed form', () => {
    const hits = inFile('guard-violations.ts', 'host-boundary(no-window-computed-api)')
    expect(hits.map((h) => h.line)).toEqual([6, 7]) // window['api'], globalThis?.['api']
    expect(hits[0].message).toContain('window["api"]')
  })

  it('flags the cast forms, including the computed spelling', () => {
    const hits = inFile('guard-violations.ts', 'host-boundary(no-window-cast-api)')
    expect(hits.map((h) => h.line)).toEqual([8, 9, 10])
    expect(hits[0].message).toContain('casting window')
    expect(hits[2].message).toContain('casting globalThis')
  })

  it('reports nothing on look-alikes (other objects, other properties)', () => {
    const hits = findings.filter(
      (f) => f.file === 'guard-benign.ts' && f.code.startsWith('host-boundary'),
    )
    expect(hits).toEqual([])
  })

  it('messages speak for this package, not the editor', () => {
    const messages = findings.filter((f) => f.code.startsWith('host-boundary')).map((f) => f.message)
    expect(messages.length).toBeGreaterThan(0)
    for (const m of messages) {
      expect(m).toContain('@liminis/diagrams')
      expect(m).not.toMatch(/@liminis\/editor|EditorHostServices|ADR-075/)
    }
  })
})

describe('rule probe (parity with the ESLint baseline)', () => {
  const probe = (code) => inFile('probe-violations.ts', code)

  it('reports floating promises, local and imported', () => {
    expect(probe('typescript(no-floating-promises)').map((f) => f.line)).toEqual([8, 12])
  })

  it('reports a promise in a conditional and an async forEach callback', () => {
    expect(probe('typescript(no-misused-promises)').map((f) => f.line)).toEqual([16, 21])
  })

  it('reports an unnecessary type assertion and an unnecessary non-null assertion', () => {
    expect(probe('typescript(no-unnecessary-type-assertion)').map((f) => f.line)).toEqual([28, 32])
  })

  it('reports confirm() with its custom message', () => {
    const [hit, ...rest] = probe('eslint(no-restricted-globals)')
    expect(rest).toEqual([])
    expect(hit.message).toContain('Use a dialog component instead of confirm()')
  })

  it('reports window.alert with its custom message', () => {
    const [hit, ...rest] = probe('eslint(no-restricted-properties)')
    expect(rest).toEqual([])
    expect(hit.message).toContain('instead of window.alert()')
  })
})

describe('eslint-disable directives', () => {
  it('still suppresses no-control-regex (src/core/edit.ts relies on this)', () => {
    expect(inFile('control-regex-suppressed.ts', 'eslint(no-control-regex)')).toEqual([])
  })

  it('has no-control-regex live, so the suppression above is the directive working', () => {
    expect(inFile('control-regex-unsuppressed.ts', 'eslint(no-control-regex)')).toHaveLength(1)
  })
})
