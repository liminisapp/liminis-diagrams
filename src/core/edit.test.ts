import { describe, it, expect } from 'vitest';
import { applyC4Edit, sanitizeC4Text, type C4Edit } from './edit';
import { parseC4, validateC4 } from './parser';

/** Assert `after` is `before` with exactly one line inserted; nothing else changed. */
function expectSingleLineInsertion(before: string, after: string, line: string, eol = '\n') {
  for (const chunk of [line + eol, eol + line]) {
    if (after.length !== before.length + chunk.length) continue;
    for (let i = 0; i <= before.length; i++) {
      if (after === before.slice(0, i) + chunk + before.slice(i)) return;
    }
  }
  throw new Error(`not a single-line insertion of ${JSON.stringify(line)}:\n${before}\n---\n${after}`);
}

function apply(source: string, edit: C4Edit) {
  const r = applyC4Edit(source, edit);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

function expectParses(source: string) {
  const r = parseC4(source);
  expect(r.errors).toEqual([]);
  expect(validateC4(r.diagram!)).toEqual([]);
  return r.diagram!;
}

const addPerson = (over: Partial<Extract<C4Edit, { kind: 'add-element' }>> = {}): C4Edit => ({
  kind: 'add-element',
  elementKind: 'person',
  label: 'Admin',
  ...over,
});

const BASIC = `@startuml
Person(user, "User")
System(app, "App")
Rel(user, app, "Uses")
@enduml`;

describe('applyC4Edit: add-element, top level', () => {
  it('inserts one line after the last top-level element, ahead of the Rel that follows it', () => {
    const r = apply(BASIC, addPerson());
    expect(r.insertedLine).toBe('Person(admin, "Admin")');
    expect(r.alias).toBe('admin');
    expect(r.source.split('\n')).toEqual([
      '@startuml',
      'Person(user, "User")',
      'System(app, "App")',
      'Person(admin, "Admin")',
      'Rel(user, app, "Uses")',
      '@enduml',
    ]);
    expectSingleLineInsertion(BASIC, r.source, r.insertedLine);
    expect(expectParses(r.source).elements.map((e) => e.id)).toContain('admin');
  });

  it('inserts after a whole top-level boundary block', () => {
    const src = `System_Boundary(b, "B") {\n  System(s, "S")\n}\nRel(s, s2, "x")\nSystem(s2, "S2")`;
    // s2 is the last top-level element (after the Rel).
    const r = apply(src, addPerson());
    expect(r.source.split('\n').slice(-2)).toEqual(['System(s2, "S2")', 'Person(admin, "Admin")']);
    expectParses(r.source);

    const src2 = `Person(u, "U")\nSystem_Boundary(b, "B") {\n  System(s, "S")\n}\nRel(u, s, "x")`;
    const r2 = apply(src2, addPerson());
    expect(r2.source.split('\n')[4]).toBe('Person(admin, "Admin")');
    expectSingleLineInsertion(src2, r2.source, r2.insertedLine);
    expect(expectParses(r2.source).elements.find((e) => e.id === 'admin')!.parent).toBeUndefined();
  });

  it('falls back to before @enduml when there are no elements', () => {
    const src = '@startuml\n!include foo.puml\nLAYOUT_TOP_DOWN()\n@enduml';
    const r = apply(src, addPerson());
    expect(r.source.split('\n')).toEqual([
      '@startuml',
      '!include foo.puml',
      'LAYOUT_TOP_DOWN()',
      'Person(admin, "Admin")',
      '@enduml',
    ]);
  });

  it('falls back to the end of the text with no wrapper and no elements', () => {
    expect(apply('', addPerson()).source).toBe('Person(admin, "Admin")\n');
    expect(apply('LAYOUT_TOP_DOWN()', addPerson()).source).toBe('LAYOUT_TOP_DOWN()\nPerson(admin, "Admin")');
    expect(apply('LAYOUT_TOP_DOWN()\n', addPerson()).source).toBe('LAYOUT_TOP_DOWN()\nPerson(admin, "Admin")\n');
  });

  it('inserts after the last element when there is no Rel and no trailing newline', () => {
    const src = 'Person(u, "U")';
    const r = apply(src, addPerson());
    expect(r.source).toBe('Person(u, "U")\nPerson(admin, "Admin")');
    expectSingleLineInsertion(src, r.source, r.insertedLine);
  });

  it('never lands after @enduml', () => {
    const src = 'Person(u, "U")\n@enduml\n';
    const r = apply(src, addPerson());
    expect(r.source.indexOf('Person(admin')).toBeLessThan(r.source.indexOf('@enduml'));
  });

  it('handles multiple @startuml blocks (anchors on the last element)', () => {
    const src = '@startuml\nPerson(a, "A")\n@enduml\n@startuml\nPerson(b, "B")\n@enduml';
    const r = apply(src, addPerson());
    expect(r.source.split('\n')[5]).toBe('Person(admin, "Admin")');
    expectParses(r.source);
  });

  it('copies the indentation of the previous top-level element', () => {
    const src = '@startuml\n    Person(u, "U")\n@enduml';
    expect(apply(src, addPerson()).insertedLine).toBe('    Person(admin, "Admin")');
  });

  it('writes the right macro and argument order for every kind', () => {
    const cases: [Parameters<typeof addPerson>[0], string][] = [
      [{ elementKind: 'person' }, 'Person(admin, "Admin")'],
      [{ elementKind: 'system', description: 'Does things' }, 'System(admin, "Admin", "Does things")'],
      [{ elementKind: 'systemDb' }, 'SystemDb(admin, "Admin")'],
      [{ elementKind: 'container' }, 'Container(admin, "Admin")'],
      [{ elementKind: 'container', technology: 'Go' }, 'Container(admin, "Admin", "Go")'],
      [{ elementKind: 'component', description: 'd' }, 'Component(admin, "Admin", "", "d")'],
      [{ elementKind: 'containerDb', technology: 'PG', description: 'd' }, 'ContainerDb(admin, "Admin", "PG", "d")'],
      [{ elementKind: 'componentDb' }, 'ComponentDb(admin, "Admin")'],
    ];
    for (const [over, line] of cases) {
      const r = apply('', addPerson(over));
      expect(r.insertedLine).toBe(line);
      const el = expectParses(r.source).elements[0];
      expect(el.id).toBe('admin');
      expect(el.name).toBe('Admin');
    }
    const db = expectParses(apply('', addPerson({ elementKind: 'containerDb' })).source).elements[0];
    expect(db.properties.shape).toBe('cylinder');
  });
});

describe('applyC4Edit: add-element, inside a boundary', () => {
  const SRC = `@startuml
System_Boundary(b, "B") {
    System(s, "S")
    Rel(s, s, "x")
}
Person(u, "U")
@enduml`;

  it('inserts before the closing brace, indented like its siblings', () => {
    const r = apply(SRC, addPerson({ parent: 'b' }));
    expect(r.source.split('\n')).toEqual([
      '@startuml',
      'System_Boundary(b, "B") {',
      '    System(s, "S")',
      '    Rel(s, s, "x")',
      '    Person(admin, "Admin")',
      '}',
      'Person(u, "U")',
      '@enduml',
    ]);
    expectSingleLineInsertion(SRC, r.source, r.insertedLine);
    expect(expectParses(r.source).elements.find((e) => e.id === 'admin')!.parent).toBe('b');
  });

  it('indents an empty boundary by one detected unit (spaces)', () => {
    const src = 'Person(u, "U")\n    System_Boundary(b, "B") {\n    }\n';
    const r = apply(src, addPerson({ parent: 'b' }));
    expect(r.insertedLine).toBe('        Person(admin, "Admin")');
  });

  it('indents an empty boundary with a tab when the file uses tabs', () => {
    const src = 'System_Boundary(a, "A") {\n\tSystem(x, "X")\n}\nSystem_Boundary(b, "B") {\n}';
    const r = apply(src, addPerson({ parent: 'b' }));
    expect(r.insertedLine).toBe('\tPerson(admin, "Admin")');
  });

  it('defaults to a two-space unit when nothing indented exists', () => {
    const r = apply('System_Boundary(b, "B") {\n}', addPerson({ parent: 'b' }));
    expect(r.insertedLine).toBe('  Person(admin, "Admin")');
  });

  it('inserts into a nested boundary, not its parent', () => {
    const src = 'System_Boundary(o, "O") {\n  Container_Boundary(i, "I") {\n    Component(c, "C")\n  }\n}';
    const r = apply(src, addPerson({ parent: 'i' }));
    expect(r.source.split('\n')).toEqual([
      'System_Boundary(o, "O") {',
      '  Container_Boundary(i, "I") {',
      '    Component(c, "C")',
      '    Person(admin, "Admin")',
      '  }',
      '}',
    ]);
    expect(expectParses(r.source).elements.find((e) => e.id === 'admin')!.parent).toBe('i');
  });

  it('rejects boundaries that cannot take a pure insertion', () => {
    for (const src of [
      'System_Boundary(b, "B")',
      'System_Boundary(b, "B") { }',
      'System_Boundary(b, "B") {\n  System(s, "S")',
    ]) {
      const r = applyC4Edit(src, addPerson({ parent: 'b' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('boundary-cannot-take-children');
    }
  });

  it('rejects an unknown parent and a non-boundary parent', () => {
    for (const parent of ['nope', 'u']) {
      const r = applyC4Edit(SRC, addPerson({ parent }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('unknown-parent');
    }
  });
});

describe('applyC4Edit: line endings', () => {
  it('uses CRLF for CRLF files without touching other bytes', () => {
    const src = 'Person(u, "U")\r\nSystem(s, "S")\r\nRel(u, s, "x")\r\n';
    const r = apply(src, addPerson());
    expect(r.source).toBe('Person(u, "U")\r\nSystem(s, "S")\r\nPerson(admin, "Admin")\r\nRel(u, s, "x")\r\n');
    expectSingleLineInsertion(src, r.source, r.insertedLine, '\r\n');
  });

  it('appends after an unterminated final CRLF line with a CRLF', () => {
    const src = 'Person(u, "U")\r\nSystem(s, "S")';
    const r = apply(src, addPerson());
    expect(r.source).toBe('Person(u, "U")\r\nSystem(s, "S")\r\nPerson(admin, "Admin")');
  });

  it('inserts inside a CRLF boundary', () => {
    const src = 'System_Boundary(b, "B") {\r\n  System(s, "S")\r\n}\r\n';
    const r = apply(src, addPerson({ parent: 'b' }));
    expect(r.source).toBe('System_Boundary(b, "B") {\r\n  System(s, "S")\r\n  Person(admin, "Admin")\r\n}\r\n');
  });
});

describe('applyC4Edit: labels and aliases', () => {
  it('sanitises quotes, backslashes and newlines, and the result parses', () => {
    const r = apply(BASIC, addPerson({ label: 'He said "hi"\\\nnow' }));
    expect(r.label).toBe("He said 'hi'/ now");
    const el = expectParses(r.source).elements.find((e) => e.id === r.alias)!;
    expect(el.name).toBe("He said 'hi'/ now");
  });

  it('round-trips commas, parentheses, braces, apostrophes and non-ASCII', () => {
    for (const label of [
      'Web App (React)',
      'unbalanced ( paren',
      'close ) early',
      'a, b, c',
      'curly { brace',
      "it's fine",
      'Café — 日本語',
      ":) 'x",
    ]) {
      const r = apply(BASIC, addPerson({ label }));
      const d = expectParses(r.source);
      expect(d.elements.find((e) => e.id === r.alias)!.name).toBe(label);
      expect(d.elements).toHaveLength(3);
      expectSingleLineInsertion(BASIC, r.source, r.insertedLine);
    }
  });

  it('round-trips awkward labels inside a boundary', () => {
    const src = 'System_Boundary(b, "B") {\n  System(s, "S")\n}\nPerson(u, "U")';
    const r = apply(src, addPerson({ parent: 'b', label: 'x ) y { z' }));
    const d = expectParses(r.source);
    expect(d.elements.find((e) => e.id === r.alias)!.parent).toBe('b');
    expect(d.elements.find((e) => e.id === 'u')!.parent).toBeUndefined();
  });

  it('falls back to the placeholder for empty or whitespace labels', () => {
    expect(apply(BASIC, addPerson({ label: '' })).label).toBe('Person');
    expect(apply(BASIC, addPerson({ label: '   ', elementKind: 'containerDb' })).label).toBe('Database');
  });

  it('generates a unique alias when the label collides with an existing alias', () => {
    const r1 = apply(BASIC, addPerson({ label: 'User' }));
    expect(r1.alias).toBe('user_2');
    const r2 = apply(r1.source, addPerson({ label: 'User' }));
    expect(r2.alias).toBe('user_3');
    expect(expectParses(r2.source).elements.map((e) => e.id)).toEqual(['user', 'app', 'user_2', 'user_3']);
  });

  it('uses a per-kind fallback alias for labels that slug to nothing', () => {
    expect(apply(BASIC, addPerson({ label: '???' })).alias).toBe('person');
  });

  it('accepts a supplied alias and reports collisions instead of renaming', () => {
    expect(apply(BASIC, addPerson({ alias: 'ops' })).alias).toBe('ops');
    for (const alias of ['user', 'USER', 'Person', '__legend__']) {
      const r = applyC4Edit(BASIC, addPerson({ alias }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('alias-collision');
    }
    for (const alias of ['1x', 'a-b', '']) {
      const r = applyC4Edit(BASIC, addPerson({ alias }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-alias');
    }
  });

  it('reports a parse error for unparseable source', () => {
    const r = applyC4Edit('Person(', addPerson());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('parse-error');
  });

  it('sanitizeC4Text trims and never leaves quotes, backslashes or newlines', () => {
    expect(sanitizeC4Text('  a"b\\c\r\nd  ')).toBe("a'b/c  d");
  });
});

describe('applyC4Edit: add-relationship', () => {
  const rel = (over: Partial<Extract<C4Edit, { kind: 'add-relationship' }>> = {}): C4Edit => ({
    kind: 'add-relationship',
    sourceId: 'user',
    targetId: 'app',
    label: 'Uses',
    ...over,
  });

  it('inserts one Rel after the last top-level Rel', () => {
    const r = apply(BASIC, rel({ sourceId: 'app', targetId: 'user', label: 'Notifies' }));
    expect(r.insertedLine).toBe('Rel(app, user, "Notifies")');
    expect(r.source.split('\n')).toEqual([
      '@startuml',
      'Person(user, "User")',
      'System(app, "App")',
      'Rel(user, app, "Uses")',
      'Rel(app, user, "Notifies")',
      '@enduml',
    ]);
    expectSingleLineInsertion(BASIC, r.source, r.insertedLine);
    expect(expectParses(r.source).relationships).toHaveLength(2);
  });

  it('goes after the last top-level element when there is no Rel', () => {
    const src = 'Person(a, "A")\nSystem(b, "B")\n@enduml';
    const r = apply(src, rel({ sourceId: 'a', targetId: 'b' }));
    expect(r.source).toBe('Person(a, "A")\nSystem(b, "B")\nRel(a, b, "Uses")\n@enduml');
  });

  it('adds an optional technology argument', () => {
    const r = apply(BASIC, rel({ technology: 'HTTPS' }));
    expect(r.insertedLine).toBe('Rel(user, app, "Uses", "HTTPS")');
    expect(expectParses(r.source).relationships.at(-1)!.label).toBe('Uses [HTTPS]');
  });

  it('allows duplicate pairs', () => {
    const r = apply(BASIC, rel());
    expect(expectParses(r.source).relationships).toHaveLength(2);
  });

  it('is not confused by relationships inside boundaries', () => {
    const src = 'Person(u, "U")\nSystem_Boundary(b, "B") {\n  System(s, "S")\n  Rel(s, s2, "in")\n  System(s2, "S2")\n}\nSystem(t, "T")';
    const r = apply(src, { kind: 'add-relationship', sourceId: 'u', targetId: 't', label: 'x' });
    expect(r.source.split('\n').at(-1)).toBe('Rel(u, t, "x")');
    expectParses(r.source);
  });

  it('indents like the anchor line', () => {
    const src = '@startuml\n  Person(a, "A")\n  System(b, "B")\n@enduml';
    expect(apply(src, rel({ sourceId: 'a', targetId: 'b' })).insertedLine).toBe('  Rel(a, b, "Uses")');
  });

  it('sanitises the label, and an empty label stays empty', () => {
    expect(apply(BASIC, rel({ label: 'say "x"' })).insertedLine).toBe(`Rel(user, app, "say 'x'")`);
    const r = apply(BASIC, rel({ label: '' }));
    expect(r.insertedLine).toBe('Rel(user, app, "")');
    expectParses(r.source);
  });

  it('rejects unknown endpoints and self-relationships', () => {
    for (const [e, code] of [
      [rel({ sourceId: 'nope' }), 'unknown-endpoint'],
      [rel({ targetId: 'nope' }), 'unknown-endpoint'],
      [rel({ targetId: 'user' }), 'self-relationship'],
    ] as const) {
      const r = applyC4Edit(BASIC, e);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    }
  });
});

describe('applyC4Edit: byte-identity of everything else (FR-004)', () => {
  const FIXTURE_LINES = [
    "' a leading comment",
    '@startuml',
    '!include https://example.com/C4_Container.puml',
    'title Payments  ',
    'LAYOUT_LEFT_RIGHT()',
    'SHOW_LEGEND()',
    "' comment about the people",
    'Person(user, "User", "A user")   \' trailing comment',
    'Person_Ext(ext, "Ext")',
    'System_Boundary(b, "B") {',
    '  ' + "' inside comment",
    '  Container(api, "API", "Go", "does work")',
    '  ContainerDb(db, "DB", "PG")',
    '  Rel_D(api, db, "Reads", "SQL/TCP")',
    '}',
    "' relationships",
    'Rel(user, api, "Calls", "JSON/HTTPS")',
    'Rel_U(api, user, "Replies")',
    'BiRel(ext, api, "Sync")',
    'SHOW_LEGEND()',
    '@enduml',
  ];

  const variants: [string, string][] = [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ];
  const edits: [string, C4Edit][] = [
    ['top-level element', { kind: 'add-element', elementKind: 'system', label: 'Billing' }],
    ['element in boundary', { kind: 'add-element', elementKind: 'component', label: 'Cache', parent: 'b' }],
    ['relationship', { kind: 'add-relationship', sourceId: 'ext', targetId: 'db', label: 'Feeds' }],
  ];

  for (const [name, eol] of variants) {
    for (const [editName, edit] of edits) {
      it(`${editName} (${name}) inserts exactly one line and keeps all else`, () => {
        const src = FIXTURE_LINES.join(eol);
        const r = apply(src, edit);
        expectSingleLineInsertion(src, r.source, r.insertedLine, eol);
        // Every original line survives, in order, byte-identical.
        const after = r.source.split(eol);
        const originals = src.split(eol);
        let j = 0;
        for (const line of after) if (line === originals[j]) j++;
        expect(j).toBe(originals.length);
        const d = expectParses(r.source);
        expect(d.elements.length + d.relationships.length).toBe(
          expectParses(src).elements.length + expectParses(src).relationships.length + 1,
        );
      });
    }
  }

  it('keeps the tab-indented variant intact', () => {
    const src = FIXTURE_LINES.map((l) => l.replace(/^ {2}/, '\t')).join('\n');
    const r = apply(src, { kind: 'add-element', elementKind: 'component', label: 'Cache', parent: 'b' });
    expect(r.insertedLine.startsWith('\t')).toBe(true);
    expectSingleLineInsertion(src, r.source, r.insertedLine);
  });

  it('adds a relationship when boundary relationships follow the last top-level Rel', () => {
    const src = [
      '@startuml',
      'Person(a, "A")',
      'System(b, "B")',
      'Rel(a, b, "x")',
      'System_Boundary(bd, "BD") {',
      '  Container(c, "C")',
      '  Container(d, "D")',
      '  Rel(c, d, "1")',
      '  Rel(d, c, "2")',
      '}',
      '@enduml',
    ].join('\n');
    const r = applyC4Edit(src, { kind: 'add-relationship', sourceId: 'b', targetId: 'a', label: 'Uses' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectSingleLineInsertion(src, r.source, r.insertedLine);
    expect(parseC4(r.source).errors).toEqual([]);
  });
});
