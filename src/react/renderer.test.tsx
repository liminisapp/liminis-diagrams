import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { C4Renderer, C4ErrorDisplay } from './renderer';
import { layoutC4Diagram } from '../core/layout';
import { parseC4 } from '../core/parser';
import type { LayoutResult, LayoutNode, LayoutEdge, C4Element } from '../core/types';

/**
 * Helper to create a minimal layout result for testing.
 */
function createLayoutResult(
  nodes: LayoutNode[],
  edges: LayoutEdge[] = [],
  width = 500,
  height = 400
): LayoutResult {
  return { nodes, edges, width, height, viewBoxX: 0, viewBoxY: 0 };
}

/**
 * Helper to create a layout node.
 */
function createLayoutNode(
  type: C4Element['type'],
  id: string,
  name: string,
  options: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    properties?: C4Element['properties'];
    children?: LayoutNode[];
  } = {}
): LayoutNode {
  return {
    id,
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 200,
    height: options.height ?? 80,
    element: {
      type,
      id,
      name,
      properties: options.properties ?? {},
      children: [],
    },
    children: options.children,
  };
}

/**
 * Helper to create a layout edge.
 */
function createLayoutEdge(
  source: string,
  target: string,
  label: string,
  points = [
    { x: 100, y: 50 },
    { x: 300, y: 50 },
  ]
): LayoutEdge {
  return { source, target, label, points };
}

describe('C4Renderer', () => {
  describe('SVG structure', () => {
    it('should render an SVG element with correct dimensions', () => {
      const layout = createLayoutResult([], [], 600, 400);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('width')).toBe('600');
      expect(svg?.getAttribute('height')).toBe('400');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 600 400');
    });

    it('should have correct layer structure', () => {
      const layout = createLayoutResult([createLayoutNode('container', 'api', 'API')]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const svg = container.querySelector('svg');
      const groups = svg?.querySelectorAll('g');

      // Should have boundaries-layer, edges-layer, nodes-layer
      expect(groups?.length).toBeGreaterThanOrEqual(3);

      // Use getAttribute for SVG class attribute (JSDOM compatibility)
      const classNames = Array.from(groups ?? []).map((g) => g.getAttribute('class'));
      expect(classNames).toContain('boundaries-layer');
      expect(classNames).toContain('edges-layer');
      expect(classNames).toContain('nodes-layer');
    });

    it('should render empty diagram without errors', () => {
      const layout = createLayoutResult([]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  describe('system boundary rendering', () => {
    it('should render system with dotted stroke', () => {
      const node = createLayoutNode('system', 'banking', 'Banking', {
        properties: { style: 'boundary' },
        children: [createLayoutNode('container', 'webapp', 'Web App')],
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      // System boundary should be in boundaries-layer
      const boundariesLayer = container.querySelector('.boundaries-layer');
      const rect = boundariesLayer?.querySelector('rect');

      expect(rect).toBeTruthy();
      expect(rect?.getAttribute('stroke-dasharray')).toBe('8 4');
    });

    it('should render system name at top', () => {
      const node = createLayoutNode('system', 'banking', 'Internet Banking', {
        properties: { style: 'boundary' },
        children: [createLayoutNode('container', 'webapp', 'Web App')],
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const boundariesLayer = container.querySelector('.boundaries-layer');
      const texts = boundariesLayer?.querySelectorAll('text');

      const nameText = Array.from(texts ?? []).find(
        (t) => t.textContent === 'Internet Banking'
      );
      expect(nameText).toBeTruthy();
    });

    it('renders an empty boundary (hand-written, no children) as a visible dashed box with its title', () => {
      const r = parseC4('@startuml\nContainer_Boundary(api, "API Application") {\n}\n@enduml');
      expect(r.errors).toEqual([]);
      const layout = layoutC4Diagram(r.diagram!);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);
      // A Container_Boundary is a `container`, so it is drawn in the nodes layer (not the boundaries layer).
      const layer = container.querySelector('svg');
      const rect = layer?.querySelector('rect');
      expect(rect?.getAttribute('stroke-dasharray')).toBe('8 4');
      expect(Number(rect?.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(rect?.getAttribute('height'))).toBeGreaterThan(0);
      expect(Array.from(layer?.querySelectorAll('text') ?? []).some((t) => t.textContent === 'API Application')).toBe(true);

      // A System_Boundary takes the boundaries layer.
      const sys = parseC4('@startuml\nSystem_Boundary(s, "Sys") {\n}\n@enduml').diagram!;
      const { container: c2 } = render(<C4Renderer layout={layoutC4Diagram(sys)} isDarkMode={false} />);
      expect(c2.querySelector('.boundaries-layer rect')?.getAttribute('stroke-dasharray')).toBe('8 4');
    });
  });

  describe('container rendering', () => {
    it('should render container with solid fill', () => {
      const node = createLayoutNode('container', 'api', 'API Service');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const nodesLayer = container.querySelector('.nodes-layer');
      const rect = nodesLayer?.querySelector('rect');

      expect(rect).toBeTruthy();
      expect(rect?.getAttribute('stroke-dasharray')).toBe('none');
    });

    it('should render container name', () => {
      const node = createLayoutNode('container', 'api', 'API Service');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const nodesLayer = container.querySelector('.nodes-layer');
      const texts = nodesLayer?.querySelectorAll('text');

      const nameText = Array.from(texts ?? []).find(
        (t) => t.textContent === 'API Service'
      );
      expect(nameText).toBeTruthy();
    });

    it('should render tech badge when present', () => {
      const node = createLayoutNode('container', 'api', 'API', {
        properties: { tech: 'Node.js' },
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const texts = container.querySelectorAll('text');
      const techText = Array.from(texts).find((t) => t.textContent === '[Node.js]');
      expect(techText).toBeTruthy();
    });

    it('should render description when present', () => {
      const node = createLayoutNode('container', 'api', 'API', {
        properties: { description: 'Handles requests' },
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const texts = container.querySelectorAll('text');
      const descText = Array.from(texts).find((t) =>
        t.textContent?.includes('Handles requests')
      );
      expect(descText).toBeTruthy();
    });

    it('should wrap long descriptions into multiple tspan elements', () => {
      const longDesc =
        'This is a very long description that should be wrapped to fit within the element bounds';
      const node = createLayoutNode('container', 'api', 'API', {
        properties: { description: longDesc },
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      // Full description should be present (no truncation)
      const allText = container.textContent ?? '';
      expect(allText).toContain('very long');

      // Should have tspan elements for multi-line wrapping
      const tspans = container.querySelectorAll('tspan');
      expect(tspans.length).toBeGreaterThan(1);
    });
  });

  describe('external system rendering', () => {
    it('should render external system with dashed border', () => {
      const node = createLayoutNode('system', 'email', 'Email System', {
        properties: { external: true },
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const rects = container.querySelectorAll('rect');
      const externalRect = Array.from(rects).find(
        (r) => r.getAttribute('stroke-dasharray') === '8 4'
      );
      expect(externalRect).toBeTruthy();
    });

    it('should use grey fill for external systems', () => {
      const node = createLayoutNode('container', 'ext', 'External API', {
        properties: { external: true },
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const rects = container.querySelectorAll('rect');
      // External systems should have a light grey hex fill (#f0f4f8)
      const externalRect = Array.from(rects).find((r) => {
        const fill = r.getAttribute('fill') ?? '';
        return fill.includes('#f0f4f8');
      });
      expect(externalRect).toBeTruthy();
    });
  });

  describe('component rendering', () => {
    it('should render component with smaller border radius', () => {
      const node = createLayoutNode('component', 'auth', 'Auth Module');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const nodesLayer = container.querySelector('.nodes-layer');
      const rect = nodesLayer?.querySelector('rect');

      expect(rect).toBeTruthy();
      // Components have smaller border radius (BORDER_RADIUS / 2 = 4)
      expect(Number(rect?.getAttribute('rx'))).toBe(4);
    });
  });

  describe('person rendering', () => {
    it('should render person with circle head', () => {
      const node = createLayoutNode('person', 'user', 'Customer');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const nodesLayer = container.querySelector('.nodes-layer');
      const circle = nodesLayer?.querySelector('circle');

      expect(circle).toBeTruthy();
    });

    it('should render person with body rectangle', () => {
      const node = createLayoutNode('person', 'user', 'Customer');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const nodesLayer = container.querySelector('.nodes-layer');
      // Person has a rounded rect for body
      const rects = nodesLayer?.querySelectorAll('rect');

      expect(rects?.length).toBeGreaterThan(0);
    });

    it('should render person name', () => {
      const node = createLayoutNode('person', 'user', 'Customer');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const texts = container.querySelectorAll('text');
      const nameText = Array.from(texts).find((t) => t.textContent === 'Customer');
      expect(nameText).toBeTruthy();
    });
  });

  describe('cylinder shape rendering', () => {
    it('should render cylinder with ellipses', () => {
      const node = createLayoutNode('container', 'db', 'Database', {
        properties: { shape: 'cylinder' },
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const ellipses = container.querySelectorAll('ellipse');
      // Cylinder has top and bottom ellipses
      expect(ellipses.length).toBe(2);
    });

    it('should render cylinder body', () => {
      const node = createLayoutNode('container', 'db', 'Database', {
        properties: { shape: 'cylinder' },
      });
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const rects = container.querySelectorAll('rect');
      expect(rects.length).toBeGreaterThan(0);
    });
  });

  describe('relationship/edge rendering', () => {
    it('should render edge as path', () => {
      const nodes = [
        createLayoutNode('container', 'a', 'A', { x: 0, y: 0 }),
        createLayoutNode('container', 'b', 'B', { x: 300, y: 0 }),
      ];
      const edges = [createLayoutEdge('a', 'b', 'Calls')];
      const layout = createLayoutResult(nodes, edges);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const edgesLayer = container.querySelector('.edges-layer');
      const path = edgesLayer?.querySelector('path');

      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBeTruthy();
    });

    it('should render edge with arrowhead', () => {
      const nodes = [
        createLayoutNode('container', 'a', 'A', { x: 0, y: 0 }),
        createLayoutNode('container', 'b', 'B', { x: 300, y: 0 }),
      ];
      const edges = [createLayoutEdge('a', 'b', 'Calls')];
      const layout = createLayoutResult(nodes, edges);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const edgesLayer = container.querySelector('.edges-layer');
      const polygon = edgesLayer?.querySelector('polygon');

      expect(polygon).toBeTruthy();
      expect(polygon?.getAttribute('points')).toBeTruthy();
    });

    it('should render edge label', () => {
      const nodes = [
        createLayoutNode('container', 'a', 'A', { x: 0, y: 0 }),
        createLayoutNode('container', 'b', 'B', { x: 300, y: 0 }),
      ];
      const edges = [createLayoutEdge('a', 'b', 'JSON/HTTPS')];
      const layout = createLayoutResult(nodes, edges);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const texts = container.querySelectorAll('text');
      const labelText = Array.from(texts).find((t) => t.textContent === 'JSON/HTTPS');
      expect(labelText).toBeTruthy();
    });

    it('should render edge label as text in edges layer', () => {
      const nodes = [
        createLayoutNode('container', 'a', 'A', { x: 0, y: 0 }),
        createLayoutNode('container', 'b', 'B', { x: 300, y: 0 }),
      ];
      const edges = [createLayoutEdge('a', 'b', 'API')];
      const layout = createLayoutResult(nodes, edges);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const edgesLayer = container.querySelector('.edges-layer');
      // Edge label renders as text centered on the edge line
      const texts = edgesLayer?.querySelectorAll('text');
      expect(texts?.length).toBeGreaterThan(0);
      const labelText = Array.from(texts ?? []).find((t) => t.textContent === 'API');
      expect(labelText).toBeTruthy();
    });
  });

  describe('theme support', () => {
    it('should use light colors in light mode', () => {
      const node = createLayoutNode('container', 'api', 'API');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={false} />);

      const rect = container.querySelector('.nodes-layer rect');
      const fill = rect?.getAttribute('fill') ?? '';
      // Light mode container fill is white
      expect(fill).toContain('#ffffff');
    });

    it('should use dark colors in dark mode', () => {
      const node = createLayoutNode('container', 'api', 'API');
      const layout = createLayoutResult([node]);
      const { container } = render(<C4Renderer layout={layout} isDarkMode={true} />);

      const rect = container.querySelector('.nodes-layer rect');
      const fill = rect?.getAttribute('fill') ?? '';
      // Dark mode container fill is dark
      expect(fill).toContain('#16191c');
    });
  });

  describe('integration with parser and layout', () => {
    it('should render a complete parsed diagram', () => {
      const code = `
System_Boundary(banking, "Banking") {
  Container(webapp, "Web App", "React")
  Container(api, "API", "Node.js")
}

Person(user, "Customer", "Bank customer")

Rel(webapp, api, "JSON/HTTPS")
Rel(user, webapp, "Uses")
      `;

      const parseResult = parseC4(code);
      expect(parseResult.errors).toHaveLength(0);

      const layoutResult = layoutC4Diagram(parseResult.diagram!);
      const { container } = render(
        <C4Renderer layout={layoutResult} isDarkMode={false} />
      );

      // Should have SVG
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // Should have rendered all elements
      const texts = container.querySelectorAll('text');
      const textContents = Array.from(texts).map((t) => t.textContent);

      expect(textContents).toContain('Banking');
      expect(textContents).toContain('Web App');
      expect(textContents).toContain('API');
      expect(textContents).toContain('Customer');

      // Should have tech badges
      expect(textContents.some((t) => t?.includes('React'))).toBe(true);
      expect(textContents.some((t) => t?.includes('Node.js'))).toBe(true);

      // Should have edge labels
      expect(textContents).toContain('JSON/HTTPS');
      expect(textContents).toContain('Uses');
    });

    it('should render the full spec example', () => {
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
      const { container } = render(
        <C4Renderer layout={layoutResult} isDarkMode={false} />
      );

      // Verify SVG structure
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // Verify all elements are rendered
      const allText = container.textContent ?? '';
      expect(allText).toContain('Internet Banking');
      expect(allText).toContain('Web App');
      expect(allText).toContain('API');
      expect(allText).toContain('Database');
      expect(allText).toContain('Email System');

      // Verify cylinder is rendered for database
      const ellipses = container.querySelectorAll('ellipse');
      expect(ellipses.length).toBeGreaterThan(0);

      // Verify external system has dashed border
      const rects = container.querySelectorAll('rect');
      const dashedRects = Array.from(rects).filter(
        (r) => r.getAttribute('stroke-dasharray') === '8 4'
      );
      expect(dashedRects.length).toBeGreaterThan(0);
    });
  });
});

describe('C4ErrorDisplay', () => {
  it('should render error message', () => {
    const errors = [{ message: 'Unexpected token', line: 1, column: 5 }];
    const { container } = render(<C4ErrorDisplay errors={errors} isDarkMode={false} />);

    expect(container.textContent).toContain('C4 Diagram Parse Error');
    expect(container.textContent).toContain('Unexpected token');
    expect(container.textContent).toContain('Line 1');
    expect(container.textContent).toContain('Column 5');
  });

  it('should render multiple errors', () => {
    const errors = [
      { message: 'Error 1', line: 1, column: 1 },
      { message: 'Error 2', line: 2, column: 3 },
      { message: 'Error 3', line: 5, column: 10 },
    ];
    const { container } = render(<C4ErrorDisplay errors={errors} isDarkMode={false} />);

    expect(container.textContent).toContain('Error 1');
    expect(container.textContent).toContain('Error 2');
    expect(container.textContent).toContain('Error 3');
  });

  it('should render in both light and dark mode', () => {
    const errors = [{ message: 'Error', line: 1, column: 1 }];

    // Light mode renders without error
    const { container: lightContainer } = render(
      <C4ErrorDisplay errors={errors} isDarkMode={false} />
    );
    expect(lightContainer.textContent).toContain('Error');

    // Dark mode renders without error
    const { container: darkContainer } = render(
      <C4ErrorDisplay errors={errors} isDarkMode={true} />
    );
    expect(darkContainer.textContent).toContain('Error');

    // Both should render the error content
    expect(lightContainer.querySelector('div')).toBeTruthy();
    expect(darkContainer.querySelector('div')).toBeTruthy();
  });
});
