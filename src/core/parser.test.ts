import { describe, it, expect } from 'vitest';
import { parseC4, parseC4WithSpans, validateC4 } from './parser';

describe('C4-PlantUML Parser', () => {
  describe('basic parsing', () => {
    it('should parse empty input', () => {
      const result = parseC4('');
      expect(result.errors).toHaveLength(0);
      expect(result.diagram).not.toBeNull();
      expect(result.diagram!.elements).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(0);
    });

    it('should skip @startuml/@enduml wrappers', () => {
      const result = parseC4(`
@startuml
Person(user, "User", "A user")
@enduml
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });

    it('should skip !include directives', () => {
      const result = parseC4(`
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
Person(user, "User", "A user")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });

    it('should skip SHOW_LEGEND and LAYOUT directives', () => {
      const result = parseC4(`
LAYOUT_TOP_DOWN()
Person(user, "User")
SHOW_LEGEND()
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });

    it('should skip title directives', () => {
      const result = parseC4(`
title System Context — My App
Person(user, "User")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });

    it('should handle single-line comments', () => {
      const result = parseC4(`
' This is a comment
Person(user, "User", "A user")
' Another comment
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });
  });

  describe('element macros', () => {
    it('should parse Person', () => {
      const result = parseC4('Person(user, "User", "A knowledge worker")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('person');
      expect(el.id).toBe('user');
      expect(el.name).toBe('User');
      expect(el.properties.description).toBe('A knowledge worker');
      expect(el.properties.external).toBeUndefined();
    });

    it('should parse Person_Ext', () => {
      const result = parseC4('Person_Ext(admin, "Admin", "External admin")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('person');
      expect(el.properties.external).toBe(true);
    });

    it('should parse System', () => {
      const result = parseC4('System(app, "My App", "The main application")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('system');
      expect(el.id).toBe('app');
      expect(el.name).toBe('My App');
      expect(el.properties.description).toBe('The main application');
    });

    it('should parse System_Ext', () => {
      const result = parseC4('System_Ext(email, "Email System", "Sends emails")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('system');
      expect(el.properties.external).toBe(true);
    });

    it('should parse SystemDb', () => {
      const result = parseC4('SystemDb(db, "Database", "Stores data")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('system');
      expect(el.properties.shape).toBe('cylinder');
    });

    it('should parse Container with technology', () => {
      const result = parseC4('Container(api, "API Server", "Java/Spring", "Handles requests")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('container');
      expect(el.id).toBe('api');
      expect(el.name).toBe('API Server');
      expect(el.properties.tech).toBe('Java/Spring');
      expect(el.properties.description).toBe('Handles requests');
    });

    it('should parse ContainerDb', () => {
      const result = parseC4('ContainerDb(db, "Database", "PostgreSQL", "Stores data")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('container');
      expect(el.properties.shape).toBe('cylinder');
      expect(el.properties.tech).toBe('PostgreSQL');
    });

    it('should parse Container_Ext', () => {
      const result = parseC4('Container_Ext(ext, "External API", "REST", "Third party")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('container');
      expect(el.properties.external).toBe(true);
    });

    it('should parse ContainerQueue', () => {
      const result = parseC4('ContainerQueue(mq, "Message Queue", "RabbitMQ", "Async messaging")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('container');
      expect(el.properties.shape).toBe('queue');
      expect(el.properties.tech).toBe('RabbitMQ');
    });

    it('should parse SystemQueue_Ext', () => {
      const result = parseC4('SystemQueue_Ext(events, "Event Bus", "External event stream")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('system');
      expect(el.properties.shape).toBe('queue');
      expect(el.properties.external).toBe(true);
    });

    it('should parse Component with technology', () => {
      const result = parseC4('Component(ctrl, "Controller", "Spring MVC", "Handles HTTP requests")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.type).toBe('component');
      expect(el.properties.tech).toBe('Spring MVC');
      expect(el.properties.description).toBe('Handles HTTP requests');
    });

    it('should handle minimal args (alias and label only)', () => {
      const result = parseC4('Person(user, "User")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.id).toBe('user');
      expect(el.name).toBe('User');
      expect(el.properties.description).toBeUndefined();
    });

    it('should use alias as name when label is missing', () => {
      const result = parseC4('System(myapp)');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.id).toBe('myapp');
      expect(el.name).toBe('myapp');
    });
  });

  describe('boundaries', () => {
    it('should parse System_Boundary with children', () => {
      const result = parseC4(`
System_Boundary(app, "My Application") {
  Container(web, "Web App", "React", "Delivers UI")
  Container(api, "API", "Node.js", "Business logic")
}
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(3);

      const boundary = result.diagram!.elements[0];
      expect(boundary.type).toBe('system');
      expect(boundary.properties.style).toBe('boundary');
      expect(boundary.children).toHaveLength(2);
      expect(boundary.children[0].id).toBe('web');
      expect(boundary.children[1].id).toBe('api');
    });

    it('should parse Container_Boundary', () => {
      const result = parseC4(`
Container_Boundary(api, "API Layer") {
  Component(ctrl, "Controller", "Spring MVC")
  Component(svc, "Service", "Java")
}
      `);
      expect(result.errors).toHaveLength(0);
      const boundary = result.diagram!.elements[0];
      expect(boundary.type).toBe('container');
      expect(boundary.properties.style).toBe('boundary');
      expect(boundary.children).toHaveLength(2);
    });

    it('should set parent references on children', () => {
      const result = parseC4(`
System_Boundary(app, "App") {
  Container(web, "Web", "React")
}
      `);
      expect(result.errors).toHaveLength(0);
      const child = result.diagram!.elements.find((e) => e.id === 'web');
      expect(child?.parent).toBe('app');
    });

    it('should handle nested boundaries', () => {
      const result = parseC4(`
System_Boundary(app, "App") {
  Container_Boundary(backend, "Backend") {
    Component(api, "API", "Express")
  }
}
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(3);
      const api = result.diagram!.elements.find((e) => e.id === 'api');
      expect(api?.parent).toBe('backend');
    });

    it('should handle Enterprise_Boundary', () => {
      const result = parseC4(`
Enterprise_Boundary(corp, "Acme Corp") {
  System(crm, "CRM", "Customer management")
}
      `);
      expect(result.errors).toHaveLength(0);
      const boundary = result.diagram!.elements[0];
      expect(boundary.properties.style).toBe('boundary');
    });
  });

  describe('relationships', () => {
    it('should parse simple Rel', () => {
      const result = parseC4(`
Person(user, "User")
System(app, "App")
Rel(user, app, "Uses")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(1);
      const rel = result.diagram!.relationships[0];
      expect(rel.sourceId).toBe('user');
      expect(rel.targetId).toBe('app');
      expect(rel.label).toBe('Uses');
    });

    it('should parse Rel with technology', () => {
      const result = parseC4(`
Person(user, "User")
Container(api, "API", "REST")
Rel(user, api, "Calls", "HTTPS")
      `);
      expect(result.errors).toHaveLength(0);
      const rel = result.diagram!.relationships[0];
      expect(rel.label).toBe('Calls [HTTPS]');
    });

    it('should parse directional relationships', () => {
      const result = parseC4(`
Person(user, "User")
System(app, "App")
Rel_D(user, app, "Uses")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(1);
    });

    it('should parse BiRel', () => {
      const result = parseC4(`
System(a, "A")
System(b, "B")
BiRel(a, b, "Syncs with")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(1);
      expect(result.diagram!.relationships[0].label).toBe('Syncs with');
    });

    it('should parse multiple relationships', () => {
      const result = parseC4(`
Person(user, "User")
System(web, "Web")
System(api, "API")
Rel(user, web, "Browses")
Rel(web, api, "Calls", "REST")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(2);
    });
  });

  describe('complete diagrams', () => {
    it('should parse the system context example from issue #429 test doc', () => {
      const result = parseC4(`
title System Context — Liminis Notes

Person(user, "User", "Knowledge worker managing notes and projects")

System(liminis, "Liminis", "Personal knowledge management system with AI assistance")

System_Ext(confluence, "Confluence", "Team wiki for publishing and sharing docs")
System_Ext(github, "GitHub", "Code and issue tracking")
System_Ext(claude, "Claude API", "AI backbone for analysis and generation")

Rel(user, liminis, "Writes notes, queries knowledge")
Rel(liminis, confluence, "Publishes documents to")
Rel(liminis, github, "Creates issues, reads PRs")
Rel(liminis, claude, "Sends prompts, receives responses")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(5);
      expect(result.diagram!.relationships).toHaveLength(4);

      const confluence = result.diagram!.elements.find((e) => e.id === 'confluence');
      expect(confluence?.properties.external).toBe(true);
    });

    it('should parse the container diagram example from issue #429 test doc', () => {
      const result = parseC4(`
Person(user, "User", "Knowledge worker")

System_Boundary(liminis, "Liminis") {
  Container(app, "Electron App", "Electron + React", "Renders markdown, manages UI")
  Container(framework, "Liminis Framework", "Node.js", "Orchestrates skills, tools, and agents")
  ContainerDb(workspace, "Workspace", "File system", "Markdown notes, config, skills")
  Container(contextGraph, "Knowledge Graph", "Neo4j + Graphiti", "Temporal entity and relationship store")
  Container(semantic, "Semantic Search", "Vector DB", "Embedding-based document search")
}

Rel(user, app, "Reads and writes notes")
Rel(app, framework, "Delegates AI tasks to")
Rel(framework, workspace, "Reads/writes files")
Rel(framework, contextGraph, "Queries and updates entities")
Rel(framework, semantic, "Indexes and searches documents")
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(7);
      expect(result.diagram!.relationships).toHaveLength(5);

      const boundary = result.diagram!.elements.find((e) => e.id === 'liminis');
      expect(boundary?.properties.style).toBe('boundary');
      expect(boundary?.children).toHaveLength(5);

      const workspace = result.diagram!.elements.find((e) => e.id === 'workspace');
      expect(workspace?.properties.shape).toBe('cylinder');
      expect(workspace?.properties.tech).toBe('File system');
    });

    it('should parse a full diagram with wrappers and directives', () => {
      const result = parseC4(`
@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

LAYOUT_TOP_DOWN()

Person(customer, "Customer", "End user of the system")

System_Boundary(app, "My Application") {
  Container(web, "Web App", "Angular", "Delivers the SPA")
  Container(api, "API Server", "Java/Spring", "Business logic")
  ContainerDb(db, "Database", "PostgreSQL", "Stores data")
}

System_Ext(email, "Email System", "Sends emails")

Rel(customer, web, "Uses", "HTTPS")
Rel(web, api, "Calls", "REST/JSON")
Rel(api, db, "Reads/Writes", "JDBC")
Rel(api, email, "Sends via", "SMTP")

SHOW_LEGEND()
@enduml
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(6);
      expect(result.diagram!.relationships).toHaveLength(4);
    });
  });

  describe('error handling', () => {
    it('should report unrecognized syntax', () => {
      const result = parseC4('this is not valid C4');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].line).toBe(1);
    });

    it('should report missing closing paren', () => {
      const result = parseC4('Person(user, "User"');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("missing closing ')'");
    });

    it('should report missing alias', () => {
      const result = parseC4('Person()');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('missing alias');
    });

    it('should report insufficient rel args', () => {
      const result = parseC4('Rel(a, b)');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('at least 3 arguments');
    });

    it('should return null diagram when there are parse errors', () => {
      const result = parseC4(`
this is invalid
Person(user, "User")
also invalid
System(app, "App")
      `);
      expect(result.errors.length).toBe(2);
      // Diagram should be null when there are errors (per ParseResult contract)
      expect(result.diagram).toBeNull();
    });

    it('should report unknown macros', () => {
      const result = parseC4('FooBar(x, "Y")');
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain('Unknown macro');
    });

    it('should not infinite loop on invalid input', () => {
      const start = Date.now();
      const result = parseC4(`
title System Context — Liminis Notes
Person(user, "User", "Knowledge worker")
System(liminis, "Liminis", "Main system")
Rel(user, liminis, "Uses")
      `);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
      expect(result.diagram).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle commas inside quoted strings', () => {
      const result = parseC4('Container(api, "API Server", "Java, Spring", "Handles requests, responses")');
      expect(result.errors).toHaveLength(0);
      const el = result.diagram!.elements[0];
      expect(el.properties.tech).toBe('Java, Spring');
      expect(el.properties.description).toBe('Handles requests, responses');
    });

    it('should handle inline comments', () => {
      const result = parseC4("Person(user, \"User\") ' This is a user");
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });

    it('should handle Windows line endings', () => {
      const result = parseC4("Person(user, \"User\")\r\nSystem(app, \"App\")");
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(2);
    });
  });

  describe('validateC4', () => {
    it('should detect duplicate IDs', () => {
      const result = parseC4(`
Person(user, "User")
System(user, "System with same ID")
      `);
      const errors = validateC4(result.diagram!);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Duplicate element ID');
    });

    it('should detect missing relationship targets', () => {
      const result = parseC4(`
Person(user, "User")
Rel(user, nonexistent, "Uses")
      `);
      const errors = validateC4(result.diagram!);
      expect(errors.some((e) => e.message.includes("'nonexistent' not found"))).toBe(true);
    });

    it('should pass for valid diagrams', () => {
      const result = parseC4(`
Person(user, "User")
System(app, "App")
Rel(user, app, "Uses")
      `);
      const errors = validateC4(result.diagram!);
      expect(errors).toHaveLength(0);
    });
  });
});

describe('parseC4WithSpans', () => {
  it('returns the same diagram and errors as parseC4', () => {
    const src = `@startuml\nPerson(u, "U")\nSystem_Boundary(b, "B") {\n  System(s, "S")\n}\nRel(u, s, "x", "t")\n@enduml`;
    const plain = parseC4(src);
    const withSpans = parseC4WithSpans(src);
    expect(withSpans.diagram).toEqual(plain.diagram);
    expect(withSpans.errors).toEqual(plain.errors);
  });

  it('records element lines, boundary close lines and parents', () => {
    const src = `@startuml\nPerson(u, "U")\nSystem_Boundary(b, "B") {\n  System(s, "S")\n  Rel(s, s, "x")\n}\nRel(u, s, "y")\n@enduml`;
    const { diagram, spans } = parseC4WithSpans(src);
    expect(diagram!.elements.map((e) => e.id)).toEqual(['u', 'b', 's']);
    expect(spans.elements.map(({ line, closeLine, parent }) => ({ line, closeLine, parent }))).toEqual([
      { line: 1 },
      { line: 2, closeLine: 5 },
      { line: 3, parent: 'b' },
    ]);
    expect(spans.relationships.map(({ line, parent }) => ({ line, parent }))).toEqual([
      { line: 4, parent: 'b' },
      { line: 6 },
    ]);
  });

  it('gives no closeLine to an unterminated block, a single-line block or a brace-less boundary', () => {
    expect(parseC4WithSpans('System_Boundary(a, "A") {\nSystem(s, "S")').spans.elements[0].closeLine).toBeUndefined();
    expect(parseC4WithSpans('System_Boundary(a, "A") { }').spans.elements[0].closeLine).toBeUndefined();
    expect(parseC4WithSpans('System_Boundary(a, "A")').spans.elements[0].closeLine).toBeUndefined();
  });
});

describe('quote-aware parsing (round-trip safety for inserted labels)', () => {
  it('ignores parentheses inside quoted arguments', () => {
    const r = parseC4('Person(a, "x) y")\nSystem(b, "Web App (React)")\nSystem(c, ":)")');
    expect(r.errors).toEqual([]);
    expect(r.diagram!.elements.map((e) => e.name)).toEqual(['x) y', 'Web App (React)', ':)']);
  });

  it('does not treat a { in a leaf label as opening a block', () => {
    const r = parseC4('Person(a, "a {")\nPerson(b, "B")');
    expect(r.errors).toEqual([]);
    expect(r.diagram!.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.diagram!.elements.every((e) => e.parent === undefined)).toBe(true);
  });

  it('still opens a boundary block, ignoring braces inside its label', () => {
    const r = parseC4('System_Boundary(b, "B {x}") {\n  System(s, "S")\n}');
    expect(r.errors).toEqual([]);
    expect(r.diagram!.elements.find((e) => e.id === 's')!.parent).toBe('b');
  });
});

describe('label ranges and relationship technology', () => {
  /** The text a span's labelRange covers on the given source line. */
  const covered = (src: string, line: number, range?: { start: number; end: number }) =>
    range ? src.split('\n')[line].slice(range.start, range.end) : undefined;

  it('covers the label argument of every element macro family', () => {
    const macros = [
      'Person', 'Person_Ext', 'System', 'SystemDb', 'SystemQueue_Ext', 'Container', 'ContainerDb_Ext',
      'ComponentQueue', 'System_Boundary', 'Deployment_Node', 'InfrastructureNode',
    ];
    for (const m of macros) {
      const src = `${m}(a, "Label, (x)", "d", "e") ' note`;
      const { spans, errors } = parseC4WithSpans(src);
      expect(errors).toEqual([]);
      expect(covered(src, 0, spans.elements[0].labelRange)).toBe('"Label, (x)"');
    }
  });

  it('covers the label argument of Rel, Rel_*, and BiRel lines, including indentation', () => {
    for (const m of ['Rel', 'Rel_D', 'Rel_Back', 'BiRel', 'BiRel_L']) {
      const src = `Person(a, "A")\nSystem(b, "B")\n\t  ${m}(a, b, "Uses", "HTTPS") ' Uses`;
      const { spans } = parseC4WithSpans(src);
      expect(covered(src, 2, spans.relationships[0].labelRange)).toBe('"Uses"');
    }
  });

  it('handles odd spacing, an empty label, an unquoted label and a CR line ending', () => {
    let src = 'Person( a ,  "A"  , "d" )\r\nRel( a ,b , "x" )\r\nRel(a, b, "")\nRel(a, b,   Uses HTTP  )';
    const { spans } = parseC4WithSpans(src);
    expect(covered(src, 0, spans.elements[0].labelRange)).toBe('"A"');
    expect(covered(src, 1, spans.relationships[0].labelRange)).toBe('"x"');
    expect(covered(src, 2, spans.relationships[1].labelRange)).toBe('""');
    expect(covered(src, 3, spans.relationships[2].labelRange)).toBe('Uses HTTP');
    src = 'Person(a)';
    expect(parseC4WithSpans(src).spans.elements[0].labelRange).toBeUndefined();
  });

  it('indexes arguments the way the parser does: empty arguments are dropped', () => {
    const src = 'Rel(a, b, , "x")';
    const { diagram, spans } = parseC4WithSpans(src);
    expect(diagram!.relationships[0].label).toBe('x');
    expect(covered(src, 0, spans.relationships[0].labelRange)).toBe('"x"');
  });

  it('is not fooled by the label text appearing elsewhere on the line', () => {
    const src = 'Container(Web, "Web", "Web", "Web") \' Web';
    const { spans } = parseC4WithSpans(src);
    expect(spans.elements[0].labelRange).toEqual({ start: 15, end: 20 });
  });

  it('gives no range to a $named label argument', () => {
    const { spans } = parseC4WithSpans('Person(a, $tags="x")\nRel(a, a, $tags="y")');
    expect(spans.elements[0].labelRange).toBeUndefined();
    expect(spans.relationships[0].labelRange).toBeUndefined();
  });

  it('records technology on a relationship only when it is non-empty', () => {
    const { diagram } = parseC4WithSpans('Rel(a, b, "Uses", "HTTPS")\nRel(a, b, "Uses", "")\nRel(a, b, "Uses")');
    expect(diagram!.relationships[0]).toEqual({ sourceId: 'a', targetId: 'b', label: 'Uses [HTTPS]', technology: 'HTTPS' });
    expect('technology' in diagram!.relationships[1]).toBe(false);
    expect('technology' in diagram!.relationships[2]).toBe(false);
  });
});
