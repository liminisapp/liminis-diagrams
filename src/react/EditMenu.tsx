/**
 * EditMenu - the "add an element" context menu opened on the canvas.
 *
 * Replaces the toolbar palette. It lists the addable element kinds, then (in a
 * visually separate group) the boundary kinds; choosing one places a new element
 * or empty boundary at the point the menu was opened. Like `LabelInput` it is plain
 * HTML over the SVG, with inline styles and CSS-variable fallbacks, so a host can
 * restyle it with `--c4-*` variables (or target `[data-c4-menu]`) without this
 * package shipping a stylesheet.
 *
 * It closes itself, reporting nothing, on Escape, on a pointerdown outside it, on
 * scroll, and on `pointercancel` of the pointer that opened it (a long-press the
 * browser then took over). A `pointercancel` from any other pointer is ignored: a
 * palm or a system gesture must not dismiss a menu the user is reading.
 */

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { C4AddableBoundaryKind, C4AddableElementKind } from '../core/alias';
import { C4_ADDABLE_BOUNDARY_KINDS, C4_ADDABLE_ELEMENT_KINDS } from '../core/alias';

const KIND_LABELS: Record<C4AddableElementKind, string> = {
  person: 'Person',
  system: 'System',
  container: 'Container',
  component: 'Component',
  systemDb: 'System DB',
  containerDb: 'Container DB',
  componentDb: 'Component DB',
};

const BOUNDARY_KIND_LABELS: Record<C4AddableBoundaryKind, string> = {
  systemBoundary: 'System boundary',
  containerBoundary: 'Container boundary',
  boundary: 'Boundary',
};

/** What the user picked: an element kind or a boundary kind. */
export type EditMenuChoice =
  | { group: 'element'; kind: C4AddableElementKind }
  | { group: 'boundary'; kind: C4AddableBoundaryKind };

export interface EditMenuProps {
  /** Position in the SVG wrapper's coordinate space (px) */
  left: number;
  top: number;
  isDarkMode: boolean;
  /**
   * The pointer that opened the menu (a long-press), or null when it was opened
   * by a `contextmenu` event. Only a `pointercancel` from this pointer closes it.
   */
  originPointerId: number | null;
  onSelect: (choice: EditMenuChoice) => void;
  onClose: () => void;
}

export function EditMenu({
  left,
  top,
  isDarkMode,
  originPointerId,
  onSelect,
  onClose,
}: EditMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Keyboard users land on the first item.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onCloseRef.current();
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (originPointerId !== null && e.pointerId === originPointerId) onCloseRef.current();
    };
    const onScroll = () => onCloseRef.current();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [originPointerId]);

  const border = isDarkMode ? '#3f3f46' : '#d4d4d8';
  const text = isDarkMode ? '#e4e4e7' : '#27272a';
  const bg = isDarkMode ? '#18181b' : '#ffffff';

  const itemStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '6px 10px',
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    // Touch: a comfortable target without a stylesheet.
    minHeight: 32,
    touchAction: 'manipulation',
  };

  const moveFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length].focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Add to diagram"
      data-c4-menu=""
      onKeyDown={moveFocus}
      // The browser's own menu has no business opening on ours.
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 150,
        padding: 4,
        borderRadius: 8,
        border: `1px solid var(--c4-border, ${border})`,
        background: `var(--c4-bg, ${bg})`,
        color: text,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        // A finger resting on the menu must not scroll or zoom the page.
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <div role="group" aria-label="Elements" style={{ display: 'flex', flexDirection: 'column' }}>
        {C4_ADDABLE_ELEMENT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="menuitem"
            data-kind={kind}
            onClick={() => onSelect({ group: 'element', kind })}
            style={itemStyle}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      <div
        role="group"
        aria-label="Boundaries"
        data-c4-menu-group="boundaries"
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginTop: 4,
          paddingTop: 4,
          borderTop: `1px solid var(--c4-border, ${border})`,
        }}
      >
        <span
          aria-hidden="true"
          style={{ padding: '2px 10px', fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          Boundaries
        </span>
        {C4_ADDABLE_BOUNDARY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="menuitem"
            data-boundary-kind={kind}
            onClick={() => onSelect({ group: 'boundary', kind })}
            style={itemStyle}
          >
            {BOUNDARY_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}
