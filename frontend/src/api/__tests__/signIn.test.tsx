import { fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';

// Imported from outside `app/` on purpose: expo-router turns *every* `.tsx`
// under that directory into a route, so a test file beside the screen would be
// served as one. `overview.test.tsx` reaches across for the same reason.
import SignIn from '../../../app/sign-in';
import { api } from '../client';
import { ApiError } from '../problem';

jest.mock('expo-router/head', () => ({
  __esModule: true,
  default: () => null,
}));

// `mock`-prefixed: jest hoists the factory above this declaration, and only
// names spelled that way are allowed through the guard against reading a
// variable that is still uninitialised when the factory runs.
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    back: () => {},
  },
}));

afterEach(() => {
  jest.restoreAllMocks();
  mockReplace.mockClear();
});

/*
 * There was a `jest.setTimeout(20_000)` here. It is gone deliberately.
 *
 * It was written in #86 to raise this file off jest's 5s default, for the
 * reason that still applies: the first test pays this file's cold-start cost,
 * because the first `render` initialises a good deal of React Native. It timed
 * out in CI while taking well under a second locally.
 *
 * The next day, `testTimeout: 30000` landed in `package.json` for the same
 * class of failure across the whole suite — which turned this line from a
 * raise off 5s into a **lowering** off 30s, silently, in the one file least
 * able to afford it. Nothing failed at the time, so nothing noticed.
 *
 * Adding NativeWind's transform to the babel pipeline (#108) was enough extra
 * cold-start cost to expose it: cold runs failed here roughly half the time,
 * always with `Exceeded timeout of 20000 ms` — a number that appears nowhere in
 * the project config and so reads as a mystery.
 *
 * `frontend/README.md` states the rule this follows: raise `testTimeout`, do
 * not add per-test overrides, because an override rescues the one test that
 * lost the race and leaves the next one to find it. A per-file override that
 * undercuts the global is the same trap wearing a larger scope.
 */

/**
 * Fills both fields and submits.
 *
 * **`fireEvent` throughout, not `userEvent`.** Typing keystroke by keystroke
 * cost roughly a second per field, and `userEvent.press` chains several real
 * timer waits plus React Native's 130ms minimum press duration — none of which
 * this file is testing. Together they had the first test at 5.5s locally and
 * over the limit in CI.
 *
 * The one place `userEvent` still earns its cost is the readiness test below:
 * `user.press` respects `disabled` and `fireEvent.press` does not, which is
 * exactly the difference that test exists to detect.
 */
async function fillIn() {
  // Awaited, like `render` above: this renderer is async, and an un-awaited
  // `fireEvent` leaves the state update unflushed — the field keeps its old
  // value, the button stays disabled, and the press does nothing.
  await fireEvent.changeText(screen.getByLabelText('Username'), 'dev');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'dev');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign-in screen', () => {
  it('signs in with the entered credentials and returns to the Overview', async () => {
    // The gap this screen fills. `client.login()` existed and was covered by
    // tests, but nothing in the app called it — so on web there was no way to
    // establish the cookie that `/auth/refresh` looks for, and a cold load
    // could only ever find no session.
    const login = jest.spyOn(api, 'login').mockResolvedValue({ persisted: true });
    await render(<SignIn />);
    await fillIn();

    await waitFor(() => expect(login).toHaveBeenCalledWith({ username: 'dev', password: 'dev' }));
    // `replace`, not `push`: going "back" to a sign-in form from inside a live
    // session is not a destination.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('shows the server’s reason when the credentials are rejected', async () => {
    jest.spyOn(api, 'login').mockRejectedValue(
      new ApiError({
        status: 401,
        type: 'https://expense-calc.invalid/problems/unauthenticated',
        title: 'Unauthenticated',
        detail: 'Username or password is incorrect.',
      }),
    );
    await render(<SignIn />);
    await fillIn();

    // The server's own sentence, not a generic one. Spec §8 asks for `detail`
    // to be surfaced rather than replaced.
    expect(await screen.findByText('Username or password is incorrect.')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('warns when the session will not outlive the access token', async () => {
    // `AdoptResult.persisted` exists precisely so this screen can say so: a
    // device with no secure lock screen has no Keystore to write to, and the
    // session then ends silently in fifteen minutes. `session.ts` names this
    // screen as the place that tells the user rather than letting them find out.
    jest.spyOn(api, 'login').mockResolvedValue({ persisted: false });
    await render(<SignIn />);
    await fillIn();

    expect(await screen.findByText(/sign in again/i)).toBeOnTheScreen();
  });

  it('announces both outcomes, which appear with no other cue that anything happened', async () => {
    // Both messages arrive after a press, and the button label goes back to
    // "Sign in" — so without a live region a screen-reader user gets silence.
    // That is worst for the persistence warning, which is the one message on
    // this screen that exists *only* to be read: the sign-in worked, so nothing
    // else on screen is going to say the session will not survive.
    //
    // `accessibilityLiveRegion` rather than `aria-live`, matching
    // `AppShell.tsx:159`. It is the cross-platform spelling — react-native-web
    // maps it to `aria-live`, and Android reads it natively, which bare
    // `aria-live` would not cover.
    jest.spyOn(api, 'login').mockRejectedValue(
      new ApiError({ status: 401, title: 'Unauthenticated', detail: 'Wrong password.' }),
    );
    await render(<SignIn />);
    await fillIn();

    expect(await screen.findByText('Wrong password.')).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
  });

  it('announces a sign-in that could not be persisted', async () => {
    jest.spyOn(api, 'login').mockResolvedValue({ persisted: false });
    await render(<SignIn />);
    await fillIn();

    expect(await screen.findByText(/sign in again/i)).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
  });

  it('refuses to submit before both fields are filled', async () => {
    // Anchored on a control known to be on screen, so the "not called" below is
    // an absence within a tree that exists rather than the whole tree missing.
    const login = jest.spyOn(api, 'login').mockResolvedValue({ persisted: true });
    const user = userEvent.setup();

    await render(<SignIn />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    await user.press(button);

    expect(button).toBeOnTheScreen();
    expect(login).not.toHaveBeenCalled();
  });
});
