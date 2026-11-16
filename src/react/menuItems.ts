/**
 * The diagram's add-element actions, defined once.
 *
 * Both the built-in `EditMenu` and the host-owned `onContextMenu` hook render from
 * these tables, so labels, order and grouping cannot drift apart.
 */

import type { C4AddableBoundaryKind, C4AddableElementKind } from '../core/alias';
import { C4_ADDABLE_BOUNDARY_KINDS, C4_ADDABLE_ELEMENT_KINDS } from '../core/alias';

export const ELEMENT_KIND_LABELS: Record<C4AddableElementKind, string> = {
  person: 'Person',
  system: 'System',
  container: 'Container',
  component: 'Component',
  systemDb: 'System DB',
  containerDb: 'Container DB',
  componentDb: 'Component DB',
};

export const BOUNDARY_KIND_LABELS: Record<C4AddableBoundaryKind, string> = {
  systemBoundary: 'System boundary',
  containerBoundary: 'Container boundary',
  boundary: 'Boundary',
};

/** What the user picked: an element kind or a boundary kind. */
export type EditMenuChoice =
  | { group: 'element'; kind: C4AddableElementKind }
  | { group: 'boundary'; kind: C4AddableBoundaryKind };

/** One diagram action offered to a host that draws its own context menu. */
export interface C4MenuItem {
  /** Stable identifier, e.g. `add:element:person` or `add:boundary:systemBoundary`. */
  id: string;
  /** Human-readable label, identical to the one in the built-in menu. */
  label: string;
  group: 'element' | 'boundary';
  /**
   * Run the action: same effect as picking it in the built-in menu. The new element
   * is placed at the point the request was made, then the renderer shows its label
   * prompt and reports the edit through `onEdit`.
   */
  select(): void;
}

/** What `onContextMenu` receives when the user asks for a menu on the diagram. */
export interface C4ContextMenuRequest {
  /** Client (viewport) coordinates of the right-click or long-press. */
  clientX: number;
  clientY: number;
  /** The pressing pointer for a long-press, `null` for a right-click. */
  pointerId: number | null;
  /** The diagram's actions at this point; `[]` where none apply (e.g. on a node). */
  items: C4MenuItem[];
}

/** Build the item list (elements first, then boundaries) around one select function. */
export function buildMenuItems(select: (choice: EditMenuChoice) => void): C4MenuItem[] {
  return [
    ...C4_ADDABLE_ELEMENT_KINDS.map(
      (kind): C4MenuItem => ({
        id: `add:element:${kind}`,
        label: ELEMENT_KIND_LABELS[kind],
        group: 'element',
        select: () => select({ group: 'element', kind }),
      }),
    ),
    ...C4_ADDABLE_BOUNDARY_KINDS.map(
      (kind): C4MenuItem => ({
        id: `add:boundary:${kind}`,
        label: BOUNDARY_KIND_LABELS[kind],
        group: 'boundary',
        select: () => select({ group: 'boundary', kind }),
      }),
    ),
  ];
}
