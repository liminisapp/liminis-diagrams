/**
 * C4 Layout Engine
 *
 * Uses @dagrejs/dagre for directed graph auto-layout of C4 architecture diagrams.
 * Supports nested elements (systems containing containers containing components)
 * with proper boundary group padding.
 */

import dagre from '@dagrejs/dagre';
import { svgNumber } from './precision';
import type {
  C4Diagram,
  C4Element,
  C4Direction,
  LayoutResult,
  LayoutNode,
  LayoutEdge,
  LayoutOptions,
  Point,
  ManualLayout,
} from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  nodeWidth: 240,
  nodeHeight: 80,
  nodePadding: 30,
  rankSep: 100,
  edgeSep: 25,
};

/** Padding around boundary group contents */
export const BOUNDARY_PADDING = 40;

/** Gap between a boundary and external elements outside it */
const EXTERNAL_GAP = 80;

/** Space reserved for boundary header (title + optional tech badge) */
export const BOUNDARY_HEADER_HEIGHT = 55;

/**
 * Minimum box for a boundary with no children. Tall enough to leave a clickable
 * interior below the header (a default-sized 80px box leaves only ~25px), so an
 * empty boundary is a usable target for adding its first child.
 */
export const EMPTY_BOUNDARY_SIZE = { width: 240, height: 160 } as const;

/** Additional height for elements with tech badges or descriptions */
const TECH_BADGE_HEIGHT = 16;
const DESCRIPTION_HEIGHT = 14;

/** Person element dimensions */
const PERSON_WIDTH = 120;
const PERSON_HEIGHT = 120;

// =============================================================================
// DIMENSION CALCULATIONS
// =============================================================================

/**
 * Calculate node dimensions based on element content.
 * Accounts for name length, tech badge, and description text.
 */
function calculateNodeDimensions(
  element: C4Element,
  options: Required<LayoutOptions>
): { width: number; height: number } {
  // Person elements have fixed smaller size
  if (element.type === 'person') {
    return { width: PERSON_WIDTH, height: PERSON_HEIGHT };
  }

  // Start with base dimensions
  let width = options.nodeWidth;
  let height = options.nodeHeight;

  // Estimate width based on name length (roughly 9px per character)
  const nameWidth = element.name.length * 9 + 48;
  width = Math.max(width, nameWidth);

  // Add height for tech badge if present
  if (element.properties.tech) {
    height += TECH_BADGE_HEIGHT;
    // Account for [] brackets around tech text
    const techWidth = (element.properties.tech.length + 2) * 7 + 48;
    width = Math.max(width, techWidth);
  }

  // Add height for description if present
  if (element.properties.description) {
    height += DESCRIPTION_HEIGHT;
    // Description wraps, so limit width contribution
    const descWidth = Math.min(element.properties.description.length * 7, 360);
    width = Math.max(width, descWidth);
  }

  // A boundary with no children still needs room to click into
  if (element.properties.style === 'boundary' && element.children.length === 0) {
    height = Math.max(height, EMPTY_BOUNDARY_SIZE.height);
    width = Math.max(width, EMPTY_BOUNDARY_SIZE.width);
  }

  // Cylinder shapes are slightly taller
  if (element.properties.shape === 'cylinder') {
    height += 20;
  }

  // Queue shapes need extra width for the wavy right edge
  if (element.properties.shape === 'queue') {
    width += 20;
  }

  return { width, height };
}

// =============================================================================
// DAGRE DIRECTION MAPPING
// =============================================================================

/**
 * Map C4 direction to dagre rankdir.
 */
function mapDirection(direction: C4Direction | undefined): 'TB' | 'BT' | 'LR' | 'RL' {
  switch (direction) {
    case 'down':
      return 'TB'; // Top to Bottom
    case 'up':
      return 'BT'; // Bottom to Top
    case 'left':
      return 'RL'; // Right to Left
    case 'right':
      return 'LR'; // Left to Right
    default:
      return 'TB'; // Top to Bottom (C4 convention)
  }
}

// =============================================================================
// LAYOUT CALCULATION
// =============================================================================

/**
 * Get top-level elements (elements without parents).
 */
function getTopLevelElements(elements: C4Element[]): C4Element[] {
  return elements.filter((e) => !e.parent);
}

/**
 * Layout a group of elements using dagre.
 * Returns positioned nodes with their children recursively laid out.
 */
function layoutGroup(
  elements: C4Element[],
  relationships: { sourceId: string; targetId: string; label: string }[],
  options: Required<LayoutOptions>,
  parentDirection?: C4Direction
): LayoutNode[] {
  if (elements.length === 0) {
    return [];
  }

  // Create dagre graph
  const g = new dagre.graphlib.Graph();

  // Determine layout direction from parent or use default
  const direction = parentDirection || 'down';

  g.setGraph({
    rankdir: mapDirection(direction),
    nodesep: options.nodePadding,
    ranksep: options.rankSep,
    edgesep: options.edgeSep,
    marginx: BOUNDARY_PADDING,
    marginy: BOUNDARY_PADDING,
  });

  g.setDefaultEdgeLabel(() => ({}));

  // Map to store layout nodes for building result
  const layoutNodes = new Map<string, LayoutNode>();

  // Add nodes to graph
  for (const element of elements) {
    // First, recursively layout children if any
    let childNodes: LayoutNode[] = [];
    let childBounds = { width: 0, height: 0 };

    if (element.children.length > 0) {
      // Get child direction from this element, or inherit from parent
      const childDirection = element.properties.direction || parentDirection;

      // Filter relationships relevant to this element's children:
      // Include relationships between direct children AND relationships
      // between descendants of different children (for virtual edge creation)
      const allDescendantIds = new Set<string>();
      function collectDescendants(el: C4Element): void {
        allDescendantIds.add(el.id);
        for (const child of el.children) {
          collectDescendants(child);
        }
      }
      for (const child of element.children) {
        collectDescendants(child);
      }
      const childRelationships = relationships.filter(
        (r) => allDescendantIds.has(r.sourceId) || allDescendantIds.has(r.targetId)
      );

      childNodes = layoutGroup(
        element.children,
        childRelationships,
        options,
        childDirection
      );

      // Calculate bounding box of children
      if (childNodes.length > 0) {
        const maxX = Math.max(...childNodes.map((n) => n.x + n.width));
        const maxY = Math.max(...childNodes.map((n) => n.y + n.height));
        childBounds = {
          width: maxX + BOUNDARY_PADDING,
          height: maxY + BOUNDARY_PADDING,
        };
      }
    }

    // Calculate this node's dimensions
    const baseDimensions = calculateNodeDimensions(element, options);

    // If this is a boundary/system with children, use child bounds
    const isBoundary =
      element.type === 'system' ||
      element.properties.style === 'boundary' ||
      element.children.length > 0;

    const nodeWidth = isBoundary
      ? Math.max(baseDimensions.width, childBounds.width)
      : baseDimensions.width;

    const nodeHeight = isBoundary
      ? Math.max(baseDimensions.height, childBounds.height + BOUNDARY_HEADER_HEIGHT)
      : baseDimensions.height;

    // Add to dagre graph
    g.setNode(element.id, { width: nodeWidth, height: nodeHeight });

    // Store preliminary layout node
    layoutNodes.set(element.id, {
      id: element.id,
      x: 0,
      y: 0,
      width: nodeWidth,
      height: nodeHeight,
      element,
      children: childNodes,
    });
  }

  // Add edges to graph (only those between elements in this group)
  // Use label width to set minimum edge length so labels have room to display.
  // In TB layout, one rank ≈ nodeHeight + rankSep. We estimate label width in px
  // and compute how many ranks the label needs to not overlap nodes.
  const elementIds = new Set(elements.map((e) => e.id));
  const rankHeight = options.nodeHeight + options.rankSep; // ~180px per rank
  const LABEL_CHAR_WIDTH = 6; // px per char at 11px font
  const MAX_MINLEN = 4; // cap to avoid huge diagrams

  for (const rel of relationships) {
    if (elementIds.has(rel.sourceId) && elementIds.has(rel.targetId)) {
      const labelLen = rel.label?.length ?? 0;
      // Extract actual description from step-numbered labels "N [description]"
      const stepMatch = rel.label ? /^\d+\s*\[(.+)\]$/.exec(rel.label) : null;
      const displayLen = stepMatch ? stepMatch[1].length : labelLen;

      // Estimate label width in px, then how many ranks needed
      const labelWidthPx = displayLen * LABEL_CHAR_WIDTH;
      // For two-line labels (split at ~30 chars), halve the effective width
      const effectiveWidth = displayLen > 30 ? labelWidthPx / 2 : labelWidthPx;
      // minlen: need at least enough ranks for label to fit alongside the edge
      // One rank gives ~rankHeight px of vertical space
      const minlen = Math.min(MAX_MINLEN, Math.max(1, Math.ceil(effectiveWidth / rankHeight)));

      g.setEdge(rel.sourceId, rel.targetId, { minlen });
    }
  }

  // Add virtual edges between boundaries when their children have relationships.
  // This gives dagre the rank ordering it needs (e.g., macOS above Cloud Services
  // when Context Graph Service → Neo4j AuraDB crosses that boundary).
  // Map every descendant to its top-level ancestor in this group
  const childToParent = new Map<string, string>();
  function mapDescendants(element: C4Element, topAncestor: string): void {
    for (const child of element.children) {
      childToParent.set(child.id, topAncestor);
      mapDescendants(child, topAncestor);
    }
  }
  for (const element of elements) {
    mapDescendants(element, element.id);
  }

  // Also track which IDs are direct group elements (for imbalanced Rels)
  const groupElementIds = new Set(elements.map((e) => e.id));

  const virtualEdges = new Set<string>();
  for (const rel of relationships) {
    let sourceParent = childToParent.get(rel.sourceId);
    let targetParent = childToParent.get(rel.targetId);

    // Handle imbalanced Rels: if one side is a boundary group element
    // directly (peer to the other side's parent), use it as its own parent.
    // Only for boundaries (elements with children) — not leaf elements.
    if (!sourceParent && groupElementIds.has(rel.sourceId)) {
      const el = elements.find((e) => e.id === rel.sourceId);
      if (el && el.children.length > 0) sourceParent = rel.sourceId;
    }
    if (!targetParent && groupElementIds.has(rel.targetId)) {
      const el = elements.find((e) => e.id === rel.targetId);
      if (el && el.children.length > 0) targetParent = rel.targetId;
    }

    if (sourceParent && targetParent && sourceParent !== targetParent) {
      const key = `${sourceParent}->${targetParent}`;
      if (!virtualEdges.has(key)) {
        virtualEdges.add(key);
        g.setEdge(sourceParent, targetParent);
      }
    }
  }

  // Run dagre layout
  dagre.layout(g);

  // Extract positions from dagre
  const result: LayoutNode[] = [];

  for (const element of elements) {
    const dagreNode = g.node(element.id);
    const layoutNode = layoutNodes.get(element.id)!;

    // Dagre gives center coordinates, convert to top-left
    layoutNode.x = dagreNode.x - dagreNode.width / 2;
    layoutNode.y = dagreNode.y - dagreNode.height / 2;

    // Offset children to be centered inside parent boundary
    if (layoutNode.children && layoutNode.children.length > 0) {
      // Calculate children's actual bounding box (dagre may not start at 0)
      const childMinX = Math.min(...layoutNode.children.map((n) => n.x));
      const childMaxX = Math.max(...layoutNode.children.map((n) => n.x + n.width));
      const childrenWidth = childMaxX - childMinX;

      // Center children horizontally within parent
      const availableWidth = layoutNode.width - BOUNDARY_PADDING * 2;
      const centerOffsetX = (availableWidth - childrenWidth) / 2;

      const offsetX = layoutNode.x + BOUNDARY_PADDING + Math.max(0, centerOffsetX) - childMinX;
      const offsetY = layoutNode.y + BOUNDARY_HEADER_HEIGHT;

      for (const child of layoutNode.children) {
        offsetLayoutNode(child, offsetX, offsetY);
      }
    }

    result.push(layoutNode);
  }

  return result;
}

/**
 * Recursively offset a layout node and its children.
 */
function offsetLayoutNode(node: LayoutNode, offsetX: number, offsetY: number): void {
  node.x += offsetX;
  node.y += offsetY;

  if (node.children) {
    for (const child of node.children) {
      offsetLayoutNode(child, offsetX, offsetY);
    }
  }
}

/**
 * Flatten layout nodes into a single array including all nested children.
 */
function flattenLayoutNodes(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];

  function visit(node: LayoutNode): void {
    result.push(node);
    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  for (const node of nodes) {
    visit(node);
  }

  return result;
}

/**
 * Calculate edge paths between elements.
 * Uses center points with simple routing.
 */
function calculateEdges(
  relationships: { sourceId: string; targetId: string; label: string }[],
  nodeMap: Map<string, LayoutNode>
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];

  // Count parallel edges between the same pair (in either direction)
  const pairCounts = new Map<string, number>();
  const pairIndex = new Map<string, number>();
  for (const rel of relationships) {
    const key = [rel.sourceId, rel.targetId].sort().join('::');
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  for (const [relationshipIndex, rel] of relationships.entries()) {
    const sourceNode = nodeMap.get(rel.sourceId);
    const targetNode = nodeMap.get(rel.targetId);

    if (!sourceNode || !targetNode) {
      continue;
    }

    // Determine offset for parallel edges
    const pairKey = [rel.sourceId, rel.targetId].sort().join('::');
    const totalParallel = pairCounts.get(pairKey) ?? 1;
    const currentIndex = pairIndex.get(pairKey) ?? 0;
    pairIndex.set(pairKey, currentIndex + 1);

    // Calculate center points
    const sourceCenter: Point = {
      x: sourceNode.x + sourceNode.width / 2,
      y: sourceNode.y + sourceNode.height / 2,
    };

    const targetCenter: Point = {
      x: targetNode.x + targetNode.width / 2,
      y: targetNode.y + targetNode.height / 2,
    };

    // Calculate edge points from node boundaries (unoffset)
    const sourcePoint = calculateEdgePoint(sourceNode, targetCenter);
    const targetPoint = calculateEdgePoint(targetNode, sourceCenter);

    // For parallel edges, offset both points perpendicular to the edge
    if (totalParallel > 1) {
      // Use a consistent direction for the pair regardless of A→B vs B→A
      // Sort the IDs and always compute the vector from the "lesser" to "greater" ID
      const [sortedFirst, sortedSecond] = [rel.sourceId, rel.targetId].sort();
      const firstNode = nodeMap.get(sortedFirst)!;
      const secondNode = nodeMap.get(sortedSecond)!;
      const dx = (secondNode.x + secondNode.width / 2) - (firstNode.x + firstNode.width / 2);
      const dy = (secondNode.y + secondNode.height / 2) - (firstNode.y + firstNode.height / 2);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const perpX = -dy / len;
        const perpY = dx / len;
        const isHorizontal = Math.abs(dx) > Math.abs(dy);
        const spread = isHorizontal ? 35 : 25;
        const offset = (currentIndex - (totalParallel - 1) / 2) * spread;
        sourcePoint.x += perpX * offset;
        sourcePoint.y += perpY * offset;
        targetPoint.x += perpX * offset;
        targetPoint.y += perpY * offset;
      }
    }

    edges.push({
      source: rel.sourceId,
      target: rel.targetId,
      points: [sourcePoint, targetPoint],
      label: rel.label,
      relationshipIndex,
    });
  }

  return edges;
}

/**
 * Calculate the point where an edge exits/enters a rectangular node.
 */
function calculateEdgePoint(node: LayoutNode, target: Point): Point {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;

  // Vector from center to target
  const dx = target.x - centerX;
  const dy = target.y - centerY;

  // Handle edge case of same position
  if (dx === 0 && dy === 0) {
    return { x: centerX, y: centerY };
  }

  // Calculate intersection with rectangle boundary
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;

  // Check which edge we intersect
  const scaleX = halfWidth / Math.abs(dx || 0.001);
  const scaleY = halfHeight / Math.abs(dy || 0.001);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale,
  };
}

// =============================================================================
// CROSS-BOUNDARY ALIGNMENT
// =============================================================================

/**
 * After layout, nudge non-boundary top-level elements toward their
 * cross-boundary relationship targets, without overlapping boundaries.
 *
 * For example, if "Knowledge Worker" relates to "MCP Host" inside a boundary,
 * shift "Knowledge Worker" toward "MCP Host"'s X position, but don't let it
 * overlap the boundary rectangle.
 */
function alignCrossBoundaryElements(
  topLevelNodes: LayoutNode[],
  relationships: { sourceId: string; targetId: string; label: string }[],
  nodeMap: Map<string, LayoutNode>
): void {
  // Compute dynamic external gap based on longest cross-boundary label
  // (horizontal edges need room for their labels between boundary and external element)
  const LABEL_CHAR_WIDTH = 6;
  const MIN_EXTERNAL_GAP = EXTERNAL_GAP;
  const MAX_EXTERNAL_GAP = 400;
  let maxCrossBoundaryLabelWidth = 0;

  for (const rel of relationships) {
    const source = nodeMap.get(rel.sourceId);
    const target = nodeMap.get(rel.targetId);
    if (!source || !target) continue;
    // Cross-boundary: one has a parent, the other doesn't
    const isCrossBoundary = (!!source.element.parent) !== (!!target.element.parent);
    if (isCrossBoundary && rel.label) {
      // Extract display length from step-numbered labels
      const stepMatch = /^\d+\s*\[(.+)\]$/.exec(rel.label);
      const displayLen = stepMatch ? stepMatch[1].length : rel.label.length;
      const labelWidth = displayLen * LABEL_CHAR_WIDTH + 40; // padding for circle + margin
      maxCrossBoundaryLabelWidth = Math.max(maxCrossBoundaryLabelWidth, labelWidth);
    }
  }

  const dynamicGap = Math.min(MAX_EXTERNAL_GAP,
    Math.max(MIN_EXTERNAL_GAP, maxCrossBoundaryLabelWidth));
  const leafNodes = topLevelNodes.filter(
    (n) => !n.children || n.children.length === 0
  );
  const boundaryNodes = topLevelNodes.filter(
    (n) => n.children && n.children.length > 0
  );

  if (leafNodes.length === 0 || boundaryNodes.length === 0) return;

  // Step 1: Align each leaf's Y with its primary cross-boundary target,
  // and nudge X toward the boundary edge nearest to the target
  for (const leaf of leafNodes) {
    const targets: { x: number; y: number }[] = [];

    for (const rel of relationships) {
      let partnerId: string | undefined;
      if (rel.sourceId === leaf.id) partnerId = rel.targetId;
      else if (rel.targetId === leaf.id) partnerId = rel.sourceId;
      else continue;

      const partner = nodeMap.get(partnerId);
      if (!partner?.element.parent) continue;

      targets.push({
        x: partner.x + partner.width / 2,
        y: partner.y + partner.height / 2,
      });
    }

    if (targets.length === 0) continue;

    // Align Y with the average target Y (center the leaf vertically)
    const avgTargetY = targets.reduce((s, t) => s + t.y, 0) / targets.length;
    leaf.y = avgTargetY - leaf.height / 2;

    // Nudge X: keep leaf outside boundaries but closer to its targets
    const avgTargetX = targets.reduce((s, t) => s + t.x, 0) / targets.length;
    const currentCenterX = leaf.x + leaf.width / 2;
    const nudgedCenterX = currentCenterX + (avgTargetX - currentCenterX) * 0.3;
    leaf.x = nudgedCenterX - leaf.width / 2;
  }

  // Step 2: Ensure leaves don't overlap boundaries
  for (const leaf of leafNodes) {
    const originalCenterX = leaf.x + leaf.width / 2;

    for (const boundary of boundaryNodes) {
      const leafRight = leaf.x + leaf.width;
      const leafLeft = leaf.x;
      const yOverlap =
        leaf.y < boundary.y + boundary.height + BOUNDARY_PADDING &&
        leaf.y + leaf.height + BOUNDARY_PADDING > boundary.y;

      // Use base gap for left side (no long labels there), dynamic gap for right side
      const leftGap = MIN_EXTERNAL_GAP;
      const rightGap = dynamicGap;
      if (yOverlap && leafRight > boundary.x - leftGap && leafLeft < boundary.x + boundary.width + rightGap) {
        if (originalCenterX < boundary.x + boundary.width / 2) {
          leaf.x = boundary.x - leaf.width - leftGap;
        } else {
          leaf.x = boundary.x + boundary.width + rightGap;
        }
      }
    }
  }

  // Step 3: Resolve leaf-to-leaf overlaps by pushing apart vertically
  leafNodes.sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < leafNodes.length; i++) {
    for (let j = i + 1; j < leafNodes.length; j++) {
      const a = leafNodes[i];
      const b = leafNodes[j];

      const gap = BOUNDARY_PADDING;
      const xOverlap = a.x < b.x + b.width + gap &&
                        a.x + a.width + gap > b.x;
      const yOverlap = a.y < b.y + b.height + gap &&
                        a.y + a.height + gap > b.y;

      if (xOverlap && yOverlap) {
        b.y = a.y + a.height + gap;
      }
    }
  }

  // Step 4: Align peer leaves on the same side of a boundary to share X
  // Group leaves by which side of which boundary they're on
  for (const boundary of boundaryNodes) {
    const boundaryCenterX = boundary.x + boundary.width / 2;
    const leftPeers = leafNodes.filter((n) => n.x + n.width / 2 < boundaryCenterX);
    const rightPeers = leafNodes.filter((n) => n.x + n.width / 2 >= boundaryCenterX);

    // Align left peers to the same X (use the minimum X so none overlap boundary)
    if (leftPeers.length > 1) {
      const alignX = Math.min(...leftPeers.map((n) => n.x));
      for (const peer of leftPeers) {
        peer.x = alignX;
      }
    }

    // Align right peers to the same X (closest to boundary, not furthest)
    if (rightPeers.length > 1) {
      const alignX = Math.min(...rightPeers.map((n) => n.x));
      // Ensure it's still outside the boundary
      const minX = boundary.x + boundary.width + dynamicGap;
      for (const peer of rightPeers) {
        peer.x = Math.max(alignX, minX);
      }
    }
  }

  // Step 5: Re-resolve overlaps after peer alignment may have re-introduced them
  leafNodes.sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < leafNodes.length; i++) {
    for (let j = i + 1; j < leafNodes.length; j++) {
      const a = leafNodes[i];
      const b = leafNodes[j];

      const gap = BOUNDARY_PADDING;
      const xOverlap = a.x < b.x + b.width + gap &&
                        a.x + a.width + gap > b.x;
      const yOverlap = a.y < b.y + b.height + gap &&
                        a.y + a.height + gap > b.y;

      if (xOverlap && yOverlap) {
        b.y = a.y + a.height + gap;
      }
    }
  }
}

// =============================================================================
// MANUAL LAYOUT
// =============================================================================

/**
 * Build layout nodes with computed dimensions, applying manual positions.
 * Recursively processes nested elements, computing dimensions and applying positions.
 */
function buildLayoutNodesWithManualPositions(
  elements: C4Element[],
  positions: Record<string, { x: number; y: number }>,
  options: Required<LayoutOptions>,
  defaultX: number,
  defaultY: number
): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const currentX = defaultX;
  let currentY = defaultY;

  for (const element of elements) {
    // Determine this node's position first (needed for boundary size calculation)
    const manualPos = positions[element.id];
    const x = manualPos?.x ?? currentX;
    const y = manualPos?.y ?? currentY;

    // Recursively process children
    let childNodes: LayoutNode[] = [];

    if (element.children.length > 0) {
      // Position children inside the boundary header area
      childNodes = buildLayoutNodesWithManualPositions(
        element.children,
        positions,
        options,
        BOUNDARY_PADDING,
        BOUNDARY_HEADER_HEIGHT
      );
    }

    // Calculate this node's base dimensions
    const baseDimensions = calculateNodeDimensions(element, options);

    // If this is a boundary with children, expand to contain them
    const isBoundary =
      element.type === 'system' ||
      element.properties.style === 'boundary' ||
      element.children.length > 0;

    let nodeWidth = baseDimensions.width;
    let nodeHeight = baseDimensions.height;

    if (isBoundary && childNodes.length > 0) {
      // Calculate children bounding box
      const childMaxX = Math.max(...childNodes.map((n) => n.x + n.width));
      const childMaxY = Math.max(...childNodes.map((n) => n.y + n.height));

      // Children may have absolute positions (manual) or relative positions (auto-placed).
      // Check if any children have manual positions to determine coordinate mode.
      const hasAbsoluteChildren = childNodes.some((n) => positions[n.id]);

      if (hasAbsoluteChildren) {
        // Children are in absolute coordinates — compute size relative to parent
        nodeWidth = Math.max(baseDimensions.width, childMaxX - x + BOUNDARY_PADDING);
        nodeHeight = Math.max(baseDimensions.height, childMaxY - y + BOUNDARY_PADDING);
      } else {
        // Children are in relative coordinates (starting from BOUNDARY_PADDING, BOUNDARY_HEADER_HEIGHT)
        const childBounds = {
          width: childMaxX + BOUNDARY_PADDING,
          height: childMaxY + BOUNDARY_PADDING,
        };
        nodeWidth = Math.max(baseDimensions.width, childBounds.width);
        nodeHeight = Math.max(baseDimensions.height, childBounds.height);
      }
    }

    const layoutNode: LayoutNode = {
      id: element.id,
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      element,
      children: childNodes.length > 0 ? childNodes : undefined,
    };

    // Offset children to be inside parent's coordinate space
    // Children with manual positions are already in absolute coordinates,
    // so only offset auto-placed children
    if (layoutNode.children) {
      for (const child of layoutNode.children) {
        if (!positions[child.id]) {
          offsetLayoutNode(child, x, y);
        }
      }
    }

    nodes.push(layoutNode);

    // Update default position for next element without manual position
    currentY += nodeHeight + options.nodePadding;
  }

  return nodes;
}

/**
 * Recursively resize boundaries to contain their children.
 * Must be called after children positions are finalized (bottom-up resize).
 * Handles expansion in all four directions — if a child is dragged above
 * or left of the boundary origin, the boundary shifts position and expands.
 */
function resizeBoundariesToContainChildren(nodes: LayoutNode[]): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      // First resize nested boundaries
      resizeBoundariesToContainChildren(node.children);

      // Find the bounding box of all children
      const childMinX = Math.min(
        ...node.children.map((n) => n.x)
      );
      const childMinY = Math.min(
        ...node.children.map((n) => n.y)
      );
      const childMaxX = Math.max(
        ...node.children.map((n) => n.x + n.width)
      );
      const childMaxY = Math.max(
        ...node.children.map((n) => n.y + n.height)
      );

      // Expand leftward/upward if children extend beyond boundary origin
      const requiredLeft = childMinX - BOUNDARY_PADDING;
      const requiredTop = childMinY - BOUNDARY_HEADER_HEIGHT;

      if (requiredLeft < node.x) {
        const shift = node.x - requiredLeft;
        node.width += shift;
        node.x = requiredLeft;
      }
      if (requiredTop < node.y) {
        const shift = node.y - requiredTop;
        node.height += shift;
        node.y = requiredTop;
      }

      // Expand rightward/downward
      const requiredWidth = childMaxX - node.x + BOUNDARY_PADDING;
      const requiredHeight = childMaxY - node.y + BOUNDARY_PADDING;

      node.width = Math.max(node.width, requiredWidth);
      node.height = Math.max(node.height, requiredHeight);
    }
  }
}

function isEmptyBoundary(node: LayoutNode): boolean {
  return node.element.properties.style === 'boundary' && !(node.children && node.children.length > 0);
}

/**
 * Push sibling nodes apart when they overlap after boundary expansion.
 * Nodes with manual positions are anchored — only unanchored nodes or
 * the node further from center gets pushed.
 */
function resolveTopLevelOverlaps(
  nodes: LayoutNode[],
  manualPositions: Record<string, { x: number; y: number }>
): void {
  const gap = BOUNDARY_PADDING;
  // Multiple passes to handle cascading pushes
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];

        // Check for overlap (with gap)
        const overlapX = Math.min(a.x + a.width + gap, b.x + b.width + gap) -
                         Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height + gap, b.y + b.height + gap) -
                         Math.max(a.y, b.y);

        if (overlapX <= 0 || overlapY <= 0) continue; // No overlap

        // Decide which node to push: prefer pushing the one without
        // a manual position. If both have manual positions AND neither
        // is a boundary that may have expanded, allow the overlap to
        // avoid jitter. But if one is an expanded boundary, push the other.
        const aAnchored = !!manualPositions[a.id];
        const bAnchored = !!manualPositions[b.id];
        // An empty boundary the user has placed stays where it was put, even
        // next to (or over) a populated boundary.
        if (aAnchored && bAnchored && (isEmptyBoundary(a) || isEmptyBoundary(b))) continue;
        const aBoundary = !!(a.children && a.children.length > 0);
        const bBoundary = !!(b.children && b.children.length > 0);
        let target: LayoutNode;
        if (aAnchored && bAnchored && !aBoundary && !bBoundary) {
          continue; // Both anchored leaves — allow overlap to avoid jitter
        } else if (aBoundary && !bBoundary) {
          // A is an expanded boundary — push B away
          target = b;
        } else if (bBoundary && !aBoundary) {
          target = a;
        } else if (aAnchored && !bAnchored) {
          target = b;
        } else if (!aAnchored && bAnchored) {
          target = a;
        } else {
          // Neither anchored — push the one further right/down
          target = (a.x + a.y > b.x + b.y) ? a : b;
        }

        // Push along the axis of least overlap, away from the other node
        const other = target === b ? a : b;
        if (overlapX < overlapY) {
          const pushDir = (target.x + target.width / 2 > other.x + other.width / 2) ? 1 : -1;
          shiftNodeAndChildren(target, overlapX * pushDir, 0);
        } else {
          const pushDir = (target.y + target.height / 2 > other.y + other.height / 2) ? 1 : -1;
          shiftNodeAndChildren(target, 0, overlapY * pushDir);
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * Shift a node and all its children by the given delta.
 */
function shiftNodeAndChildren(node: LayoutNode, dx: number, dy: number): void {
  node.x += dx;
  node.y += dy;
  if (node.children) {
    for (const child of node.children) {
      shiftNodeAndChildren(child, dx, dy);
    }
  }
}

/**
 * Layout a C4 diagram using manual positions instead of dagre auto-layout.
 * Used when the user has positioned elements manually.
 */
function layoutWithManualPositions(
  diagram: C4Diagram,
  options: Required<LayoutOptions>,
  manualPositions: Record<string, { x: number; y: number }>
): LayoutResult {
  const topLevelElements = getTopLevelElements(diagram.elements);

  // Build layout nodes with manual positions applied
  const layoutNodes = buildLayoutNodesWithManualPositions(
    topLevelElements,
    manualPositions,
    options,
    BOUNDARY_PADDING,
    BOUNDARY_PADDING
  );

  // Resize boundaries to contain their children (bottom-up)
  resizeBoundariesToContainChildren(layoutNodes);

  // Push sibling nodes apart if boundary expansion caused overlaps
  resolveTopLevelOverlaps(layoutNodes, manualPositions);

  // Flatten all nodes for the result
  const allNodes = flattenLayoutNodes(layoutNodes);

  // Build node lookup for edge calculation
  const nodeMap = new Map<string, LayoutNode>();
  for (const node of allNodes) {
    nodeMap.set(node.id, node);
  }

  // Calculate edges using existing function
  const edges = calculateEdges(diagram.relationships, nodeMap);

  return { nodes: allNodes, edges, ...boundsFor(allNodes, edges) };
}

/**
 * The viewBox and dimensions that actually contain the laid-out diagram.
 *
 * Shared by both layout paths, because they were only ever different by
 * accident. The manual path always computed a real bounding box — dragging a
 * node above or left of the origin produces negative coordinates, and the
 * viewBox origin moves to cover them rather than shifting every node, which
 * would desynchronise rendered positions from the positions a host persists.
 *
 * The auto path hardcoded `viewBoxX: 0, viewBoxY: 0` on the premise that dagre
 * never emits negative coordinates. That premise was wrong, and documented as
 * fact in data-model.md. Dagre's own output is non-negative, but the
 * cross-boundary alignment pass that runs after it shifts elements outside a
 * boundary to line up with their targets inside it, and that can move them left
 * of the origin. The result was a `viewBox` starting at 0 with content at
 * negative x: clipped, and unreachable by scrolling, because a viewBox is a
 * window rather than a canvas. Four lines of C4 reproduce it — a Person outside
 * a System_Boundary with a Rel to something inside.
 *
 * Edge points are included as well as node rects: an edge routed around a
 * boundary can leave the union of the node rectangles.
 *
 * Diagrams that were already correct are unaffected. Where nothing sits within
 * BOUNDARY_PADDING of the origin, `Math.min(0, …)` yields 0 and the width and
 * height are what they were.
 */
function boundsFor(
  nodes: LayoutNode[],
  edges: LayoutEdge[]
): Pick<LayoutResult, 'width' | 'height' | 'viewBoxX' | 'viewBoxY'> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  for (const edge of edges) {
    for (const point of edge.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  // An empty diagram leaves the minima at Infinity; treat it as the origin.
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;

  const viewBoxX = Math.min(0, minX - BOUNDARY_PADDING);
  const viewBoxY = Math.min(0, minY - BOUNDARY_PADDING);

  return {
    width: maxX + BOUNDARY_PADDING - viewBoxX,
    height: maxY + BOUNDARY_PADDING - viewBoxY,
    viewBoxX,
    viewBoxY,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Layout a C4 diagram using dagre for auto-positioning,
 * or manual positions if provided.
 *
 * @param diagram - The parsed C4 diagram AST
 * @param options - Layout configuration options
 * @param manualPositions - Optional manual positions for elements (bypasses dagre)
 * @returns Layout result with positioned nodes and routed edges
 */
export function layoutC4Diagram(
  diagram: C4Diagram,
  options?: LayoutOptions,
  manualPositions?: Record<string, { x: number; y: number }>
): LayoutResult {
  const mergedOptions: Required<LayoutOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  // Use manual layout if positions are provided. Rounded here rather than
  // inside that function so the two layout paths cannot diverge on it: this is
  // the branch the drag renderer takes, and the one `renderC4DiagramToSVG`
  // takes when given `manualPositions`, so leaving it unrounded would have left
  // the platform drift in place for exactly the diagrams a user had arranged
  // by hand.
  if (manualPositions && Object.keys(manualPositions).length > 0) {
    const manual = layoutWithManualPositions(diagram, mergedOptions, manualPositions);
    roundGeometryInPlace(manual);
    return manual;
  }

  const topLevelElements = getTopLevelElements(diagram.elements);

  // Layout top-level elements, using diagram direction if specified
  const layoutNodes = layoutGroup(
    topLevelElements,
    diagram.relationships,
    mergedOptions,
    diagram.direction
  );

  // Flatten all nodes for the result
  const allNodes = flattenLayoutNodes(layoutNodes);

  // Build node lookup for edge calculation
  const nodeMap = new Map<string, LayoutNode>();
  for (const node of allNodes) {
    nodeMap.set(node.id, node);
  }

  // Post-layout: align non-boundary elements with their cross-boundary targets
  alignCrossBoundaryElements(layoutNodes, diagram.relationships, nodeMap);

  // Calculate edges
  const edges = calculateEdges(diagram.relationships, nodeMap);

  const result: LayoutResult = { nodes: allNodes, edges, ...boundsFor(allNodes, edges) };
  roundGeometryInPlace(result);
  return result;
}

/**
 * Round every coordinate in a finished layout, in place.
 *
 * Done once here rather than at each of the ~80 places the renderer writes a
 * coordinate into an attribute: the layout *is* the geometry, so producing it
 * to a fixed precision means every consumer — the React renderer, the headless
 * SVG serialiser, anything a host builds — inherits the same numbers without
 * having to remember to round.
 *
 * In place rather than by copying, because a node appears both in the flat
 * `nodes` list and in its parent's `children`, and rebuilding those would break
 * the identity between them. `svgNumber` is idempotent, so visiting a node
 * twice is harmless.
 *
 * See ./precision.ts for why this exists at all — the short version is that
 * `atan2` is not bit-identical across platforms, and rendered SVGs get
 * committed and diffed.
 */
function roundGeometryInPlace(result: LayoutResult): void {
  // `result.nodes` comes from flattenLayoutNodes, so it already contains every
  // descendant — a node reached through `children` is the same object, and one
  // pass over the flat list covers the tree.
  for (const node of result.nodes) {
    node.x = svgNumber(node.x);
    node.y = svgNumber(node.y);
    node.width = svgNumber(node.width);
    node.height = svgNumber(node.height);
  }

  for (const edge of result.edges) {
    edge.points = edge.points.map((point) => ({
      x: svgNumber(point.x),
      y: svgNumber(point.y),
    }));
  }

  result.width = svgNumber(result.width);
  result.height = svgNumber(result.height);
  result.viewBoxX = svgNumber(result.viewBoxX);
  result.viewBoxY = svgNumber(result.viewBoxY);
}

/**
 * Re-export types for convenience.
 */
export type { LayoutResult, LayoutNode, LayoutEdge, LayoutOptions, Point, ManualLayout };
