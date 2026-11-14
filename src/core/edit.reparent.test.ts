import { describe, it, expect } from 'vitest';
import { applyC4Edit } from './edit';
import { parseC4 } from './parser';

function move(source: string, id: string, parent?: string) {
  const r = applyC4Edit(source, { kind: 'reparent', id, parent });
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

function parentOf(source: string, id: string): string | undefined {
  return parseC4(source).diagram!.elements.find((e) => e.id === id)!.parent;
}

/** Lines of `s` as a sorted multiset after trimming indentation, so re-indentation is ignored. */
function trimmedSorted(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .sort();
}

const BASE = [
  '@startuml',
  "' a comment",
  'Person(user, "User")',
  'System_Boundary(sys, "System") {',
  '  Container(web, "Web", "React")',
  '  Container(api, "API", "Node")',
  '}',
  'System_Boundary(other, "Other") {',
  '  Container(db, "DB", "SQL")',
  '}',
  'Rel(user, web, "Uses", "HTTPS")',
  'Rel_D(web, api, "Calls")',
  '@enduml',
  '',
].join('\n');

describe('reparent: into a boundary', () => {
  it('moves a top-level element to the end of the destination block, re-indented', () => {
    const r = move(BASE, 'user', 'sys');
    expect(r.source).toBe(
      [
        '@startuml',
        "' a comment",
        'System_Boundary(sys, "System") {',
        '  Container(web, "Web", "React")',
        '  Container(api, "API", "Node")',
        '  Person(user, "User")',
        '}',
        'System_Boundary(other, "Other") {',
        '  Container(db, "DB", "SQL")',
        '}',
        'Rel(user, web, "Uses", "HTTPS")',
        'Rel_D(web, api, "Calls")',
        '@enduml',
        '',
      ].join('\n'),
    );
    expect(parentOf(r.source, 'user')).toBe('sys');
    expect(r.insertedLines).toEqual(['  Person(user, "User")']);
    expect(r.alias).toBe('user');
    expect(r.label).toBe('User');
  });

  it('moves between boundaries (source before destination)', () => {
    const r = move(BASE, 'web', 'other');
    expect(parentOf(r.source, 'web')).toBe('other');
    expect(parentOf(r.source, 'api')).toBe('sys');
    expect(r.source).toContain('  Container(db, "DB", "SQL")\n  Container(web, "Web", "React")\n}');
    expect(trimmedSorted(r.source)).toEqual(trimmedSorted(BASE));
  });

  it('moves between boundaries (source after destination)', () => {
    const r = move(BASE, 'db', 'sys');
    expect(parentOf(r.source, 'db')).toBe('sys');
    expect(r.source).toContain('  Container(api, "API", "Node")\n  Container(db, "DB", "SQL")\n}');
    // The emptied boundary keeps an empty block.
    expect(r.source).toContain('System_Boundary(other, "Other") {\n}');
    expect(trimmedSorted(r.source)).toEqual(trimmedSorted(BASE));
  });

  it('moves into an empty destination using parent indent plus one unit', () => {
    const src = ['Person(p, "P")', 'System_Boundary(b, "B") {', '}', ''].join('\n');
    expect(move(src, 'p', 'b').source).toBe(['System_Boundary(b, "B") {', '  Person(p, "P")', '}', ''].join('\n'));
  });

  it('is the identity apart from the moved line, byte for byte', () => {
    const r = move(BASE, 'user', 'sys');
    const remaining = BASE.replace('Person(user, "User")\n', '');
    expect(r.source.replace('  Person(user, "User")\n', '')).toBe(remaining);
  });

  it('moves a boundary with its children, comments, Rels and blank lines', () => {
    const src = [
      'Person(user, "User")',
      'System_Boundary(outer, "Outer") {',
      '}',
      'System_Boundary(sys, "System") {',
      '    ',
      "    ' keep me",
      '    Container(web, "Web", "React")',
      '',
      '    System_Boundary(inner, "Inner") {',
      '        Container(deep, "Deep", "Go")',
      '    }',
      '    Rel(web, deep, "Calls")',
      '}',
      'Rel(user, web, "Uses")',
      '',
    ].join('\n');
    const r = move(src, 'sys', 'outer');
    // The block shifts by one uniform amount (the detected indent unit, 4), so relative indentation survives.
    expect(r.source).toBe(
      [
        'Person(user, "User")',
        'System_Boundary(outer, "Outer") {',
        '    System_Boundary(sys, "System") {',
        '    ',
        "        ' keep me",
        '        Container(web, "Web", "React")',
        '',
        '        System_Boundary(inner, "Inner") {',
        '            Container(deep, "Deep", "Go")',
        '        }',
        '        Rel(web, deep, "Calls")',
        '    }',
        '}',
        'Rel(user, web, "Uses")',
        '',
      ].join('\n'),
    );
    expect(parentOf(r.source, 'sys')).toBe('outer');
    expect(parentOf(r.source, 'web')).toBe('sys');
    expect(parentOf(r.source, 'inner')).toBe('sys');
    expect(parentOf(r.source, 'deep')).toBe('inner');
    expect(r.insertedLines).toHaveLength(10);
    expect(parseC4(r.source).diagram!.relationships).toHaveLength(2);
  });

  it('moves into a nested boundary', () => {
    const src = [
      'Person(p, "P")',
      'System_Boundary(a, "A") {',
      '  Container_Boundary(b, "B") {',
      '    Component(c, "C")',
      '  }',
      '}',
      '',
    ].join('\n');
    const r = move(src, 'p', 'b');
    expect(r.source).toContain('    Component(c, "C")\n    Person(p, "P")\n  }');
    expect(parentOf(r.source, 'p')).toBe('b');
  });
});

describe('reparent: to the top level', () => {
  it('moves a child out, after the last top-level block', () => {
    const r = move(BASE, 'web');
    expect(parentOf(r.source, 'web')).toBeUndefined();
    expect(r.source).toBe(
      [
        '@startuml',
        "' a comment",
        'Person(user, "User")',
        'System_Boundary(sys, "System") {',
        '  Container(api, "API", "Node")',
        '}',
        'System_Boundary(other, "Other") {',
        '  Container(db, "DB", "SQL")',
        '}',
        'Container(web, "Web", "React")',
        'Rel(user, web, "Uses", "HTTPS")',
        'Rel_D(web, api, "Calls")',
        '@enduml',
        '',
      ].join('\n'),
    );
  });

  it('moves the last child out of a boundary, leaving an empty block', () => {
    const r = move(BASE, 'db');
    expect(r.source).toContain('System_Boundary(other, "Other") {\n}\nContainer(db, "DB", "SQL")\n');
    expect(parentOf(r.source, 'db')).toBeUndefined();
  });

  it('goes to the top level, not the grandparent, when the parent is nested', () => {
    const src = [
      'System_Boundary(a, "A") {',
      '  Container_Boundary(b, "B") {',
      '    Component(c, "C")',
      '  }',
      '}',
      '',
    ].join('\n');
    const r = move(src, 'c');
    expect(r.source).toBe(
      ['System_Boundary(a, "A") {', '  Container_Boundary(b, "B") {', '  }', '}', 'Component(c, "C")', ''].join('\n'),
    );
  });

  it('moves a nested boundary out with its block', () => {
    const src = [
      'System_Boundary(a, "A") {',
      '  Container_Boundary(b, "B") {',
      '    Component(c, "C")',
      '  }',
      '}',
      '',
    ].join('\n');
    const r = move(src, 'b');
    expect(r.source).toBe(
      ['System_Boundary(a, "A") {', '}', 'Container_Boundary(b, "B") {', '  Component(c, "C")', '}', ''].join('\n'),
    );
    expect(parentOf(r.source, 'c')).toBe('b');
    expect(parentOf(r.source, 'b')).toBeUndefined();
  });

  it('places a moved item before @enduml when it was the only anchor candidate', () => {
    const src = ['@startuml', 'Boundary(b, "B") {', '  Person(p, "P")', '}', '@enduml', ''].join('\n');
    const r = move(src, 'p');
    expect(r.source).toBe(['@startuml', 'Boundary(b, "B") {', '}', 'Person(p, "P")', '@enduml', ''].join('\n'));
  });
});

describe('reparent: indentation and line endings', () => {
  it('re-indents tab-indented children into a space-indented destination', () => {
    const src = ['Boundary(a, "A") {', '\tPerson(p, "P")', '}', 'Boundary(b, "B") {', '  Person(q, "Q")', '}', ''].join('\n');
    const r = move(src, 'p', 'b');
    expect(r.source).toContain('  Person(q, "Q")\n  Person(p, "P")\n}');
    expect(parentOf(r.source, 'p')).toBe('b');
  });

  it('preserves CRLF', () => {
    const src = BASE.replace(/\n/g, '\r\n');
    const r = move(src, 'web', 'other');
    expect(r.source.replace(/\r\n/g, '\n')).toBe(move(BASE, 'web', 'other').source);
    expect(r.source.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const out = move(src, 'user', 'sys');
    expect(out.source.match(/\r?\n/g)!.every((m) => m === '\r\n')).toBe(true);
    expect(out.insertedLines.every((l) => !l.includes('\r'))).toBe(true);
  });

  it('preserves a missing trailing newline', () => {
    const src = ['Boundary(a, "A") {', '  Person(p, "P")', '}', 'Person(q, "Q")'].join('\n');
    const r = move(src, 'q', 'a');
    expect(r.source).toBe(['Boundary(a, "A") {', '  Person(p, "P")', '  Person(q, "Q")', '}'].join('\n'));
  });

  it('moves out when the destination is the end of an unterminated-last-line source', () => {
    const src = ['Boundary(a, "A") {', '  Person(p, "P")', '}'].join('\n');
    const r = move(src, 'p');
    expect(r.source).toBe(['Boundary(a, "A") {', '}', 'Person(p, "P")'].join('\n'));
  });

  it('handles a block moved from the last line to a block above it', () => {
    const src = ['Boundary(a, "A") {', '}', 'Boundary(b, "B") {', '  Person(p, "P")', '}', 'Person(q, "Q")'].join('\n');
    const r = move(src, 'q', 'a');
    expect(r.source).toBe(
      ['Boundary(a, "A") {', '  Person(q, "Q")', '}', 'Boundary(b, "B") {', '  Person(p, "P")', '}'].join('\n'),
    );
  });
});

describe('reparent: adjacency and ordering', () => {
  it('moves an element whose line is directly above the destination close', () => {
    const src = ['Boundary(a, "A") {', '  Person(p, "P")', '}', 'Boundary(b, "B") {', '}', ''].join('\n');
    const r = move(src, 'p', 'b');
    expect(r.source).toBe(['Boundary(a, "A") {', '}', 'Boundary(b, "B") {', '  Person(p, "P")', '}', ''].join('\n'));
  });

  it('moves the last top-level block into an earlier boundary', () => {
    const src = ['Boundary(a, "A") {', '}', 'Person(p, "P")', ''].join('\n');
    expect(move(src, 'p', 'a').source).toBe(['Boundary(a, "A") {', '  Person(p, "P")', '}', ''].join('\n'));
  });

  it('moves a top-level block that is not last, into a later boundary', () => {
    const src = ['Person(p, "P")', 'Person(q, "Q")', 'Boundary(a, "A") {', '}', ''].join('\n');
    expect(move(src, 'p', 'a').source).toBe(['Person(q, "Q")', 'Boundary(a, "A") {', '  Person(p, "P")', '}', ''].join('\n'));
  });
});

describe('reparent: results and rejections', () => {
  it('returns the source unchanged when already under that parent', () => {
    const r = move(BASE, 'web', 'sys');
    expect(r.source).toBe(BASE);
    const top = move(BASE, 'user');
    expect(top.source).toBe(BASE);
  });

  it('rejects an unknown id', () => {
    expect(applyC4Edit(BASE, { kind: 'reparent', id: 'nope', parent: 'sys' })).toMatchObject({ ok: false, code: 'unknown-element' });
  });

  it('rejects an unknown parent and a non-boundary parent', () => {
    expect(applyC4Edit(BASE, { kind: 'reparent', id: 'user', parent: 'nope' })).toMatchObject({ ok: false, code: 'unknown-parent' });
    expect(applyC4Edit(BASE, { kind: 'reparent', id: 'user', parent: 'web' })).toMatchObject({ ok: false, code: 'unknown-parent' });
  });

  it('rejects a boundary moved into itself or a descendant, leaving the source alone', () => {
    const src = [
      'Boundary(a, "A") {',
      '  Boundary(b, "B") {',
      '    Boundary(c, "C") {',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n');
    for (const parent of ['a', 'b', 'c']) {
      expect(applyC4Edit(src, { kind: 'reparent', id: 'a', parent })).toMatchObject({ ok: false, code: 'move-into-self' });
    }
    expect(applyC4Edit(src, { kind: 'reparent', id: 'b', parent: 'c' })).toMatchObject({ ok: false, code: 'move-into-self' });
    // Moving into an ancestor is fine.
    expect(applyC4Edit(src, { kind: 'reparent', id: 'c', parent: 'a' }).ok).toBe(true);
  });

  it('rejects an unterminated destination', () => {
    const src = ['Person(p, "P")', 'Boundary(a, "A") {', '  Person(q, "Q")', ''].join('\n');
    expect(applyC4Edit(src, { kind: 'reparent', id: 'p', parent: 'a' })).toMatchObject({
      ok: false,
      code: 'boundary-cannot-take-children',
    });
  });

  it('rejects a source that does not parse', () => {
    expect(applyC4Edit('Boundary(a, "A" {', { kind: 'reparent', id: 'a' })).toMatchObject({ ok: false });
  });

  it('returns invalid-result for an unterminated moved boundary instead of mis-nesting', () => {
    const src = ['Boundary(a, "A") {', '  Person(q, "Q")', ''].join('\n');
    const r = applyC4Edit(src, { kind: 'reparent', id: 'q' });
    expect(r.ok).toBe(false);
    const sibling = ['Boundary(b, "B") {', '}', 'Boundary(a, "A") {', '  Person(q, "Q")', ''].join('\n');
    expect(applyC4Edit(sibling, { kind: 'reparent', id: 'a', parent: 'b' })).toMatchObject({
      ok: false,
      code: 'invalid-result',
    });
  });

  it('keeps every alias and every other parent', () => {
    const r = move(BASE, 'api', 'other');
    const before = parseC4(BASE).diagram!.elements.map((e) => [e.id, e.parent]).sort();
    const after = parseC4(r.source).diagram!.elements.map((e) => [e.id, e.parent]).sort();
    expect(after.map(([id]) => id)).toEqual(before.map(([id]) => id));
    expect(after.filter(([id, p]) => p !== before.find(([i]) => i === id)![1]).map(([id]) => id)).toEqual(['api']);
  });
});
