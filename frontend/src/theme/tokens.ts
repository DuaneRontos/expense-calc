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
  /** Used for net-negative values — refunds exceeding spending in a bucket. */
  negative: '#B4232C',
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
