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

/**
 * Fills both fields and submits.
 *
 * **`fireEvent.changeText` for the fields, `userEvent.press` for the button.**
 * Typing keystroke-by-keystroke costs roughly a second per field and nothing
 * here tests keystroke handling — with four callers this suite's first test was
 * landing at 5.5s against jest's 5s default and failing on a cold run. The press
 * stays `userEvent`, which respects `disabled`; `fireEvent.press` does not, and
 * the readiness test below depends on that difference.
 */
async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  // Awaited, like `render` above: this renderer is async, and an un-awaited
  // `fireEvent` leaves the state update unflushed — the field keeps its old
  // value, the button stays disabled, and the press below does nothing.
  await fireEvent.changeText(screen.getByLabelText('Username'), 'dev');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'dev');
  await user.press(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign-in screen', () => {
  it('signs in with the entered credentials and returns to the Overview', async () => {
    // The gap this screen fills. `client.login()` existed and was covered by
    // tests, but nothing in the app called it — so on web there was no way to
    // establish the cookie that `/auth/refresh` looks for, and a cold load
    // could only ever find no session.
    const login = jest.spyOn(api, 'login').mockResolvedValue({ persisted: true });
    const user = userEvent.setup();

    await render(<SignIn />);
    await fillIn(user);

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
    const user = userEvent.setup();

    await render(<SignIn />);
    await fillIn(user);

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
    const user = userEvent.setup();

    await render(<SignIn />);
    await fillIn(user);

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
    const user = userEvent.setup();

    await render(<SignIn />);
    await fillIn(user);

    expect(await screen.findByText('Wrong password.')).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
  });

  it('announces a sign-in that could not be persisted', async () => {
    jest.spyOn(api, 'login').mockResolvedValue({ persisted: false });
    const user = userEvent.setup();

    await render(<SignIn />);
    await fillIn(user);

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
