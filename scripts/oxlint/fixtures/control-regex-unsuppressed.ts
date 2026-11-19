// Control: the same regex with no directive. Proves no-control-regex is live,
// so the suppressed fixture passing means the directive worked rather than the
// rule being off.
export const stripped = 'a\u0001b'.replace(/[\u0000-\u001f]/g, ' ')
