import { render, screen } from '@testing-library/react-native';

import { ExpenseFilters } from '../ExpenseFilters';
import { ExpenseQueryProvider } from '../ExpenseQueryProvider';
import { ReclassifyControl } from '../ReclassifyControl';
import { ApiError } from '../../api/problem';

/**
 * The category loaders are the fourth and fifth copies of the branch #86
 * corrected on the Overview (issue: shared failure card).
 *
 * They are deliberately *not* switched to `RequestFailure`: these are compact
 * notices inside a form, not the screen-replacing card, and a second "Sign in"
 * link in the filter sidebar would sit beside the one the list already shows.
 * What they share with it is the decision — retrying a refused credential
 * cannot succeed — so only that is extracted.
 */
const failure = { current: null as Error | null };

jest.mock('../useCategories', () => ({
  useCategories: () => ({
    categories: [],
    loading: false,
    error: jest.requireMock('../useCategories').__failure.current,
    retry: () => {},
  }),
  __failure: failure,
}));

const refused = () =>
  new ApiError({
    status: 401,
    type: 'https://expense-calc.invalid/problems/unauthenticated',
    title: 'Unauthenticated',
  });

afterEach(() => {
  failure.current = null;
});

describe('the category loaders, when the credential is refused', () => {
  it('drops the retry from the filter sidebar but still says what is wrong', async () => {
    failure.current = refused();

    await render(
      <ExpenseQueryProvider>
        <ExpenseFilters />
      </ExpenseQueryProvider>,
    );

    // Anchored on the message, so the absence below is an absence within a tree
    // known to exist.
    expect(screen.getByText('Categories could not be loaded.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Retry loading categories')).toBeNull();
  });

  it('keeps the retry for a failure retrying could fix', async () => {
    failure.current = new ApiError({ status: 503, title: 'Service Unavailable' });

    await render(
      <ExpenseQueryProvider>
        <ExpenseFilters />
      </ExpenseQueryProvider>,
    );

    expect(screen.getByLabelText('Retry loading categories')).toBeOnTheScreen();
  });

  it('drops the retry from the reclassify control too', async () => {
    failure.current = refused();

    await render(
      <ReclassifyControl current="GROCERIES" onReclassify={() => {}} submitting={false} errors={{}} />,
    );

    expect(screen.getByText('Categories could not be loaded.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Retry loading categories')).toBeNull();
  });

  it('keeps the reclassify retry for a failure retrying could fix', async () => {
    // **The pair, without which the test above proves nothing.** Deleting that
    // control outright left the whole suite green: an assertion that something
    // is absent cannot tell "hidden because signed out" from "never rendered".
    failure.current = new ApiError({ status: 503, title: 'Service Unavailable' });

    await render(
      <ReclassifyControl current="GROCERIES" onReclassify={() => {}} submitting={false} errors={{}} />,
    );

    expect(screen.getByLabelText('Retry loading categories')).toBeOnTheScreen();
  });
});
