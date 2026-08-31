import { render, screen } from '@testing-library/react-native';

import { ExpenseRow } from '../ExpenseRow';
import { formatMoney } from '../../money/format';
import type { ExpenseSummary } from '../../api/types';

/**
 * **Nothing rendered `ExpenseRow` before #116.** `format.test.ts` covers the
 * money helpers and `expenses.test.ts` covers the query hook, but the row that
 * puts one on screen had no test at all — so "every suite passes" would have
 * said nothing about a restyle of it.
 *
 * These pin the rules CLAUDE.md calls non-negotiable, plus the accessible name.
 */
const expense = (over: Partial<ExpenseSummary> = {}): ExpenseSummary => ({
  id: 'e1',
  amount: '1234.50',
  currency: 'PHP',
  occurredOn: '2026-08-31',
  merchant: 'Puregold',
  description: null,
  category: 'GROCERIES',
  categoryLabel: 'Groceries',
  ...over,
});

describe('ExpenseRow', () => {
  it('formats the amount through formatMoney rather than printing the raw string', async () => {
    // The raw value is "1234.50"; the rendered one is grouped and carries the
    // currency from `Intl.NumberFormat("en-PH")`. Asserting against
    // `formatMoney` rather than a literal, because hardcoding "₱1,234.50" here
    // would bake in the very symbol CLAUDE.md forbids writing by hand.
    await render(<ExpenseRow expense={expense()} />);

    expect(screen.getByText(formatMoney('1234.50'))).toBeOnTheScreen();
    expect(screen.queryByText('1234.50')).toBeNull();
  });

  it('keeps the minus sign in the text of a refund, not only its colour', async () => {
    // Spec §10: colour is never the only signal. A refund is a negative amount
    // that keeps its category, and someone who cannot distinguish the red must
    // still be able to tell it apart.
    await render(<ExpenseRow expense={expense({ amount: '-40.00' })} />);

    const rendered = formatMoney('-40.00');

    expect(rendered).toContain('-');
    expect(screen.getByText(rendered)).toBeOnTheScreen();
  });

  it('colours a refund negative and an ordinary expense not', async () => {
    const { rerender } = await render(<ExpenseRow expense={expense({ amount: '-40.00' })} />);
    expect(screen.getByText(formatMoney('-40.00')).props.className).toContain('text-negative');

    await rerender(<ExpenseRow expense={expense()} />);
    const positive = screen.getByText(formatMoney('1234.50'));

    expect(positive.props.className).toContain('text-text');
    expect(positive.props.className).not.toContain('text-negative');
  });

  it('never takes the absolute value of an amount', async () => {
    // The rule that turns a net total back into a gross one silently. A row is
    // not an aggregate, but it is where a stray `Math.abs` would be least
    // visible — the number still looks plausible.
    await render(<ExpenseRow expense={expense({ amount: '-40.00' })} />);

    expect(screen.queryByText(formatMoney('40.00'))).toBeNull();
  });

  it('announces the row as one record rather than five fragments', async () => {
    await render(<ExpenseRow expense={expense()} />);

    const row = screen.getByRole('button', {
      name: `Puregold, ${formatMoney('1234.50')}, Groceries, 2026-08-31`,
    });

    expect(row.props.accessibilityHint).toBe('Opens this expense');

    // One pressable for the whole row. **Not** `expect(row.props.accessible)` —
    // `Pressable` sets `accessible: accessible !== false`, so that assertion
    // holds whether or not the component passes the prop, and it passed with
    // the prop deleted. The composite label above is what does the grouping
    // work; this is what would catch the row splitting into several controls.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('names a merchantless expense rather than leaving a gap in the sentence', async () => {
    await render(<ExpenseRow expense={expense({ merchant: null })} />);

    expect(
      screen.getByRole('button', { name: /^No merchant, / }),
    ).toBeOnTheScreen();
  });
});
