import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { ApiError } from '../problem';
import { RequestFailure } from '../RequestFailure';

// `mock`-prefixed so jest's hoisted factory may read it. See `AppShell.test.tsx`.
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
}));

afterEach(() => {
  mockNavigate.mockClear();
});

const refused = () =>
  new ApiError({
    status: 401,
    type: 'https://expense-calc.invalid/problems/unauthenticated',
    title: 'Unauthenticated',
    detail: 'Sign in to view your expenses.',
  });

describe('RequestFailure', () => {
  it('offers a way in, not a retry, when the credential was refused', async () => {
    // Retrying a 401 without signing in reproduces the identical refusal for as
    // long as someone is willing to tap — and on the Overview each tap fans out
    // three more requests.
    const onRetry = jest.fn();
    await render(<RequestFailure error={refused()} onRetry={onRetry} />);

    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeOnTheScreen();
    // An absence within a tree known to exist, thanks to the line above.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    await fireEvent.press(button);
    expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('offers a retry for a failure that retrying could actually fix', async () => {
    const onRetry = jest.fn();
    await render(
      <RequestFailure error={new ApiError({ status: 503, title: 'Service Unavailable' })} onRetry={onRetry} />,
    );

    const button = screen.getByRole('button', { name: 'Try again' });
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();

    await fireEvent.press(button);
    expect(onRetry).toHaveBeenCalled();
  });

  it('says the server’s own sentence rather than a generic one', async () => {
    // Spec §8 asks for `detail` to be surfaced rather than replaced.
    await render(<RequestFailure error={refused()} />);

    expect(screen.getByText('Unauthenticated')).toBeOnTheScreen();
    expect(screen.getByText('Sign in to view your expenses.')).toBeOnTheScreen();
  });

  it('does not tell a signed-out reader to try again, directly above a sign-in button', async () => {
    // **Every 401 this app can actually surface carries no `detail`.** The
    // filter chain answers a tokenless request before any controller runs, so
    // `readProblem` sees only a status and a title; and `client.ts` raises its
    // own "Session expired" and "Signed out" with none either. The generic
    // fallback therefore printed "Try again in a moment." immediately above the
    // button that exists because trying again cannot work.
    //
    // The browser check that missed this used a stub which does return a
    // `detail` — so the fixture, not the code, was what made it read correctly.
    await render(<RequestFailure error={new ApiError({ status: 401, title: 'Session expired' })} />);

    expect(screen.getByText('Session expired')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
    expect(screen.queryByText('Try again in a moment.')).toBeNull();
  });

  it('does not blame the server for a request that never reached one', async () => {
    // A `TypeError` from fetch is a connection failure: there is no status and
    // no problem document, so reading one would print "undefined".
    await render(<RequestFailure error={new TypeError('Failed to fetch')} onRetry={() => {}} />);

    expect(screen.getByText('Could not reach the server')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('carries the attempt on the button rather than answering a tap with nothing', async () => {
    // The card stays up while the retry runs. Re-rendering the identical card
    // would look like the tap did nothing — and on a connection-refused, which
    // can hang for tens of seconds on web, the natural response to that is to
    // tap again.
    const onRetry = jest.fn();
    await render(
      <RequestFailure
        error={new ApiError({ status: 503, title: 'Service Unavailable' })}
        onRetry={onRetry}
        retrying
      />,
    );

    const button = screen.getByRole('button', { name: 'Trying…' });
    expect(button).toBeOnTheScreen();
    // `disabled` alone never reaches the DOM under react-native-web, so the
    // state is declared as well as applied.
    expect(button).toHaveProp('accessibilityState', expect.objectContaining({ disabled: true }));

    await userEvent.setup().press(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('omits the retry entirely when the caller has nothing to retry', async () => {
    await render(<RequestFailure error={new ApiError({ status: 500, title: 'Server Error' })} />);

    expect(screen.getByText('Server Error')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
