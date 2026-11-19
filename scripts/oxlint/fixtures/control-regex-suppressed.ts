// The same directive src/core/edit.ts uses. Oxlint implements no-control-regex
// natively and must honour the ESLint-style disable comment, including the
// `-- reason` suffix.
export const stripped = 'a\u0001b'
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  .replace(/[\u0000-\u001f]/g, ' ')
