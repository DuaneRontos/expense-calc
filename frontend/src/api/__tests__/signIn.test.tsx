import { render, screen, userEvent, waitFor } from '@testing-library/react-native';

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

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Username'), 'dev');
  await user.type(screen.getByLabelText('Password'), 'dev');
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
