/**
 * LabelInput - inline label editor shown over a newly placed element.
 *
 * An HTML input over the SVG rather than a `<foreignObject>`: foreignObject has
 * known focus and keyboard quirks on iPadOS Safari. The host positions it in
 * the SVG wrapper's coordinate space.
 *
 * Enter confirms (ignored while an IME composition is active), Escape or blur
 * cancels. Exactly one of confirm/cancel fires per mount.
 */

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';

export interface LabelInputProps {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Pre-filled placeholder label, selected on focus */
  initialValue: string;
  isDarkMode: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function LabelInput({
  left,
  top,
  width,
  height,
  initialValue,
  isDarkMode,
  onConfirm,
  onCancel,
}: LabelInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const settle = (fn: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    fn();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      data-c4-label-input=""
      aria-label="Element label"
      defaultValue={initialValue}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (e.nativeEvent.isComposing) return;
          e.preventDefault();
          settle(() => onConfirm(e.currentTarget.value));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          settle(onCancel);
        }
      }}
      onBlur={() => settle(onCancel)}
      style={{
        position: 'absolute',
        left,
        top: top + Math.max(0, (height - 28) / 2),
        width,
        boxSizing: 'border-box',
        height: 28,
        padding: '0 8px',
        textAlign: 'center',
        font: '14px system-ui, -apple-system, sans-serif',
        border: '2px solid var(--c4-accent, #3b82f6)',
        borderRadius: 4,
        background: isDarkMode ? '#18181b' : '#ffffff',
        color: isDarkMode ? '#e4e4e7' : '#27272a',
        outline: 'none',
      }}
    />
  );
}
