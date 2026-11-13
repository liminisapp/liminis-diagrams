/**
 * Alias generation for new C4 elements.
 *
 * Aliases are the identifiers manual positions are keyed by, so a generated
 * alias must be decided once (by whoever reports the edit) and then stay stable.
 * Pure and React-free.
 */

import { C4_MACRO_NAMES } from './parser';

/**
 * The element kinds that can be added. `*Db` are the cylinder variants.
 * `_Ext`, `Queue`, boundaries and deployment nodes are intentionally absent.
 */
export type C4AddableElementKind =
  | 'person'
  | 'system'
  | 'container'
  | 'component'
  | 'systemDb'
  | 'containerDb'
  | 'componentDb';

export const C4_ADDABLE_ELEMENT_KINDS: readonly C4AddableElementKind[] = [
  'person',
  'system',
  'container',
  'component',
  'systemDb',
  'containerDb',
  'componentDb',
];

/** Macro each addable kind is written as. */
export const C4_ELEMENT_KIND_MACRO: Record<C4AddableElementKind, string> = {
  person: 'Person',
  system: 'System',
  container: 'Container',
  component: 'Component',
  systemDb: 'SystemDb',
  containerDb: 'ContainerDb',
  componentDb: 'ComponentDb',
};

/** Placeholder label used when the user supplies none. */
export const C4_DEFAULT_LABELS: Record<C4AddableElementKind, string> = {
  person: 'Person',
  system: 'System',
  container: 'Container',
  component: 'Component',
  systemDb: 'Database',
  containerDb: 'Database',
  componentDb: 'Database',
};

/** Label given to a relationship created by dragging from one element to another. */
export const C4_DEFAULT_RELATIONSHIP_LABEL = 'Uses';

const ALIAS_FALLBACK: Record<C4AddableElementKind, string> = {
  person: 'person',
  system: 'system',
  container: 'container',
  component: 'component',
  systemDb: 'database',
  containerDb: 'database',
  componentDb: 'database',
};

/** Id the renderer reserves for the legend pseudo-node. */
export const C4_RESERVED_LEGEND_ID = '__legend__';

const VALID_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_SLUG_LENGTH = 40;

/** Is `alias` a valid C4-PlantUML identifier? */
export function isValidC4Alias(alias: string): boolean {
  return VALID_ALIAS.test(alias);
}

/**
 * Is `alias` free to use: not an existing id (case-insensitive), not a macro
 * name, not the reserved legend id?
 */
export function isC4AliasAvailable(alias: string, existingIds: Iterable<string>): boolean {
  if (C4_MACRO_NAMES.has(alias)) return false;
  const lower = alias.toLowerCase();
  if (lower === C4_RESERVED_LEGEND_ID) return false;
  for (const id of existingIds) {
    if (id.toLowerCase() === lower) return false;
  }
  return true;
}

function slugify(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/g, '');
}

/**
 * Generate a unique, valid alias for a new element from its label.
 *
 * A lowercase ASCII slug of the label; a label that slugs to nothing (or to
 * something starting with a digit) falls back to a per-kind name. On collision
 * a numeric suffix is appended (`cache`, `cache_2`, `cache_3`, …).
 */
export function generateC4Alias(
  label: string,
  existingIds: Iterable<string>,
  kind: C4AddableElementKind = 'system',
): string {
  const taken = [...existingIds];
  let base = slugify(label);
  if (base === '' || /^[0-9]/.test(base)) base = ALIAS_FALLBACK[kind];
  if (isC4AliasAvailable(base, taken)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (isC4AliasAvailable(candidate, taken)) return candidate;
  }
}
