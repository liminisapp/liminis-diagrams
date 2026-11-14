import { describe, it, expect } from 'vitest';
import {
  generateC4Alias,
  isValidC4Alias,
  isC4AliasAvailable,
  C4_ADDABLE_BOUNDARY_KINDS,
  C4_BOUNDARY_KIND_MACRO,
  C4_BOUNDARY_DEFAULT_LABELS,
} from './alias';

describe('generateC4Alias', () => {
  it('slugs a label to a lowercase identifier', () => {
    expect(generateC4Alias('Payment Service', [], 'container')).toBe('payment_service');
  });

  it('strips diacritics and non-ASCII', () => {
    expect(generateC4Alias('Café Münster', [], 'system')).toBe('cafe_munster');
  });

  it('falls back to a per-kind name when the slug is empty', () => {
    expect(generateC4Alias('!!! ???', [], 'person')).toBe('person');
    expect(generateC4Alias('日本語', [], 'componentDb')).toBe('database');
  });

  it('falls back when the slug would start with a digit', () => {
    expect(generateC4Alias('3rd Party', [], 'system')).toBe('system');
  });

  it('suffixes on repeated collisions', () => {
    expect(generateC4Alias('Cache', ['cache'], 'container')).toBe('cache_2');
    expect(generateC4Alias('Cache', ['cache', 'cache_2'], 'container')).toBe('cache_3');
  });

  it('compares case-insensitively', () => {
    expect(generateC4Alias('Cache', ['CACHE'], 'container')).toBe('cache_2');
  });

  it('avoids macro names and the reserved legend id', () => {
    expect(isC4AliasAvailable('Person', [])).toBe(false);
    expect(isC4AliasAvailable('Rel', [])).toBe(false);
    expect(isC4AliasAvailable('__legend__', [])).toBe(false);
    expect(generateC4Alias('Rel', ['rel'], 'system')).toBe('rel_2');
  });

  it('always produces a valid identifier', () => {
    for (const label of ['', ' ', '"quoted"', 'a-b.c', '😀', 'x'.repeat(200)]) {
      const alias = generateC4Alias(label, [], 'component');
      expect(isValidC4Alias(alias)).toBe(true);
    }
  });
});

describe('isValidC4Alias', () => {
  it('accepts identifiers and rejects others', () => {
    expect(isValidC4Alias('a_1')).toBe(true);
    expect(isValidC4Alias('_x')).toBe(true);
    expect(isValidC4Alias('1a')).toBe(false);
    expect(isValidC4Alias('a-b')).toBe(false);
    expect(isValidC4Alias('')).toBe(false);
  });
});

describe('boundary kinds', () => {
  it('maps each kind to its macro and a placeholder label', () => {
    expect(C4_ADDABLE_BOUNDARY_KINDS).toEqual(['systemBoundary', 'containerBoundary', 'boundary']);
    expect(C4_BOUNDARY_KIND_MACRO).toEqual({
      systemBoundary: 'System_Boundary',
      containerBoundary: 'Container_Boundary',
      boundary: 'Boundary',
    });
    for (const k of C4_ADDABLE_BOUNDARY_KINDS) expect(C4_BOUNDARY_DEFAULT_LABELS[k]).not.toBe('');
  });

  it('generates aliases from the label', () => {
    expect(generateC4Alias('API Application', [], 'containerBoundary')).toBe('api_application');
  });

  it('falls back to a per-kind alias for an unsluggable label', () => {
    expect(generateC4Alias('???', [], 'systemBoundary')).toBe('system_boundary');
    expect(generateC4Alias('???', [], 'containerBoundary')).toBe('container_boundary');
    expect(generateC4Alias('???', [], 'boundary')).toBe('boundary');
  });

  it('suffixes on collision, including with the fallback', () => {
    expect(generateC4Alias('???', ['boundary'], 'boundary')).toBe('boundary_2');
    expect(generateC4Alias('Core', ['core'], 'systemBoundary')).toBe('core_2');
  });
});
