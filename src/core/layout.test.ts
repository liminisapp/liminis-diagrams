import { describe, it, expect } from 'vitest';
import { layoutC4Diagram, EMPTY_BOUNDARY_SIZE } from './layout';
import { parseC4 } from './parser';
import type { C4Diagram, C4Element } from './types';

/**
 * Helper to create a simple diagram for testing.
 */
function createDiagram(elements: C4Element[], relationships: C4Diagram['relationships'] = []): C4Diagram {
  return { elements, relationships };
}

/**
 * Helper to create a simple element.
 */
function createElement(
  type: C4Element['type'],
  id: string,
  name: string,
  properties: C4Element['properties'] = {},
  children: C4Element[] = [],
  parent?: string
): C4Element {
  return { type, id, name, properties, children, parent };
}

describe('C4 Layout Engine', () => {
  describe('basic layout', () => {
    it('should handle empty diagram', () => {
      const diagram: C4Diagram = { elements: [], relationships: [] };
      const result = layoutC4Diagram(diagram);

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it('should layout a single element', () => {
      const element = createElement('container', 'api', 'API Service');
      const diagram = createDiagram([element]);

      const result = layoutC4Diagram(diagram);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('api');
      expect(result.nodes[0].x).toBeGreaterThanOrEqual(0);
      expect(result.nodes[0].y).toBeGreaterThanOrEqual(0);
      expect(result.nodes[0].width).toBeGreaterThan(0);
      expect(result.nodes[0].height).toBeGreaterThan(0);
    });

    it('should layout multiple elements', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
        createElement('container', 'c', 'Service C'),
      ];
      const diagram = createDiagram(elements);

      const result = layoutC4Diagram(diagram);

      expect(result.nodes).toHaveLength(3);

      // All nodes should have valid positions
      for (const node of result.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('should not overlap elements', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
      ];
      const diagram = createDiagram(elements);

      const result = layoutC4Diagram(diagram);

      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;

      // Check that nodes don't overlap
      const aRight = nodeA.x + nodeA.width;
      const aBottom = nodeA.y + nodeA.height;
      const bRight = nodeB.x + nodeB.width;
      const bBottom = nodeB.y + nodeB.height;

      const horizontalOverlap = nodeA.x < bRight && aRight > nodeB.x;
      const verticalOverlap = nodeA.y < bBottom && aBottom > nodeB.y;

      expect(horizontalOverlap && verticalOverlap).toBe(false);
    });
  });

  describe('node dimensions', () => {
    it('should size person elements smaller', () => {
      const person = createElement('person', 'user', 'Customer');
      const container = createElement('container', 'api', 'API Service');
      const diagram = createDiagram([person, container]);

      const result = layoutC4Diagram(diagram);

      const personNode = result.nodes.find((n) => n.id === 'user')!;
      const containerNode = result.nodes.find((n) => n.id === 'api')!;

      // Person should be narrower than container
      expect(personNode.width).toBeLessThan(containerNode.width);
    });

    it('should increase height for elements with tech badge', () => {
      const withTech = createElement('container', 'a', 'API', { tech: 'Node.js' });
      const withoutTech = createElement('container', 'b', 'API');
      const diagram = createDiagram([withTech, withoutTech]);

      const result = layoutC4Diagram(diagram);

      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;

      expect(nodeA.height).toBeGreaterThan(nodeB.height);
    });

    it('should increase height for elements with description', () => {
      const withDesc = createElement('container', 'a', 'API', {
        description: 'Handles user requests',
      });
      const withoutDesc = createElement('container', 'b', 'API');
      const diagram = createDiagram([withDesc, withoutDesc]);

      const result = layoutC4Diagram(diagram);

      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;

      expect(nodeA.height).toBeGreaterThan(nodeB.height);
    });

    it('should size cylinder shapes taller', () => {
      const cylinder = createElement('container', 'db', 'Database', { shape: 'cylinder' });
      const rectangle = createElement('container', 'api', 'API');
      const diagram = createDiagram([cylinder, rectangle]);

      const result = layoutC4Diagram(diagram);

      const dbNode = result.nodes.find((n) => n.id === 'db')!;
      const apiNode = result.nodes.find((n) => n.id === 'api')!;

      expect(dbNode.height).toBeGreaterThan(apiNode.height);
    });

    it('should widen nodes for long names', () => {
      const shortName = createElement('container', 'a', 'API');
      const longName = createElement('container', 'b', 'Very Long Service Name That Needs Space');
      const diagram = createDiagram([shortName, longName]);

      const result = layoutC4Diagram(diagram);

      const shortNode = result.nodes.find((n) => n.id === 'a')!;
      const longNode = result.nodes.find((n) => n.id === 'b')!;

      expect(longNode.width).toBeGreaterThan(shortNode.width);
    });
  });

  describe('nested elements', () => {
    it('should layout children inside parent boundary', () => {
      const child = createElement('container', 'webapp', 'Web App', {}, [], 'banking');
      const parent = createElement('system', 'banking', 'Banking', { style: 'boundary' }, [child]);
      const diagram = createDiagram([parent, child]);

      const result = layoutC4Diagram(diagram);

      const parentNode = result.nodes.find((n) => n.id === 'banking')!;
      const childNode = result.nodes.find((n) => n.id === 'webapp')!;

      // Child should be inside parent bounds
      expect(childNode.x).toBeGreaterThanOrEqual(parentNode.x);
      expect(childNode.y).toBeGreaterThanOrEqual(parentNode.y);
      expect(childNode.x + childNode.width).toBeLessThanOrEqual(
        parentNode.x + parentNode.width
      );
      expect(childNode.y + childNode.height).toBeLessThanOrEqual(
        parentNode.y + parentNode.height
      );
    });

    it('should size parent to contain all children', () => {
      const child1 = createElement('container', 'a', 'Service A', {}, [], 'sys');
      const child2 = createElement('container', 'b', 'Service B', {}, [], 'sys');
      const parent = createElement('system', 'sys', 'System', {}, [child1, child2]);
      const diagram = createDiagram([parent, child1, child2]);

      const result = layoutC4Diagram(diagram);

      const parentNode = result.nodes.find((n) => n.id === 'sys')!;
      const childA = result.nodes.find((n) => n.id === 'a')!;
      const childB = result.nodes.find((n) => n.id === 'b')!;

      // Parent should be large enough to contain both children
      const childrenMaxX = Math.max(childA.x + childA.width, childB.x + childB.width);
      const childrenMaxY = Math.max(childA.y + childA.height, childB.y + childB.height);

      expect(parentNode.x + parentNode.width).toBeGreaterThanOrEqual(childrenMaxX);
      expect(parentNode.y + parentNode.height).toBeGreaterThanOrEqual(childrenMaxY);
    });

    it('should handle deeply nested elements', () => {
      const component = createElement('component', 'comp', 'Component', {}, [], 'cont');
      const container = createElement('container', 'cont', 'Container', {}, [component], 'sys');
      const system = createElement('system', 'sys', 'System', {}, [container]);
      const diagram = createDiagram([system, container, component]);

      const result = layoutC4Diagram(diagram);

      expect(result.nodes).toHaveLength(3);

      const sysNode = result.nodes.find((n) => n.id === 'sys')!;
      const contNode = result.nodes.find((n) => n.id === 'cont')!;
      const compNode = result.nodes.find((n) => n.id === 'comp')!;

      // Component inside container
      expect(compNode.x).toBeGreaterThanOrEqual(contNode.x);
      expect(compNode.y).toBeGreaterThanOrEqual(contNode.y);

      // Container inside system
      expect(contNode.x).toBeGreaterThanOrEqual(sysNode.x);
      expect(contNode.y).toBeGreaterThanOrEqual(sysNode.y);
    });
  });

  describe('relationships and edges', () => {
    it('should create edges for relationships', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
      ];
      const relationships = [{ sourceId: 'a', targetId: 'b', label: 'Calls' }];
      const diagram = createDiagram(elements, relationships);

      const result = layoutC4Diagram(diagram);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('a');
      expect(result.edges[0].target).toBe('b');
      expect(result.edges[0].label).toBe('Calls');
    });

    it('should have valid edge points', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
      ];
      const relationships = [{ sourceId: 'a', targetId: 'b', label: 'Calls' }];
      const diagram = createDiagram(elements, relationships);

      const result = layoutC4Diagram(diagram);

      const edge = result.edges[0];
      expect(edge.points).toHaveLength(2);

      // Points should have valid coordinates
      for (const point of edge.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle multiple edges', () => {
      const elements = [
        createElement('container', 'a', 'A'),
        createElement('container', 'b', 'B'),
        createElement('container', 'c', 'C'),
      ];
      const relationships = [
        { sourceId: 'a', targetId: 'b', label: 'First' },
        { sourceId: 'b', targetId: 'c', label: 'Second' },
        { sourceId: 'a', targetId: 'c', label: 'Third' },
      ];
      const diagram = createDiagram(elements, relationships);

      const result = layoutC4Diagram(diagram);

      expect(result.edges).toHaveLength(3);
    });

    it('should skip edges with missing nodes', () => {
      const elements = [createElement('container', 'a', 'A')];
      const relationships = [{ sourceId: 'a', targetId: 'missing', label: 'Bad' }];
      const diagram = createDiagram(elements, relationships);

      const result = layoutC4Diagram(diagram);

      expect(result.edges).toHaveLength(0);
    });
  });

  describe('direction support', () => {
    it('should respect direction property', () => {
      // Layout with different directions should produce different arrangements
      const elements = [
        createElement('container', 'a', 'A'),
        createElement('container', 'b', 'B'),
      ];
      const relationships = [{ sourceId: 'a', targetId: 'b', label: 'Flow' }];

      // Default is top-to-bottom (TB)
      const rightDiagram = createDiagram(elements, relationships);
      const rightResult = layoutC4Diagram(rightDiagram);

      // The two layouts may be similar since default is TB
      // Just verify that layout completes without error
      expect(rightResult.nodes).toHaveLength(2);
    });

    it('should pass direction to children', () => {
      // Create system with direction that affects children
      const childA = createElement('container', 'a', 'A', {}, [], 'sys');
      const childB = createElement('container', 'b', 'B', {}, [], 'sys');
      const system = createElement('system', 'sys', 'System', { direction: 'down' }, [
        childA,
        childB,
      ]);

      const relationships = [{ sourceId: 'a', targetId: 'b', label: 'Flow' }];
      const diagram = createDiagram([system, childA, childB], relationships);

      const result = layoutC4Diagram(diagram);

      // With down direction, child A should be above child B
      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;

      expect(nodeA.y).toBeLessThan(nodeB.y);
    });
  });

  describe('layout options', () => {
    it('should respect custom node dimensions', () => {
      const element = createElement('container', 'api', 'API');
      const diagram = createDiagram([element]);

      const result = layoutC4Diagram(diagram, {
        nodeWidth: 300,
        nodeHeight: 100,
      });

      const node = result.nodes[0];
      expect(node.width).toBeGreaterThanOrEqual(300);
      expect(node.height).toBeGreaterThanOrEqual(100);
    });

    it('should respect custom spacing', () => {
      const elements = [
        createElement('container', 'a', 'A'),
        createElement('container', 'b', 'B'),
      ];
      const diagram = createDiagram(elements);

      const defaultResult = layoutC4Diagram(diagram);
      const spacedResult = layoutC4Diagram(diagram, { rankSep: 200 });

      // Total diagram should be larger with more spacing
      expect(spacedResult.width + spacedResult.height).toBeGreaterThanOrEqual(
        defaultResult.width + defaultResult.height
      );
    });
  });

  describe('integration with parser', () => {
    it('should layout parsed diagram', () => {
      const code = `
System_Boundary(banking, "Banking") {
  Container(webapp, "Web App", "React")
  Container(api, "API", "Node.js")
}

System_Ext(email, "Email")

Rel(webapp, api, "JSON/HTTPS")
Rel(api, email, "SMTP")
      `;

      const parseResult = parseC4(code);
      expect(parseResult.errors).toHaveLength(0);

      const layoutResult = layoutC4Diagram(parseResult.diagram!);

      // Should have all elements positioned
      expect(layoutResult.nodes.length).toBeGreaterThanOrEqual(4);

      // Should have edges
      expect(layoutResult.edges).toHaveLength(2);

      // Should have valid dimensions
      expect(layoutResult.width).toBeGreaterThan(0);
      expect(layoutResult.height).toBeGreaterThan(0);
    });

    it('should layout the full spec example', () => {
      const code = `
System_Boundary(banking, "Internet Banking") {
  Container(webapp, "Web App", "React, TypeScript", "Delivers the SPA")
  Container(api, "API", "Node.js, Express", "Provides banking API")
  ContainerDb(db, "Database", "PostgreSQL")
}

System_Ext(email, "Email System")

Rel(webapp, api, "JSON/HTTPS")
Rel(api, db, "SQL/TCP")
Rel(api, email, "SMTP")
      `;

      const parseResult = parseC4(code);
      expect(parseResult.errors).toHaveLength(0);

      const layoutResult = layoutC4Diagram(parseResult.diagram!);

      // Verify all elements are present
      const ids = layoutResult.nodes.map((n) => n.id);
      expect(ids).toContain('banking');
      expect(ids).toContain('webapp');
      expect(ids).toContain('api');
      expect(ids).toContain('db');
      expect(ids).toContain('email');

      // Verify all edges are present
      expect(layoutResult.edges).toHaveLength(3);

      // Verify no overlapping top-level elements
      const banking = layoutResult.nodes.find((n) => n.id === 'banking')!;
      const email = layoutResult.nodes.find((n) => n.id === 'email')!;

      const horizontalOverlap =
        banking.x < email.x + email.width && banking.x + banking.width > email.x;
      const verticalOverlap =
        banking.y < email.y + email.height && banking.y + banking.height > email.y;

      expect(horizontalOverlap && verticalOverlap).toBe(false);
    });
  });

  // ===========================================================================
  // MANUAL LAYOUT TESTS
  // ===========================================================================

  describe('manual layout', () => {
    it('should apply manual positions to elements', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
      ];
      const diagram = createDiagram(elements);

      const manualPositions = {
        a: { x: 100, y: 200 },
        b: { x: 400, y: 300 },
      };

      const result = layoutC4Diagram(diagram, undefined, manualPositions);

      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;

      expect(nodeA.x).toBe(100);
      expect(nodeA.y).toBe(200);
      expect(nodeB.x).toBe(400);
      expect(nodeB.y).toBe(300);
    });

    it('should fall back to default placement for missing positions', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
      ];
      const diagram = createDiagram(elements);

      // Only provide position for one element
      const manualPositions = {
        a: { x: 100, y: 200 },
      };

      const result = layoutC4Diagram(diagram, undefined, manualPositions);

      const nodeA = result.nodes.find((n) => n.id === 'a')!;
      const nodeB = result.nodes.find((n) => n.id === 'b')!;

      expect(nodeA.x).toBe(100);
      expect(nodeA.y).toBe(200);
      // Node B should get a default position (not at 0,0 - it uses defaultX/defaultY)
      expect(nodeB.x).toBeGreaterThanOrEqual(0);
      expect(nodeB.y).toBeGreaterThanOrEqual(0);
    });

    it('should use auto-layout when manualPositions is empty', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
      ];
      const diagram = createDiagram(elements);

      const autoResult = layoutC4Diagram(diagram);
      const manualResult = layoutC4Diagram(diagram, undefined, {});

      // With empty positions, should use auto-layout (same result)
      expect(manualResult.nodes[0].x).toBe(autoResult.nodes[0].x);
      expect(manualResult.nodes[0].y).toBe(autoResult.nodes[0].y);
    });

    it('should resize boundaries to contain manually positioned children', () => {
      const children = [
        createElement('container', 'webapp', 'Web App'),
        createElement('container', 'api', 'API'),
      ];
      const boundary = createElement('system', 'sys', 'System', { style: 'boundary' as const }, children);
      children.forEach(c => c.parent = 'sys');
      const diagram = createDiagram([boundary]);

      // Position children far apart to force boundary expansion
      const manualPositions = {
        sys: { x: 0, y: 0 },
        webapp: { x: 50, y: 80 },
        api: { x: 500, y: 400 },
      };

      const result = layoutC4Diagram(diagram, undefined, manualPositions);

      const sysNode = result.nodes.find((n) => n.id === 'sys')!;
      const apiNode = result.nodes.find((n) => n.id === 'api')!;

      // Boundary must be large enough to contain the child at (500, 400) + child dimensions
      expect(sysNode.width).toBeGreaterThan(apiNode.x - sysNode.x);
      expect(sysNode.height).toBeGreaterThan(apiNode.y - sysNode.y);
    });

    it('should calculate edges correctly with manual positions', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
      ];
      const relationships = [
        { sourceId: 'a', targetId: 'b', label: 'calls' },
      ];
      const diagram = createDiagram(elements, relationships);

      const manualPositions = {
        a: { x: 0, y: 0 },
        b: { x: 400, y: 0 },
      };

      const result = layoutC4Diagram(diagram, undefined, manualPositions);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('a');
      expect(result.edges[0].target).toBe('b');
      // Edge endpoints should be valid numbers
      expect(result.edges[0].points.length).toBeGreaterThan(0);
      for (const point of result.edges[0].points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    });

    it('should produce positive diagram dimensions with manual positions', () => {
      const elements = [
        createElement('container', 'a', 'Service A'),
        createElement('container', 'b', 'Service B'),
      ];
      const diagram = createDiagram(elements);

      const manualPositions = {
        a: { x: 50, y: 50 },
        b: { x: 300, y: 200 },
      };

      const result = layoutC4Diagram(diagram, undefined, manualPositions);

      expect(result.width).toBeGreaterThan(300);
      expect(result.height).toBeGreaterThan(200);
    });
  });
});

describe('empty boundaries', () => {
  const SRC = `@startuml
Person(user, "User")
System_Boundary(full, "Full") {
  Container(api, "API")
}
Container_Boundary(empty, "Empty") {
}
@enduml`;

  function parsed() {
    const r = parseC4(SRC);
    expect(r.errors).toEqual([]);
    return r.diagram!;
  }

  it('auto layout: an empty boundary is a visible box at least the minimum size', () => {
    const result = layoutC4Diagram(parsed());
    const node = result.nodes.find((n) => n.id === 'empty')!;
    expect(node.width).toBeGreaterThanOrEqual(EMPTY_BOUNDARY_SIZE.width);
    expect(node.height).toBeGreaterThanOrEqual(EMPTY_BOUNDARY_SIZE.height);
    expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
    expect(result.nodes.map((n) => n.id)).toContain('full');
    expect(result.width).toBeGreaterThanOrEqual(node.x + node.width);
    expect(result.height).toBeGreaterThanOrEqual(node.y + node.height);
  });

  it('auto layout: an empty boundary beside populated ones neither overlaps them nor drifts away', () => {
    const result = layoutC4Diagram(parsed());
    const empty = result.nodes.find((n) => n.id === 'empty')!;
    const full = result.nodes.find((n) => n.id === 'full')!;
    const overlaps =
      empty.x < full.x + full.width &&
      full.x < empty.x + empty.width &&
      empty.y < full.y + full.height &&
      full.y < empty.y + empty.height;
    expect(overlaps).toBe(false);
    expect(empty.x).toBeLessThan(full.x + full.width + 1000);
  });

  it('manual layout: keeps its position and the minimum size', () => {
    const result = layoutC4Diagram(parsed(), undefined, { empty: { x: 500, y: 300 } });
    const node = result.nodes.find((n) => n.id === 'empty')!;
    expect(node.x).toBe(500);
    expect(node.y).toBe(300);
    expect(node.width).toBeGreaterThanOrEqual(EMPTY_BOUNDARY_SIZE.width);
    expect(node.height).toBeGreaterThanOrEqual(EMPTY_BOUNDARY_SIZE.height);
  });

  it('manual layout: a pinned empty boundary beside a populated one is not pushed', () => {
    const full = layoutC4Diagram(parsed(), undefined, {
      user: { x: 0, y: 0 },
      full: { x: 200, y: 0 },
      api: { x: 240, y: 55 },
    }).nodes.find((n) => n.id === 'full')!;
    // Drop the empty boundary within the 40px gap of the populated one.
    const nearX = full.x + full.width + 10;
    const result = layoutC4Diagram(parsed(), undefined, {
      user: { x: 0, y: 0 },
      full: { x: 200, y: 0 },
      api: { x: 240, y: 55 },
      empty: { x: nearX, y: 20 },
    });
    const empty = result.nodes.find((n) => n.id === 'empty')!;
    expect(empty.x).toBe(nearX);
    expect(empty.y).toBe(20);
    // ...and nothing that had a manual position moved.
    expect(result.nodes.find((n) => n.id === 'full')!.x).toBe(200);
    expect(result.nodes.find((n) => n.id === 'user')!.x).toBe(0);
    expect(result.nodes.find((n) => n.id === 'api')!.x).toBe(240);
  });

  it('a plain childless System is not enlarged', () => {
    const d = createDiagram([createElement('system', 'sys', 'Sys')]);
    const node = layoutC4Diagram(d).nodes[0];
    expect(node.height).toBeLessThan(EMPTY_BOUNDARY_SIZE.height);
  });

  it('an empty boundary nested inside a boundary is laid out inside it', () => {
    const r = parseC4(`@startuml
System_Boundary(outer, "Outer") {
  Boundary(inner, "Inner") {
  }
}
@enduml`);
    expect(r.errors).toEqual([]);
    for (const positions of [undefined, { outer: { x: 100, y: 100 }, inner: { x: 140, y: 155 } }]) {
      const result = layoutC4Diagram(r.diagram!, undefined, positions);
      const outer = result.nodes.find((n) => n.id === 'outer')!;
      const inner = result.nodes.find((n) => n.id === 'inner')!;
      expect(inner.width).toBeGreaterThanOrEqual(EMPTY_BOUNDARY_SIZE.width);
      expect(inner.x).toBeGreaterThanOrEqual(outer.x);
      expect(inner.y).toBeGreaterThanOrEqual(outer.y);
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
      expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
    }
  });

  it('grows to contain its first child', () => {
    const r = parseC4(`@startuml
System_Boundary(b, "B") {
  Container(c, "C")
}
@enduml`);
    const result = layoutC4Diagram(r.diagram!, undefined, { b: { x: 100, y: 100 }, c: { x: 140, y: 155 } });
    const b = result.nodes.find((n) => n.id === 'b')!;
    const c = result.nodes.find((n) => n.id === 'c')!;
    expect(b.x).toBe(100);
    expect(b.y).toBe(100);
    expect(c.x + c.width).toBeLessThanOrEqual(b.x + b.width);
    expect(c.y + c.height).toBeLessThanOrEqual(b.y + b.height);
  });

  it('adding an empty boundary does not move nodes that have manual positions', () => {
    const before = parseC4(`@startuml
Person(user, "User")
System_Boundary(full, "Full") {
  Container(api, "API")
}
@enduml`).diagram!;
    const pos = { user: { x: 10, y: 20 }, full: { x: 300, y: 40 }, api: { x: 340, y: 95 } };
    const a = layoutC4Diagram(before, undefined, pos);
    const b = layoutC4Diagram(parsed(), undefined, { ...pos, empty: { x: 700, y: 60 } });
    for (const id of ['user', 'full', 'api']) {
      const na = a.nodes.find((n) => n.id === id)!;
      const nb = b.nodes.find((n) => n.id === id)!;
      expect([nb.x, nb.y, nb.width, nb.height]).toEqual([na.x, na.y, na.width, na.height]);
    }
  });
});
