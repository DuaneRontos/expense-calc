import { render, screen, userEvent } from '@testing-library/react-native';

import { ExpenseFilters } from '../ExpenseFilters';
import { ExpenseQueryProvider } from '../ExpenseQueryProvider';
import { SortControl } from '../SortControl';

/**
 * Two a11y contracts that nothing covered before #115.
 *
 * `SortControl` had no test of its own, and the `role="group"` on the category
 * chips — the #69-era finding, written up at length in `ExpenseFilters` — was
 * asserted nowhere. Both survive the `Chip` migration by being passed straight
 * through, which is exactly the kind of thing that regresses silently.
 */
jest.mock('../useCategories', () => ({
  useCategories: () => ({
    categories: [{ key: 'GROCERIES', label: 'Groceries' }],
    loading: false,
    error: null,
    retry: () => {},
  }),
}));

describe('SortControl', () => {
  it('announces the active field as selected and the rest as not', async () => {
    await render(
      <ExpenseQueryProvider>
        <SortControl />
      </ExpenseQueryProvider>,
    );

    // The default sort is by date, descending. The accessible name carries the
    // direction in words, because the ↓ glyph is decoration a screen reader
    // should not have to interpret.
    expect(
      screen.getByRole('button', { name: /Sorted by Date, descending\. Activate to reverse\./ }),
    ).toBeSelected();
    expect(screen.getByRole('button', { name: 'Sort by Amount' })).not.toBeSelected();
  });

  it('reverses the direction when the active field is pressed again', async () => {
    const user = userEvent.setup();

    await render(
      <ExpenseQueryProvider>
        <SortControl />
      </ExpenseQueryProvider>,
    );

    await user.press(screen.getByRole('button', { name: /Sorted by Date, descending/ }));

    // The name changes with the state, which is correct here and the opposite
    // of the sign-in button: this control *is* a different control once
    // reversed, and the name is how a screen reader user knows the press took.
    expect(
      screen.getByRole('button', { name: /Sorted by Date, ascending\. Activate to reverse\./ }),
    ).toBeSelected();
  });

  it('starts a newly chosen field descending', async () => {
    const user = userEvent.setup();

    await render(
      <ExpenseQueryProvider>
        <SortControl />
      </ExpenseQueryProvider>,
    );

    await user.press(screen.getByRole('button', { name: 'Sort by Amount' }));

    expect(
      screen.getByRole('button', { name: /Sorted by Amount, descending/ }),
    ).toBeSelected();
  });
});

describe('the category filter chips', () => {
  it('are announced as one named group', async () => {
    // `role="group"` rather than `accessibilityRole`: RN's union has no `group`
    // member, and the two props reach opposite platforms. Web-only by design —
    // Android drops it and iOS has no trait — which is why this asserts the
    // prop rather than a rendered outcome.
    await render(
      <ExpenseQueryProvider>
        <ExpenseFilters />
      </ExpenseQueryProvider>,
    );

    const group = screen.getByLabelText('Category');

    expect(group.props.role).toBe('group');
  });
});
