/**
 * EditPalette - the "add an element" kind chooser shown above the diagram.
 *
 * The package's only built-in control. It is deliberately plain: inline styles
 * with CSS-variable fallbacks, so a host can restyle it with `--c4-*` variables
 * (or target `[data-c4-palette]`) without this package shipping a stylesheet.
 */

import type { JSX } from 'react';
import type { C4AddableElementKind } from '../core/alias';
import { C4_ADDABLE_ELEMENT_KINDS } from '../core/alias';

const KIND_LABELS: Record<C4AddableElementKind, string> = {
  person: 'Person',
  system: 'System',
  container: 'Container',
  component: 'Component',
  systemDb: 'System DB',
  containerDb: 'Container DB',
  componentDb: 'Component DB',
};

export interface EditPaletteProps {
  /** The kind currently armed for placement, if any */
  activeKind: C4AddableElementKind | null;
  /** Disabled while a placement is being named */
  disabled: boolean;
  isDarkMode: boolean;
  /** Called with a kind to arm it, or null to disarm */
  onSelect: (kind: C4AddableElementKind | null) => void;
}

export function EditPalette({ activeKind, disabled, isDarkMode, onSelect }: EditPaletteProps): JSX.Element {
  const border = isDarkMode ? '#3f3f46' : '#d4d4d8';
  const text = isDarkMode ? '#e4e4e7' : '#27272a';
  const bg = isDarkMode ? '#18181b' : '#ffffff';
  return (
    <div
      role="toolbar"
      aria-label="Add element"
      data-c4-palette=""
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        padding: '6px 0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        color: text,
      }}
    >
      <span style={{ opacity: 0.7 }}>
        {activeKind ? 'Click the canvas to place' : 'Add:'}
      </span>
      {C4_ADDABLE_ELEMENT_KINDS.map((kind) => {
        const active = activeKind === kind;
        return (
          <button
            key={kind}
            type="button"
            data-kind={kind}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onSelect(active ? null : kind)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: `1px solid ${active ? 'var(--c4-accent, #3b82f6)' : `var(--c4-border, ${border})`}`,
              background: active ? 'var(--c4-accent, #3b82f6)' : `var(--c4-bg, ${bg})`,
              color: active ? '#ffffff' : text,
              cursor: disabled ? 'default' : 'pointer',
              font: 'inherit',
              // Touch: a comfortable target without a stylesheet.
              minHeight: 32,
              touchAction: 'manipulation',
            }}
          >
            {KIND_LABELS[kind]}
          </button>
        );
      })}
    </div>
  );
}
