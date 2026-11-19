// One seeded bug per type-aware / restricted-API category the migration must
// not lose. Each must fail lint.
import { fetchThing } from './probe-helper.js'

async function localAsync(): Promise<void> {}

export function floatingLocal(): void {
  localAsync()
}

export function floatingImported(): void {
  fetchThing()
}

export function promiseInConditional(): string {
  if (localAsync()) return 'yes'
  return 'no'
}

export function asyncForEach(items: number[]): void {
  items.forEach(async (n) => {
    await fetchThing()
    void n
  })
}

export function unnecessaryAssertion(n: number): number {
  return n as number
}

export function unnecessaryNonNull(s: string): number {
  return s!.length
}

export function dialogs(): void {
  confirm('sure?')
  window.alert('hi')
}
