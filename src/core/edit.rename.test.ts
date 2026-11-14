import { describe, it, expect } from 'vitest';
import { applyC4Edit, type C4Edit, type C4RenameTarget } from './edit';
import { parseC4, parseC4WithSpans } from './parser';

const rename = (target: C4RenameTarget, label: string): C4Edit => ({ kind: 'rename', target, label });
const el = (alias: string, label: string) => rename({ element: alias }, label);

/** The rename target for relationship `index` as the renderer would report it. */
function relTarget(source: string, index: number): C4RenameTarget {
  const r = parseC4(source).diagram!.relationships[index];
  return { relationship: { index, sourceId: r.sourceId, targetId: r.targetId, label: r.label } };
}

function ok(source: string, edit: C4Edit) {
  const r = applyC4Edit(source, edit);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

/**
 * Assert `after` is `before` with the first `oldText` replaced by `newText`:
 * one contiguous span changed, and it is that one.
 */
function expectOnlyReplaced(before: string, after: string, oldText: string, newText: string) {
  const idx = before.indexOf(oldText);
  expect(idx).toBeGreaterThanOrEqual(0);
  expect(before.slice(0, idx) + newText + before.slice(idx + oldText.length)).toBe(after);
}

function expectSameModelExcept(before: string, after: string) {
  const a = parseC4(before);
  const b = parseC4(after);
  expect(b.errors).toEqual([]);
  expect(b.diagram!.elements.map((e) => [e.id, e.parent, e.type, e.properties])).toEqual(
    a.diagram!.elements.map((e) => [e.id, e.parent, e.type, e.properties]),
  );
  expect(b.diagram!.relationships.map((r) => [r.sourceId, r.targetId])).toEqual(
    a.diagram!.relationships.map((r) => [r.sourceId, r.targetId]),
  );
}

const ELEMENT_MACROS = [
  'Person', 'Person_Ext', 'System', 'System_Ext', 'SystemDb', 'SystemDb_Ext', 'SystemQueue', 'SystemQueue_Ext',
  'Container', 'Container_Ext', 'ContainerDb', 'ContainerDb_Ext', 'ContainerQueue', 'ContainerQueue_Ext',
  'Component', 'Component_Ext', 'ComponentDb', 'ComponentDb_Ext', 'ComponentQueue', 'ComponentQueue_Ext',
  'InfrastructureNode', 'InfrastructureNode_Ext',
];

describe('rename: element macro families', () => {
  it.each(ELEMENT_MACROS)('%s: only the label argument changes', (macro) => {
    const line = `${macro}(x, "Old, (name)", "Old tech", "Old description", $tags="t") ' Old comment`;
    const src = `@startuml\n${line}\n@enduml\n`;
    const r = ok(src, el('x', 'New name'));
    expectOnlyReplaced(src, r.source, '"Old, (name)"', '"New name"');
    expect(r.source).toContain(`${macro}(x, "New name", "Old tech", "Old description", $tags="t") ' Old comment`);
    expect(r.label).toBe('New name');
    expect(r.insertedLine).toBe(`${macro}(x, "New name", "Old tech", "Old description", $tags="t") ' Old comment`);
    expectSameModelExcept(src, r.source);
    expect(parseC4(r.source).diagram!.elements[0].name).toBe('New name');
  });

  it.each(['System_Boundary', 'Container_Boundary', 'Enterprise_Boundary', 'Boundary', 'Deployment_Node', 'Node_L'])(
    'boundary %s renames headlessly, keeping its block',
    (macro) => {
      const src = `${macro}(b, "Old", "tech") {\n  Person(p, "P")\n}\n`;
      const r = ok(src, el('b', 'New'));
      expect(r.source).toBe(`${macro}(b, "New", "tech") {\n  Person(p, "P")\n}\n`);
      expectSameModelExcept(src, r.source);
    },
  );
});

describe('rename: relationship macros', () => {
  const RELS = [
    'Rel', 'Rel_Back', 'Rel_Neighbor', 'Rel_D', 'Rel_U', 'Rel_L', 'Rel_R',
    'BiRel', 'BiRel_D', 'BiRel_U', 'BiRel_L', 'BiRel_R',
  ];
  it.each(RELS)('%s: technology, variant and comment survive', (macro) => {
    const src = `Person(a, "A")\nSystem(b, "B")\n${macro}(a, b, "Uses", "HTTPS", $tags="t") ' Uses HTTPS\n`;
    const r = ok(src, rename(relTarget(src, 0), 'Calls'));
    expect(r.source).toBe(`Person(a, "A")\nSystem(b, "B")\n${macro}(a, b, "Calls", "HTTPS", $tags="t") ' Uses HTTPS\n`);
    expectOnlyReplaced(src, r.source, '"Uses"', '"Calls"');
    expect(parseC4(r.source).diagram!.relationships[0].label).toBe('Calls [HTTPS]');
    expectSameModelExcept(src, r.source);
  });

  it('renames only the targeted one of two relationships between the same pair', () => {
    const src = 'Person(a, "A")\nSystem(b, "B")\nRel(a, b, "Uses")\nRel(a, b, "Uses")\n';
    const r = ok(src, rename(relTarget(src, 1), 'Second'));
    expect(r.source).toBe('Person(a, "A")\nSystem(b, "B")\nRel(a, b, "Uses")\nRel(a, b, "Second")\n');
  });

  it('renames a relationship inside a boundary block, keeping indentation', () => {
    const src = 'System_Boundary(g, "G") {\n  System(s, "S")\n  System(t, "T")\n\t  Rel(s, t, "Uses")\n}\n';
    const r = ok(src, rename(relTarget(src, 0), 'Feeds'));
    expect(r.source).toBe('System_Boundary(g, "G") {\n  System(s, "S")\n  System(t, "T")\n\t  Rel(s, t, "Feeds")\n}\n');
  });

  it('renames an element inside a boundary block, keeping indentation', () => {
    const src = 'System_Boundary(g, "G") {\n    System(s, "S")\n}\n';
    expect(ok(src, el('s', 'Z')).source).toBe('System_Boundary(g, "G") {\n    System(s, "Z")\n}\n');
  });
});

describe('rename: odd label arguments', () => {
  it('replaces an empty relationship label in place', () => {
    const src = 'Rel(a, b, "")\nPerson(a, "A")\nPerson(b, "B")';
    const r = ok(src, rename(relTarget(src, 0), 'Now named'));
    expect(r.source.split('\n')[0]).toBe('Rel(a, b, "Now named")');
  });

  it('replaces an empty element label in place', () => {
    const r = ok('Person(a, "", "desc")', el('a', 'Alice'));
    expect(r.source).toBe('Person(a, "Alice", "desc")');
  });

  it('copes with odd spacing and tabs', () => {
    const src = 'Person( a ,b )\nSystem(b, "B")\n\tRel( a ,b ,\t"x"\t)  \' c';
    const r = ok(src, rename(relTarget(src, 0), 'y'));
    expect(r.source).toBe('Person( a ,b )\nSystem(b, "B")\n\tRel( a ,b ,\t"y"\t)  \' c');
    expect(parseC4(r.source).errors).toEqual([]);
  });

  it('quotes an unquoted label', () => {
    const src = 'Person(a, "A")\nSystem(b, "B")\nRel(a, b, Uses HTTP, "tech")';
    const r = ok(src, rename(relTarget(src, 0), 'Calls'));
    expect(r.source).toBe('Person(a, "A")\nSystem(b, "B")\nRel(a, b, "Calls", "tech")');
    expect(ok('Person(a, Alice)', el('a', 'Bob')).source).toBe('Person(a, "Bob")');
  });

  it('patches the label argument, not an earlier textual match, and not a dropped empty argument', () => {
    const r1 = ok('Container(Web, "Web", "Web", "Web") \' Web', el('Web', 'Site'));
    expect(r1.source).toBe('Container(Web, "Site", "Web", "Web") \' Web');
    const src = 'Person(a, "A")\nSystem(b, "B")\nRel(a, b, , "x")';
    expect(ok(src, rename(relTarget(src, 0), 'y')).source).toBe('Person(a, "A")\nSystem(b, "B")\nRel(a, b, , "y")');
  });

  it('only touches the targeted line when aliases are substrings of other aliases and labels', () => {
    const src = 'Person(a, "ab")\nPerson(ab, "a")\nPerson(abc, "ab")\n';
    expect(ok(src, el('a', 'Z')).source).toBe('Person(a, "Z")\nPerson(ab, "a")\nPerson(abc, "ab")\n');
    expect(ok(src, el('ab', 'Z')).source).toBe('Person(a, "ab")\nPerson(ab, "Z")\nPerson(abc, "ab")\n');
  });

  it('round-trips commas, parentheses and non-ASCII', () => {
    const r = ok('Person(a, "A")', el('a', 'Café, (Münster) 日本語'));
    expect(parseC4(r.source).diagram!.elements[0].name).toBe('Café, (Münster) 日本語');
  });

  it('rejects an element with no label argument', () => {
    const r = applyC4Edit('Person(a)', el('a', 'X'));
    expect(r).toMatchObject({ ok: false, code: 'no-label-argument' });
  });

  it('rejects a $named label argument rather than dropping the keyword', () => {
    expect(applyC4Edit('Person(a, $tags="x")', el('a', 'X'))).toMatchObject({ ok: false, code: 'no-label-argument' });
  });

  it('rejects a Rel with no label as a parse error', () => {
    expect(applyC4Edit('Person(a, "A")\nRel(a, a)', el('a', 'X'))).toMatchObject({ ok: false, code: 'parse-error' });
  });
});

describe('rename: line endings', () => {
  it('preserves CRLF byte for byte', () => {
    const src = 'Person(a, "A") \' c\r\nSystem(b, "B")\r\nRel(a, b, "Uses")\r\n';
    const r = ok(src, rename(relTarget(src, 0), 'Calls'));
    expect(r.source).toBe('Person(a, "A") \' c\r\nSystem(b, "B")\r\nRel(a, b, "Calls")\r\n');
    expect(r.insertedLine).toBe('Rel(a, b, "Calls")');
    expect(ok(src, el('a', 'Z')).source).toBe('Person(a, "Z") \' c\r\nSystem(b, "B")\r\nRel(a, b, "Uses")\r\n');
  });

  it('handles the last line with no trailing newline', () => {
    const src = 'Person(a, "A")\nSystem(b, "B")';
    expect(ok(src, el('b', 'Z')).source).toBe('Person(a, "A")\nSystem(b, "Z")');
  });
});

describe('rename: label rules', () => {
  it('sanitises like add', () => {
    const r = ok('Person(a, "A")', el('a', 'say "hi"\\there\u0007\nnow'));
    expect(r.label).toBe("say 'hi'/there  now");
    expect(parseC4(r.source).errors).toEqual([]);
    expect(parseC4(r.source).diagram!.elements[0].name).toBe("say 'hi'/there  now");
  });

  it('falls back to the placeholder for an empty or whitespace label', () => {
    const src = [
      'Person(p, "x")', 'Person_Ext(pe, "x")', 'System(s, "x")', 'SystemDb(d, "x")', 'ContainerQueue(q, "x")',
      'Container(c, "x", "t")', 'Component(m, "x")', 'System_Boundary(b, "x") {', '}', 'Node(n, "x") {', '}',
    ].join('\n');
    const labels = (alias: string) => ok(src, el(alias, '  ')).label;
    expect(labels('p')).toBe('Person');
    expect(labels('pe')).toBe('Person');
    expect(labels('s')).toBe('System');
    expect(labels('d')).toBe('Database');
    expect(labels('q')).toBe('Queue');
    expect(labels('c')).toBe('Container');
    expect(labels('m')).toBe('Component');
    expect(labels('b')).toBe('Boundary');
    expect(labels('n')).toBe('Boundary');
    const rs = 'Person(a, "A")\nSystem(b, "B")\nRel(a, b, "Calls", "HTTPS")';
    const r = ok(rs, rename(relTarget(rs, 0), ''));
    expect(r.label).toBe('Uses');
    expect(r.source).toBe('Person(a, "A")\nSystem(b, "B")\nRel(a, b, "Uses", "HTTPS")');
  });

  it('returns the source unchanged when the label is unchanged', () => {
    const src = 'Person(a, "A")  \nSystem(b, "B")\nRel(a, b, "Uses")';
    expect(ok(src, el('a', 'A')).source).toBe(src);
    expect(ok(src, el('a', '  A ')).source).toBe(src);
    expect(ok(src, rename(relTarget(src, 0), 'Uses')).source).toBe(src);
    expect(ok(src, rename(relTarget(src, 0), '')).source).toBe(src); // placeholder equals current
  });
});

describe('rename: failures change nothing', () => {
  const src = 'Person(a, "A")\nSystem(b, "B")\nRel(a, b, "Uses", "HTTPS")\nRel(b, a, "Back")\n';

  it('fails for an unknown alias', () => {
    expect(applyC4Edit(src, el('nope', 'X'))).toMatchObject({ ok: false, code: 'unknown-element' });
  });

  it('fails for a stale relationship target instead of patching another one', () => {
    const t = relTarget(src, 0) as { relationship: { index: number; sourceId: string; targetId: string; label: string } };
    // label is the combined string; the bare label is not enough
    const bare = { relationship: { ...t.relationship, label: 'Uses' } };
    expect(applyC4Edit(src, rename(bare, 'X'))).toMatchObject({ ok: false, code: 'stale-target' });
    // the host's text lost the first relationship: index 0 now holds a different one
    const shifted = src.replace('Rel(a, b, "Uses", "HTTPS")\n', '');
    expect(applyC4Edit(shifted, rename(t, 'X'))).toMatchObject({ ok: false, code: 'stale-target' });
    // out of range, negative, fractional
    for (const index of [9, -1, 0.5]) {
      expect(applyC4Edit(src, rename({ relationship: { ...t.relationship, index } }, 'X'))).toMatchObject({
        ok: false,
        code: 'stale-target',
      });
    }
  });

  it('fails when the source does not parse', () => {
    expect(applyC4Edit('Person(a, "A"\nbogus line', el('a', 'X'))).toMatchObject({ ok: false, code: 'parse-error' });
  });
});

describe('rename: every result re-parses with the same model', () => {
  it('across a mixed source, for every element and relationship', () => {
    const src = [
      "@startuml",
      "!include C4_Container.puml",
      "LAYOUT_TOP_DOWN()",
      'Person(u, "User", "A person") \' who',
      'System_Boundary(sb, "Shop") {',
      '  Container(web, "Web", "React", "Storefront")',
      '  ContainerDb(db, "DB", "Postgres")',
      '  Rel_D(web, db, "Reads", "SQL")',
      '}',
      'System_Ext(pay, "Payments")',
      'Rel(u, web, "Browses", "HTTPS")',
      'BiRel(web, pay, "Charges")',
      "@enduml",
    ].join('\n');
    const d = parseC4(src).diagram!;
    const edits: C4Edit[] = [
      ...d.elements.map((e) => el(e.id, `New ${e.id}`)),
      ...d.relationships.map((_, i) => rename(relTarget(src, i), `New rel ${i}`)),
    ];
    for (const edit of edits) {
      const r = ok(src, edit);
      expectSameModelExcept(src, r.source);
      expect(parseC4WithSpans(r.source).spans.elements.map((s) => s.line)).toEqual(
        parseC4WithSpans(src).spans.elements.map((s) => s.line),
      );
      expect(r.source.split('\n').length).toBe(src.split('\n').length);
    }
  });
});
