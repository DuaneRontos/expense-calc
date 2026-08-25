import { fireEvent, render, screen } from '@testing-library/react-native';

// Imported from outside `app/` on purpose: expo-router turns every `.tsx` under
// that directory into a route, so a test file beside the screen would be served
// as one. `overview.test.tsx` reaches across for the same reason.
import Expenses from '../../../app/expenses/index';
import ExpenseDetail from '../../../app/expenses/[id]';
import { api } from '../../api/client';
import { ApiError } from '../../api/problem';
import { ExpenseQueryProvider } from '../ExpenseQueryProvider';

jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));

// `mock`-prefixed so jest's hoisted factory may read them.
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({ id: 'e-1' }),
}));

const refused = () =>
  new ApiError({
    status: 401,
    type: 'https://expense-calc.invalid/problems/unauthenticated',
    title: 'Unauthenticated',
    detail: 'Sign in to view your expenses.',
  });

/** A promise the test releases by hand, to hold a request visibly in flight. */
function gate() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

afterEach(() => {
  jest.restoreAllMocks();
  mockNavigate.mockClear();
  mockReplace.mockClear();
});

describe('the expense list, when the credential is refused', () => {
  it('offers a way in rather than a retry that cannot work', async () => {
    // The Overview learned this in #86 and these screens did not — the branch
    // was copied, so the reasoning stayed on the screen it was written for.
    jest.spyOn(api, 'expenses').mockRejectedValue(refused());

    await render(
      <ExpenseQueryProvider>
        <Expenses />
      </ExpenseQueryProvider>,
    );

    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(button).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    await fireEvent.press(button);
    expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
  });

  it('still offers a retry for a failure retrying could fix', async () => {
    jest
      .spyOn(api, 'expenses')
      .mockRejectedValue(new ApiError({ status: 503, title: 'Service Unavailable' }));

    await render(
      <ExpenseQueryProvider>
        <Expenses />
      </ExpenseQueryProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});

describe('the expense detail, when the credential is refused', () => {
  it('offers a way in rather than calling it a missing expense', async () => {
    // This screen said "Could not load this expense", which is a statement about
    // the expense. A 401 is a statement about the reader, and the difference
    // matters: one sends you looking for a deleted row, the other tells you to
    // sign in.
    jest.spyOn(api, 'expense').mockRejectedValue(refused());

    await render(<ExpenseDetail />);

    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(button).toBeOnTheScreen();
    expect(screen.queryByText('Could not load this expense.')).toBeNull();

    await fireEvent.press(button);
    expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
  });

  it('carries the retry on the button rather than answering the tap with nothing', async () => {
    // `retrying={loading}` was inert: the spinner guard above the error branch
    // returns whenever `loading` is true, so the branch only ever ran with it
    // false — and `useExpenseDetail.load` never set it back to true on a reload
    // anyway. Two mechanisms, both of which had to be true for the prop to work.
    //
    // The result is the failure the shared card exists to prevent, and which its
    // own comment describes: a tap that redraws the identical card reads as a
    // tap that did nothing.
    const failure = new ApiError({ status: 503, title: 'Service Unavailable' });
    jest.spyOn(api, 'expense').mockRejectedValue(failure);

    await render(<ExpenseDetail />);
    const button = await screen.findByRole('button', { name: 'Try again' });

    // The retry is held open, so the in-flight state is observable.
    const second = gate();
    jest.spyOn(api, 'expense').mockImplementation(() => second.held.then<never>(() => Promise.reject(failure)));
    // **Deliberately not awaited.** The press starts a request this test is
    // holding open, and awaiting the flush would wait for it to settle — which
    // is precisely the state being observed. `findBy*` below does the waiting.
    void fireEvent.press(button);

    expect(await screen.findByRole('button', { name: 'Trying…' })).toBeOnTheScreen();
    second.release();
  });

  it('still says a deleted expense is gone rather than offering a sign-in', async () => {
    // A 404 is neither an auth problem nor worth retrying, and the existing
    // wording is the right one.
    jest
      .spyOn(api, 'expense')
      .mockRejectedValue(new ApiError({ status: 404, title: 'Not Found' }));

    await render(<ExpenseDetail />);

    expect(await screen.findByText('That expense no longer exists.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});
