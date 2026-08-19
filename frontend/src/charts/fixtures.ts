import type { CategoryBreakdown, SpendOverTime } from '../api/types';

/**
 * Report-shaped sample data for the scaffold's placeholder screens.
 *
 * **Fixtures, not a mock API.** They exist so the scaffold can prove the chart
 * pipeline renders on all three targets before the backend is reachable from a
 * device (#13 wires the real client). They are deliberately the exact shape the
 * server returns — decimal strings, ranked buckets, a contiguous time axis — so
 * that swapping them for a live response is a one-line change and not a
 * reshaping exercise.
 *
 * The negative `MAINTENANCE` bucket is here on purpose: spec §7's rule that a
 * net-negative category is listed but not drawn as a slice is the easiest rule
 * in this codebase to regress, and a fixture that never exercises it is a
 * fixture that lets the regression through.
 */

export const sampleBreakdown: CategoryBreakdown = {
  period: { from: '2026-07-01', to: '2026-08-01' },
  currency: 'PHP',
  total: '41285.50',
  buckets: [
    { key: 'HOUSING', label: 'Housing', total: '18000.00' },
    { key: 'GROCERIES', label: 'Groceries', total: '12480.25' },
    { key: 'UTILITIES', label: 'Utilities', total: '6310.00' },
    { key: 'DINING', label: 'Dining', total: '4120.75' },
    { key: 'TRANSPORT', label: 'Transport', total: '2874.50' },
    { key: 'MAINTENANCE', label: 'Maintenance', total: '-2500.00' },
  ],
};

export const sampleOverTime: SpendOverTime = {
  period: { from: '2026-03-01', to: '2026-08-01' },
  bucket: 'MONTH',
  currency: 'PHP',
  total: '182640.00',
  buckets: [
    { key: '2026-03-01', label: 'Mar 2026', total: '38200.00' },
    { key: '2026-04-01', label: 'Apr 2026', total: '41050.00' },
    { key: '2026-05-01', label: 'May 2026', total: '0.00' },
    { key: '2026-06-01', label: 'Jun 2026', total: '-3140.00' },
    { key: '2026-07-01', label: 'Jul 2026', total: '41285.50' },
  ],
};
