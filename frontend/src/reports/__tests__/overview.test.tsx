import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';

// The screen under test, imported from outside this directory on purpose:
// expo-router turns *every* `.tsx` under `app/` into a route, so a test file
// beside the screen would be served as one.
import Overview from '../../../app/index';
import { api } from '../../api/client';
import { ApiError } from '../../api/problem';
import type { CategoryBreakdown, PeriodComparison, SpendOverTime } from '../../api/types';

jest.mock('expo-router/head', () => ({
  __esModule: true,
  default: () => null,
}));

// `mock`-prefixed so jest's hoisted factory may read it. See `AppShell.test.tsx`.
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
}));

const PERIOD = { from: '2026-08-01', to: '2026-09-01' };

const breakdown = (): CategoryBreakdown => ({
  period: PERIOD,
  currency: 'PHP',
  total: '100.00',
  buckets: [{ key: 'GROCERIES', label: 'Groceries', total: '100.00' }],
});

const overTime = (bucket: SpendOverTime['bucket']): SpendOverTime => ({
  period: PERIOD,
  bucket,
  currency: 'PHP',
  total: '100.00',
  buckets: [{ key: '2026-08-01', label: '1 Aug 2026', total: '100.00' }],
});

const comparison = (): PeriodComparison => ({
  current: PERIOD,
  previous: { from: '2026-07-01', to: '2026-08-01' },
  currency: 'PHP',
  currentTotal: '100.00',
  previousTotal: '30000.00',
  buckets: [],
});

function stubReports(bucket: SpendOverTime['bucket'] = 'DAY') {
  jest.spyOn(api, 'byCategory').mockResolvedValue(breakdown());
  jest.spyOn(api, 'overTime').mockResolvedValue(overTime(bucket));
  jest.spyOn(api, 'compare').mockResolvedValue(comparison());
}

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
});

describe('Overview', () => {
  it('states the prior period as the half-open window it is', async () => {
    // "1 July to 1 August" reads as including 1 August — precisely the day the
    // window excludes and the total printed beside it leaves out.
    stubReports();
    await render(<Overview />);

    await waitFor(() =>
      expect(screen.getByText(/2026-07-01 up to but not including 2026-08-01/)).toBeOnTheScreen(),
    );
  });

  it('titles the over-time legend from the bucket the response used', async () => {
    // Hardcoded, the heading contradicted the bars underneath it: seven days of
    // July drawn beside twenty-three of August, both labelled whole months.
    stubReports('WEEK');
    await render(<Overview />);

    await waitFor(() => expect(screen.getByText('Net per week')).toBeOnTheScreen());
    expect(screen.queryByText('Net per month')).toBeNull();
  });

  it('offers sign-in rather than a retry when the reports refuse the credential', async () => {
    // The other half of the cold-start fix. The client now lets a browser with
    // no cookie through unauthenticated, which against a deployed API means the
    // reports come back 401 — and "Try again" is the wrong control for that,
    // because trying again without signing in produces the identical 401 for
    // as long as the user is willing to tap.
    const failure = new ApiError({
      status: 401,
      type: 'https://expense-calc.invalid/problems/unauthenticated',
      title: 'Unauthenticated',
      detail: 'Sign in to view your expenses.',
    });
    jest.spyOn(api, 'byCategory').mockRejectedValue(failure);
    jest.spyOn(api, 'overTime').mockRejectedValue(failure);
    jest.spyOn(api, 'compare').mockRejectedValue(failure);

    await render(<Overview />);

    const button = await screen.findByRole('button', { name: 'Sign in' });
    // Anchored on a control known to be present, so the absence asserted next
    // is an absence within a tree that exists.
    expect(button).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    await userEvent.setup().press(button);
    expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
  });

  it('answers a retry with something other than the card already on screen', async () => {
    // The failure this exists for: tapping "Try again" left the rendered output
    // byte-identical, so the tap looked like it had done nothing — and the
    // natural response to that is to tap again and fan out three more requests.
    const failure = new ApiError({ status: 503, title: 'Service Unavailable' });
    jest.spyOn(api, 'byCategory').mockRejectedValue(failure);
    jest.spyOn(api, 'overTime').mockRejectedValue(failure);
    jest.spyOn(api, 'compare').mockRejectedValue(failure);

    await render(<Overview />);
    const button = await screen.findByRole('button', { name: 'Try again' });

    const second = gate();
    const held = () => second.held.then<never>(() => Promise.reject(failure));
    jest.spyOn(api, 'byCategory').mockImplementation(held);
    jest.spyOn(api, 'overTime').mockImplementation(held);
    jest.spyOn(api, 'compare').mockImplementation(held);

    await userEvent.press(button);

    expect(screen.getByText('Trying…')).toBeOnTheScreen();
    expect(screen.queryByText('Try again')).toBeNull();
    // Disabled while it runs, so a second tap cannot fan out three more reads.
    expect(screen.getByRole('button', { name: 'Trying…' })).toBeDisabled();

    await act(async () => {
      second.release();
      await second.held;
    });
    await waitFor(() => expect(screen.getByText('Try again')).toBeOnTheScreen());
  });
});
