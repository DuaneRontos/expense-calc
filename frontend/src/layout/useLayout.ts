import { useWindowDimensions } from 'react-native';

import { layoutSizeFor, type LayoutSize } from './breakpoints';

export interface Layout {
  width: number;
  height: number;
  size: LayoutSize;
  /** Single column, bottom tabs. */
  isCompact: boolean;
  /** Two-column list + detail, filters in a collapsible drawer. */
  isMedium: boolean;
  /** Persistent sidebar, table, chart grid. */
  isExpanded: boolean;
}

/**
 * The current layout band.
 *
 * Built on `useWindowDimensions` rather than a one-shot `Dimensions.get`
 * because on web the window is resizable and on device it rotates — both of
 * which have to re-render, and a module-level read would freeze the layout at
 * whatever the first frame happened to be.
 */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const size = layoutSizeFor(width);

  return {
    width,
    height,
    size,
    isCompact: size === 'compact',
    isMedium: size === 'medium',
    isExpanded: size === 'expanded',
  };
}
