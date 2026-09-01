import { render, screen, waitFor } from '@testing-library/react-native';

// Imported from outside `app/` on purpose: expo-router turns every `.tsx` under
// that directory into a route. Same reason as `expensesFailure.test.tsx`.
import Expenses from '../../../app/expenses/index';
import { api } from '../../api/client';
import { ExpenseQueryProvider } from '../ExpenseQueryProvider';
import type { ExpenseSummary } from '../../api/types';

jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-router', () => ({
  router: { navigate: () => {}, replace: () => {}, push: () => {} },
  useFocusEffect: () => {},
}));

const rows = (n: number): ExpenseSummary[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    amount: '10.00',
    currency: 'PHP',
    occurredOn: '2026-08-31',
    merchant: `Shop ${i}`,
    description: null,
    category: 'GROCERIES' as const,
    categoryLabel: 'Groceries',
  }));

const page = (items: ExpenseSummary[]) => ({
  items,
  page: 0,
  size: items.length || 20,
  totalItems: items.length,
  totalPages: 1,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the expense list', () => {
  it('does not render its whole data set', async () => {
    /*
     * **The reason #116 kept `FlatList`, pinned.** Spec §10 targets 50,000
     * expenses, so the list must window rather than mount every row — and a
     * refactor to `items.map(…)` inside a `ScrollView` looks identical in
     * every other test.
     *
     * `VirtualizedList` honours `initialNumToRender` under jsdom without an
     * `onLayout`, which is what makes this checkable at all. It does not prove
     * scroll performance on a device — nothing here can — but it does pin the
     * property that matters: the list does not render its data.
     */
    jest.spyOn(api, 'expenses').mockResolvedValue(page(rows(200)));

    await render(
      <ExpenseQueryProvider>
        <Expenses />
      </ExpenseQueryProvider>,
    );
    await waitFor(() => expect(screen.queryByText('Shop 0')).not.toBeNull());

    // Every row is a button, plus the header's "New expense".
    expect(screen.getAllByRole('button').length).toBeLessThan(200);
  });

  it('shows skeletons while loading and the empty state only once settled', async () => {
    /*
     * These two share one `ListEmptyComponent` slot and are the arms of one
     * ternary, so they cannot both render — but that was an argument rather
     * than a test until the wrapper gained a `testID`. Every `Skeleton` is
     * `aria-hidden`, so there was no other handle to query.
     */
    let release!: (value: ReturnType<typeof page>) => void;
    jest
      .spyOn(api, 'expenses')
      .mockReturnValue(new Promise((resolve) => {
        release = resolve;
      }) as ReturnType<typeof api.expenses>);

    await render(
      <ExpenseQueryProvider>
        <Expenses />
      </ExpenseQueryProvider>,
    );

    expect(screen.getByTestId('expense-skeletons')).toBeOnTheScreen();
    expect(screen.queryByText('No expenses yet.')).toBeNull();

    release(page([]));

    await waitFor(() => expect(screen.queryByText('No expenses yet.')).not.toBeNull());
    expect(screen.queryByTestId('expense-skeletons')).toBeNull();
  });
});
