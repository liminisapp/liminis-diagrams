// Host-boundary guard, as an Oxlint JS plugin (ADR-114).
//
// The package must never reach back into its host through the global `api`
// (the Electron preload bridge in the host application). Every host capability
// arrives by injection through a component prop or an option, which is what
// lets this package build, test and ship with no host present at all.
//
// `no-restricted-imports` only covers module paths, and the bridge is reached
// through a global, so it needs a syntax rule. ESLint did this with three
// `no-restricted-syntax` selectors. Oxlint does not implement that rule, so the
// same three patterns are three small rules here, each with its own message so a
// regression in one cannot hide behind the others. They are plain visitors
// rather than selector strings: they depend on nothing but ESTree node shapes.
//
// The plugin lives under `scripts/`, which is outside the lint scope, and is
// exercised end to end by `lint-guard.test.mjs`, which runs the real `oxlint`
// binary over fixtures — so a plugin that silently stopped loading fails a test
// rather than reporting nothing.

const GLOBAL_NAME = /^(window|globalThis)$/

/** A reference to `window` or `globalThis` itself. */
function isHostGlobal(node) {
  return node?.type === 'Identifier' && GLOBAL_NAME.test(node.name)
}

/**
 * Peel type-level wrappers off an expression: `window as X`,
 * `window as unknown as X`, `<X>window`, `window!`, `window satisfies X`.
 * Returns the underlying expression and whether any wrapper was removed.
 */
function unwrapTypeWrappers(node) {
  let current = node
  let wrapped = false
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression')
  ) {
    current = current.expression
    wrapped = true
  }
  return { inner: current, wrapped }
}

/** `.api` (dotted or optional) — the property is the identifier `api`. */
function isDottedApi(member) {
  return !member.computed && member.property?.type === 'Identifier' && member.property.name === 'api'
}

/** `['api']` — the property is the string literal `'api'`. */
function isComputedApi(member) {
  if (!member.computed) return false
  const p = member.property
  if (p?.type === 'Literal') return p.value === 'api'
  if (p?.type === 'TemplateLiteral') {
    return p.expressions.length === 0 && p.quasis.length === 1 && p.quasis[0].value.cooked === 'api'
  }
  return false
}

const GUIDANCE =
  'Accept the capability through a component prop or an option instead, so the package keeps building, testing and shipping with no host present.'

const noWindowApi = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow reaching into the host via window.api / globalThis.api.' },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isHostGlobal(node.object) && isDottedApi(node)) {
          context.report({
            node,
            message: `@liminis/diagrams must not reach into the host via ${node.object.name}.api. ${GUIDANCE}`,
          })
        }
      },
    }
  },
}

const noWindowComputedApi = {
  meta: {
    type: 'problem',
    docs: { description: "Disallow reaching into the host via window['api'] / globalThis['api']." },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isHostGlobal(node.object) && isComputedApi(node)) {
          context.report({
            node,
            message: `@liminis/diagrams must not reach into the host via ${node.object.name}["api"]. ${GUIDANCE}`,
          })
        }
      },
    }
  },
}

// The cast form is the one a regression would most likely take: plain
// `window.api` already fails typecheck here, since the package deliberately
// carries no declaration for it, so the natural workaround is a cast.
//
// It must be anchored to the *cast operand*, not just to the cast: reporting any
// `(x as Y).api` would also flag innocent code like
// `(someService as unknown as { api: Client }).api`.
const noWindowCastApi = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow casting window / globalThis to expose `api`.' },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const { inner, wrapped } = unwrapTypeWrappers(node.object)
        if (!wrapped || !isHostGlobal(inner)) return
        if (isDottedApi(node) || isComputedApi(node)) {
          context.report({
            node,
            message: `@liminis/diagrams must not reach into the host by casting ${inner.name} to expose \`api\`. ${GUIDANCE}`,
          })
        }
      },
    }
  },
}

export default {
  meta: { name: 'host-boundary' },
  rules: {
    'no-window-api': noWindowApi,
    'no-window-computed-api': noWindowComputedApi,
    'no-window-cast-api': noWindowCastApi,
  },
}
