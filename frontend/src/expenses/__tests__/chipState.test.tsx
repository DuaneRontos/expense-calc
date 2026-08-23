import { render, screen, userEvent } from '@testing-library/react-native';

import { ExpenseFilters } from '../ExpenseFilters';
import { ExpenseQueryProvider } from '../ExpenseQueryProvider';
import { ReclassifyControl } from '../ReclassifyControl';
import type { CategoryView } from '../../api/types';

/**
 * The category chips announce their state (issue #69).
 *
 * Both controls read as one convention with `PeriodPicker`: the state travels
 * as `aria-checked`, because that is the only form both platforms read. See
 * `PeriodPicker.test.tsx` for why `toBeChecked()` is the assertion that has
 * teeth here.
 */
const CATEGORIES: CategoryView[] = [
  { key: 'GROCERIES', label: 'Groceries' },
  { key: 'TRANSPORT', label: 'Transport' },
];

// The taxonomy comes from the server, so the chips are whatever `/categories`
// returned. Repeated literally rather than read from `CATEGORIES` because
// `jest.mock` is hoisted above it.
jest.mock('../useCategories', () => ({
  useCategories: () => ({
    categories: [
      { key: 'GROCERIES', label: 'Groceries' },
      { key: 'TRANSPORT', label: 'Transport' },
    ],
    loading: false,
    error: null,
    retry: () => {},
  }),
}));

describe('ReclassifyControl', () => {
  it('checks the expense’s current category and nothing else', async () => {
    await render(
      <ReclassifyControl
        current="GROCERIES"
        errors={{}}
        submitting={false}
        onReclassify={() => {}}
      />,
    );

    expect(screen.getByLabelText('Groceries')).toBeChecked();
    expect(screen.getByLabelText('Transport')).not.toBeChecked();
  });

  it('keeps the iOS selected trait on the checked radio', async () => {
    await render(
      <ReclassifyControl
        current="GROCERIES"
        errors={{}}
        submitting={false}
        onReclassify={() => {}}
      />,
    );

    expect(screen.getByLabelText('Groceries')).toBeSelected();
  });
});

describe('ExpenseFilters', () => {
  it('leaves every category unchecked until one is picked', async () => {
    await render(
      <ExpenseQueryProvider>
        <ExpenseFilters />
      </ExpenseQueryProvider>,
    );

    for (const category of CATEGORIES) {
      expect(screen.getByLabelText(category.label)).not.toBeChecked();
    }
  });

  it('checks a category once it is toggled on', async () => {
    const user = userEvent.setup();
    await render(
      <ExpenseQueryProvider>
        <ExpenseFilters />
      </ExpenseQueryProvider>,
    );

    await user.press(screen.getByLabelText('Groceries'));

    expect(screen.getByLabelText('Groceries')).toBeChecked();
    expect(screen.getByLabelText('Transport')).not.toBeChecked();
  });

  /**
   * **The checkbox's half of issue #69 is not pinned here, and cannot be.**
   *
   * `toBeChecked()` reads `aria-checked ?? accessibilityState.checked`, and RN
   * merges the flat prop into `accessibilityState` before it reaches the host
   * node — a `Pressable` given `aria-checked` renders with
   * `accessibilityState: {checked: true}` and no `aria-checked` at all. Under
   * the native renderer Jest runs, the broken form and the fixed one are the
   * same tree, so no assertion distinguishes them.
   *
   * The radio tests above do catch their half, for a reason specific to them:
   * those chips carried `selected` and never `checked`, so the state was
   * missing outright rather than merely unreachable.
   *
   * Pinning the checkbox would take a test running under `jest-expo/web`,
   * where RNW's allowlist is what filters the props. That is test
   * infrastructure this repo doesn't have yet.
   */
});
