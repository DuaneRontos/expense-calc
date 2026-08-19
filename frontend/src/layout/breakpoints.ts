/**
 * The three breakpoints of spec §2, and the layout each one selects.
 *
 * One layout system, three widths — not three screens. The boundaries are the
 * spec's, restated here as the single place they are written down:
 *
 *   | Width      | Layout                                                |
 *   | < 600px    | Single column, bottom tabs, one full-bleed chart      |
 *   | 600–1024px | Two-column list + detail, filters in a drawer         |
 *   | > 1024px   | Persistent filter sidebar, table, charts in a grid    |
 */

export const BREAKPOINTS = {
  /** Below this, one column. */
  compact: 600,
  /** Above this, the sidebar is persistent. */
  expanded: 1024,
} as const;

export type LayoutSize = 'compact' | 'medium' | 'expanded';

/**
 * Which layout a width selects.
 *
 * The spec writes the bands as `< 600`, `600–1024`, `> 1024`, so 1024 falls in
 * medium's inclusive range and outside expanded's exclusive one. Medium keeps
 * it. An iPad in landscape is exactly 1024pt, so this is a real device rather
 * than a hypothetical, and the test pins it deliberately.
 */
export function layoutSizeFor(width: number): LayoutSize {
  if (width < BREAKPOINTS.compact) {
    return 'compact';
  }
  if (width <= BREAKPOINTS.expanded) {
    return 'medium';
  }
  return 'expanded';
}

/**
 * Minimum touch target, in dp, at every breakpoint.
 *
 * Spec §2: touch targets stay at mobile sizing on all breakpoints. Desktop
 * users with touchscreens are common and the cost of a generous hit area is
 * nil. 44 is the smaller of the two platform guidelines (iOS 44pt, Android
 * 48dp), so meeting it is the floor rather than the target.
 */
export const MIN_TOUCH_TARGET = 44;
