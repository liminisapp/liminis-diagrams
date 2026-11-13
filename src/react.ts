/**
 * `@liminis/diagrams/react` — SVG rendering and drag interaction.
 *
 * Requires the `react` and `react-dom` optional peers. Nothing here is bound to
 * any particular editor: `C4InteractiveRenderer` is a controlled component that
 * takes positions in and calls back with new ones, leaving persistence to the host.
 */

export { C4Renderer, C4RendererContent, C4ErrorDisplay, computeLegendInfo } from './react/renderer';
export type {
  C4RendererProps,
  C4RendererContentProps,
  C4ErrorDisplayProps,
} from './react/renderer';

export { C4InteractiveRenderer, LEGEND_POSITION_ID } from './react/C4InteractiveRenderer';
export type { C4InteractiveRendererProps, C4EditContext } from './react/C4InteractiveRenderer';

export { useC4DiagramDrag } from './react/hooks/useC4DiagramDrag';
export { useC4ConnectDrag } from './react/hooks/useC4ConnectDrag';
export type {
  UseC4ConnectDragProps,
  UseC4ConnectDragReturn,
} from './react/hooks/useC4ConnectDrag';
