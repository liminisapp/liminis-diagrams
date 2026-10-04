#!/usr/bin/env node
/**
 * `render-c4` — render C4-PlantUML source files to SVG on disk.
 *
 * This is the CLI form of `renderC4DiagramToSVG` (`@liminis/diagrams/server`),
 * meant for pre-rendering diagrams in CI so that a plain `![Diagram](x.svg)` in
 * a markdown file is enough for GitHub (or any other markdown renderer) to show
 * it — no live rendering service, no image-provider proxy, nothing to host.
 * See https://docs.liminis.app/liminis-diagrams/github-integration/ for the recipe this exists for.
 *
 * No dependency is added for argument parsing: flags are hand-rolled to match
 * the style of the other scripts in this repo (guard-publish.mjs,
 * verify-package.mjs), and the surface here is small enough not to need one.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderC4DiagramToSVG } from '../server/render-to-string';

export interface Options {
  files: string[];
  /** Extract ```c4 fences from markdown inputs instead of treating the whole file as source. */
  fromMarkdown: boolean;
  dark: boolean;
  out?: string;
  outDir?: string;
  check: boolean;
  stdin: boolean;
}

function printUsage(): void {
  console.log(`Usage: render-c4 [options] <files...>

Render C4-PlantUML source files to SVG.

Options:
  --from-markdown    Read fenced c4 blocks out of markdown inputs rather than
                     treating each whole file as diagram source
  --dark             Render in dark mode
  -o, --out <file>   Output path (only valid with exactly one input file)
  --out-dir <dir>    Write outputs here, preserving basenames (.svg extension)
  --check            Validate only — write nothing, exit non-zero on any error
  --stdin            Read source from stdin, write SVG to stdout
  -h, --help         Show this help
`);
}

export function parseArgs(argv: string[]): Options | null {
  const options: Options = { files: [], fromMarkdown: false, dark: false, check: false, stdin: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        return null;
      case '--dark':
        options.dark = true;
        break;
      case '--from-markdown':
        options.fromMarkdown = true;
        break;
      case '--check':
        options.check = true;
        break;
      case '--stdin':
        options.stdin = true;
        break;
      case '-o':
      case '--out':
        options.out = argv[++i];
        break;
      case '--out-dir':
        options.outDir = argv[++i];
        break;
      default:
        options.files.push(arg);
    }
  }

  return options;
}

export function outputPathFor(inputPath: string, options: Options): string {
  if (options.out) return options.out;
  const svgName = `${basename(inputPath, extname(inputPath))}.svg`;
  return options.outDir ? join(options.outDir, svgName) : join(dirname(inputPath), svgName);
}

function renderStdin(dark: boolean): void {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    const source = Buffer.concat(chunks).toString('utf-8');
    const { svg, errors } = renderC4DiagramToSVG(source, dark);
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`<stdin>:${error.line}:${error.column}: ${error.message}`);
      }
      process.exitCode = 2;
      return;
    }
    process.stdout.write(svg);
  });
}

/**
 * Null when `options` is a valid combination; otherwise the message to report
 * (without the `render-c4: ` prefix `main` adds).
 */
export function validateStdinCombination(options: Options): string | null {
  if (options.stdin && (options.check || options.out !== undefined || options.outDir !== undefined || options.files.length > 0)) {
    return '--stdin cannot be combined with --check, -o/--out, --out-dir, or file arguments';
  }
  return null;
}

/**
 * ```c4 fences in a markdown file, with the 1-based line the fence body starts on
 * so errors point at the real location in the file rather than at the snippet.
 *
 * Diagrams live in fenced blocks far more often than in standalone .puml files —
 * that is how @liminis/editor stores them, how this package's own docs are
 * written, and what a markdown-based diagram wiki produces. A renderer that only
 * understood whole files would not fit the common case.
 *
 * A fence tagged `invalid` is skipped: a page documenting parse errors needs
 * source that does not parse, and that is content rather than a defect.
 */
export function extractC4Fences(markdown: string): { source: string; line: number; index: number }[] {
  const out: { source: string; line: number; index: number }[] = [];
  const fence = /^```c4([^\n]*)\n([\s\S]*?)\n```$/gm;
  let index = 0;
  for (const match of markdown.matchAll(fence)) {
    if (/\binvalid\b/.test(match[1] ?? '')) continue;
    index++;
    const before = markdown.slice(0, match.index ?? 0);
    out.push({
      source: match[2],
      line: before.split('\n').length + 1,
      index,
    });
  }
  return out;
}

function renderMarkdownFences(options: Options): number {
  let failures = 0;

  for (const inputPath of options.files) {
    let markdown: string;
    try {
      markdown = readFileSync(inputPath, 'utf-8');
    } catch (err) {
      failures++;
      console.error(`${inputPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const fences = extractC4Fences(markdown);
    if (fences.length === 0) continue;

    for (const fence of fences) {
      const { svg, errors } = renderC4DiagramToSVG(fence.source, options.dark);
      if (errors.length > 0) {
        failures++;
        for (const error of errors) {
          // Offset into the containing file, so the message is navigable.
          console.error(`${inputPath}:${fence.line + error.line - 1}:${error.column}: ${error.message}`);
        }
        continue;
      }
      if (options.check) continue;

      const base = basename(inputPath, extname(inputPath));
      const svgName = `${base}-${fence.index}.svg`;
      const outPath = options.outDir
        ? join(options.outDir, svgName)
        : join(dirname(inputPath), svgName);
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, svg);
      } catch (err) {
        failures++;
        console.error(`${inputPath}: failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      console.log(`${inputPath} [${fence.index}] -> ${outPath}`);
    }
  }

  return failures > 0 ? 2 : 0;
}

export function renderFiles(options: Options): number {
  if (options.fromMarkdown) return renderMarkdownFences(options);

  if (options.out && options.files.length > 1) {
    console.error('render-c4: -o/--out only applies with a single input file');
    return 1;
  }

  let failures = 0;

  for (const inputPath of options.files) {
    let source: string;
    try {
      source = readFileSync(inputPath, 'utf-8');
    } catch (err) {
      failures++;
      console.error(`${inputPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const { svg, errors } = renderC4DiagramToSVG(source, options.dark);

    if (errors.length > 0) {
      failures++;
      for (const error of errors) {
        console.error(`${inputPath}:${error.line}:${error.column}: ${error.message}`);
      }
      continue;
    }

    if (options.check) continue;

    const outPath = outputPathFor(inputPath, options);
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, svg);
    } catch (err) {
      failures++;
      console.error(`${inputPath}: failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    console.log(`${inputPath} -> ${outPath}`);
  }

  return failures > 0 ? 2 : 0;
}

function main(): void {
  const rawArgs = process.argv.slice(2);
  const options = parseArgs(rawArgs);

  if (!options) {
    printUsage();
    return;
  }

  const stdinConflict = validateStdinCombination(options);
  if (stdinConflict) {
    console.error(`render-c4: ${stdinConflict}`);
    process.exitCode = 1;
    return;
  }

  if (options.files.length === 0 && !options.stdin) {
    if (rawArgs.length === 0) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    // Flags were given (e.g. `--check` over a glob that matched nothing) but no
    // files resolved — "nothing to do" is success, not a usage error, so a CI
    // step like `render-c4 --check $(git ls-files '*.puml')` doesn't fail a repo
    // that has no diagrams yet.
    console.log('render-c4: no input files');
    return;
  }

  if (options.stdin) {
    renderStdin(options.dark);
  } else {
    process.exitCode = renderFiles(options);
  }
}

// Only run when executed directly (`node render-c4.js`), not when imported —
// e.g. by the test file below, which exercises `parseArgs`/`outputPathFor` in
// isolation without wanting a real CLI invocation as a side effect of import.
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
