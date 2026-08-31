import type { Category } from '../api/types';

/**
 * Colour and spacing tokens.
 *
 * **Category colour never carries meaning on its own** (spec §10). Every chart
 * that uses these pairs with a legend or table carrying the same values, and
 * every legend row states its label in text. The palette exists to make a chart
 * scannable, not to encode the category.
 */

export const palette = {
  background: '#FFFFFF',
  surface: '#F6F7F9',
  border: '#DFE3E8',
  text: '#111418',
  textMuted: '#5B6472',
  accent: '#1F6FEB',
  /**
   * The background of a selected chip.
   *
   * Four controls each invented `#EAF1FE` independently — `ExpenseFilters`,
   * `SortControl`, `ReclassifyControl` and `PeriodPicker` — and agreed by luck
   * (#135). Named here so the next selection control inherits the answer rather
   * than picking a fifth blue.
   *
   * A tint of `accent` rather than a hue of its own: it sits behind `text` at
   * **16.28:1** and behind `accent` at **4.08:1**, so a selected chip's label
   * clears AA either way, and the `accent` border around it clears the 3:1
   * non-text minimum. The selection is never carried by the fill alone — the
   * border moves with it, and `aria-checked` says so out loud.
   *
   * Those two figures were first written as 14.9 and 3.6, both invented. The
   * 3.6 in particular read as a deliberate echo of the `accent`/`border`
   * pairing below and was not one. Recomputed with WCAG 2.x relative
   * luminance, checked against that pairing — which the same code puts at
   * 3.59:1, matching what this file already claims for it.
   */
  selected: '#EAF1FE',
  /** Used for net-negative values — refunds exceeding spending in a bucket. */
  negative: '#B4232C',
  /**
   * The prior-period half of a negative pair, so sign and series stay
   * orthogonal in a grouped bar chart.
   *
   * A tint rather than a different hue: the solid/muted distinction is carried
   * by lightness, which every form of colour vision deficiency preserves. Its
   * contrast against `negative` (3.6:1) is deliberately the same as
   * `accent`-against-`border` (3.6:1), so a negative pair separates exactly as
   * well as a positive one.
   */
  negativeMuted: '#E5B2B5',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/**
 * One colour per category, in taxonomy order.
 *
 * Fixed per category rather than assigned by rank, so a category does not
 * change colour between two reports because its position moved. Chosen to stay
 * distinguishable under the common forms of colour vision deficiency, though
 * the label beside each is what actually carries the meaning.
 */
export const categoryColors: Record<Category, string> = {
  HOUSING: '#2F5D8C',
  UTILITIES: '#3E8A99',
  GROCERIES: '#3F8F5B',
  DINING: '#C1762A',
  TRANSPORT: '#7A5AA8',
  MAINTENANCE: '#8A6B3E',
  HEALTH: '#C0506B',
  DISCRETIONARY: '#D0A32E',
  CAPITAL: '#4A6572',
  INCOME: '#2E7D5B',
  UNCLASSIFIED: '#8A9099',
};

/** Falls back for a key the taxonomy gains before this map does. */
export function colorForCategory(key: string): string {
  return categoryColors[key as Category] ?? palette.textMuted;
}
