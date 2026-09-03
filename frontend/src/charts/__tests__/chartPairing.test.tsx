import { render, screen } from '@testing-library/react-native';

import { BarChart } from '../BarChart';
import { ChartLegend } from '../ChartLegend';
import { ComparisonChart } from '../ComparisonChart';
import { DonutChart } from '../DonutChart';
import { formatMoney } from '../../money/format';
import type { ComparisonBucket, ReportBucket } from '../../api/types';

/**
 * Spec §10's pairing rule, which had no test at all.
 *
 * > Charts are never the only representation of their data. Every chart pairs
 * > with an accessible table or legend carrying the same values.
 *
 * `ChartLegend`'s own docblock says a caller cannot turn it off — and until
 * #118, deleting the `<ChartLegend/>` from a chart failed nothing. The chart
 * components were never rendered by any test: `geometry.test.ts` and
 * `comparison.test.ts` cover the pure functions beneath them.
 *
 * This matters more than a normal styling guard because the legend is the
 * *only* thing a screen reader can read. An SVG arc carries nothing.
 */
const buckets: ReportBucket[] = [
  { key: 'GROCERIES', label: 'Groceries', total: '18420.00' },
  { key: 'DINING', label: 'Dining', total: '-40.00' },
  { key: 'TRANSPORT', label: 'Transport', total: '0.00' },
];

describe('every chart', () => {
  it('pairs the donut with a legend carrying the same values', async () => {
    await render(<DonutChart buckets={buckets} total="18380.00" />);

    for (const bucket of buckets) {
      expect(
        screen.getByLabelText(`${bucket.label}, ${formatMoney(bucket.total)}`),
      ).toBeOnTheScreen();
    }
  });

  it('pairs the bar chart with a legend carrying the same values', async () => {
    await render(<BarChart buckets={buckets} />);

    for (const bucket of buckets) {
      expect(
        screen.getByLabelText(`${bucket.label}, ${formatMoney(bucket.total)}`),
      ).toBeOnTheScreen();
    }
  });

  /**
   * `ComparisonChart` builds its own inline table rather than using
   * `ChartLegend`, so nothing shared protects it — it is the one chart where
   * the §10 pairing is hand-rolled per element, and it was the one with no
   * coverage. Deleting its list role, its header label and every row label all
   * passed the full suite.
   */
  it('pairs the comparison chart with a table carrying the same values', async () => {
    await render(<ComparisonChart buckets={pairs} />);

    for (const pair of pairs) {
      expect(
        screen.getByLabelText(
          `${pair.label}, ${formatMoney(pair.current)} this period, ` +
            `${formatMoney(pair.previous)} prior, change ${formatMoney(pair.change)}`,
        ),
      ).toBeOnTheScreen();
    }
  });

  it('announces the comparison headings once, not as four list items', async () => {
    await render(<ComparisonChart buckets={pairs} />);

    expect(screen.getByLabelText('Category, this period, prior, change')).toBeOnTheScreen();
  });

  it('makes the comparison table a list', async () => {
    await render(<ComparisonChart buckets={pairs} />);

    const header = screen.getByLabelText('Category, this period, prior, change');

    expect(header.parent?.props.accessibilityRole).toBe('list');
  });
});

/** A falling category, so a negative `change` is covered. */
const pairs: ComparisonBucket[] = [
  { key: 'GROCERIES', label: 'Groceries', current: '100.00', previous: '80.00', change: '20.00' },
  { key: 'DINING', label: 'Dining', current: '40.00', previous: '90.00', change: '-50.00' },
];

describe('ChartLegend', () => {
  it('announces each row as one label rather than two cells', async () => {
    // A screen reader should read "Groceries, ₱18,420.00", not stop between
    // the swatch, the name and the number.
    await render(<ChartLegend buckets={buckets} />);

    expect(
      screen.getByLabelText(`Groceries, ${formatMoney('18420.00')}`),
    ).toBeOnTheScreen();
  });

  it('is a list, so a screen reader can move through it as one', async () => {
    // Asserted on the prop, not via `getByRole('list')`, which finds nothing
    // here: each *row* is the accessibility element (`accessible` with its own
    // composite label), so the container that carries the role is not one
    // itself and RNTL will not match it. Same shape as the `role="group"`
    // assertion in `expenses/__tests__/chipSemantics`.
    await render(<ChartLegend buckets={buckets} />);

    const row = screen.getByLabelText(`Groceries, ${formatMoney('18420.00')}`);

    expect(row.parent?.props.accessibilityRole).toBe('list');
  });

  it('gives every bucket a row, including the ones the chart declined to draw', async () => {
    /*
     * A category netting exactly "0.00" has no slice and a net-negative one is
     * excluded from the arc, but both are real answers the server gave. A
     * legend that quietly omitted them would stop carrying the same values as
     * the response it describes — which is the §10 rule, not a nicety.
     */
    await render(<ChartLegend buckets={buckets} drawnKeys={new Set(['GROCERIES'])} />);

    expect(screen.getByLabelText(`Dining, ${formatMoney('-40.00')}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`Transport, ${formatMoney('0.00')}`)).toBeOnTheScreen();
  });

  it('keeps the sign of a refund in the legend text, not only its colour', async () => {
    // Spec §10 again: colour is never the only signal.
    await render(<ChartLegend buckets={buckets} />);

    const refund = formatMoney('-40.00');

    expect(refund).toContain('-');
    expect(screen.getByText(refund)).toBeOnTheScreen();
  });
});
