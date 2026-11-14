/**
 * ActionBar - the small bar beside a tap-selected node on touch.
 *
 * Touch has no double-click and no ⌥ key, so renaming an element and moving a
 * nested node out of its boundary need their own affordance: tap to select, then
 * pick an action here. Like `EditMenu` it is plain HTML over the SVG with inline
 * styles and CSS-variable fallbacks, so a host can restyle it with `--c4-*`
 * variables (or target `[data-c4-action-bar]`).
 *
 * It owns no dismissal: the renderer clears the selection (a tap elsewhere,
 * Escape, a drag, the menu or a rename starting) and the bar goes with it.
 */

import type { JSX } from 'react';

export interface ActionBarProps {
  /** Position in the SVG wrapper's coordinate space (px) */
  left: number;
  top: number;
  isDarkMode: boolean;
  /** Offer Rename (elements only; boundaries have no label rename) */
  canRename: boolean;
  /** Offer Move out (only when the node has a parent boundary) */
  canMoveOut: boolean;
  onRename: () => void;
  onMoveOut: () => void;
}

export function ActionBar({
  left,
  top,
  isDarkMode,
  canRename,
  canMoveOut,
  onRename,
  onMoveOut,
}: ActionBarProps): JSX.Element | null {
  if (!canRename && !canMoveOut) return null;

  const border = isDarkMode ? '#3f3f46' : '#d4d4d8';
  const text = isDarkMode ? '#e4e4e7' : '#27272a';
  const bg = isDarkMode ? '#18181b' : '#ffffff';

  const buttonStyle: React.CSSProperties = {
    // A finger-sized target without a stylesheet.
    minWidth: 44,
    minHeight: 44,
    padding: '0 14px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    touchAction: 'manipulation',
  };

  // Presses on the bar must not reach the canvas: a pointerdown there would clear the
  // selection, start a long-press or a drag before the click lands.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      role="toolbar"
      aria-label="Element actions"
      data-c4-action-bar=""
      onPointerDown={stop}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 10,
        display: 'flex',
        gap: 2,
        padding: 2,
        borderRadius: 8,
        border: `1px solid var(--c4-border, ${border})`,
        background: `var(--c4-bg, ${bg})`,
        color: text,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 14,
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {canRename && (
        <button type="button" data-action="rename" onClick={onRename} style={buttonStyle}>
          Rename
        </button>
      )}
      {canMoveOut && (
        <button type="button" data-action="move-out" onClick={onMoveOut} style={buttonStyle}>
          Move out
        </button>
      )}
    </div>
  );
}
