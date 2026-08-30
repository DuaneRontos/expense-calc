import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';

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
// The intended route, as the guard would have put it in the URL.
const mockParams: { current: Record<string, unknown> } = { current: {} };
// A marker rather than a navigation: what matters is that the screen asked to
// leave, and where to — the same shape `authGuard.test.tsx` uses.
const mockRedirects: string[] = [];
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    back: () => {},
  },
  useLocalSearchParams: () => mockParams.current,
  Redirect: ({ href }: { href: string }) => {
    mockRedirects.push(href);
    return null;
  },
}));

beforeEach(async () => {
  mockParams.current = {};
  mockRedirects.length = 0;
  await api.session.clear();
});

afterEach(async () => {
  jest.restoreAllMocks();
  mockReplace.mockClear();
  await act(async () => {
    await api.session.clear();
  });
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
 * Exposed on `claude/shadcn-ui-integration-467462`, which adds NativeWind's
 * babel transform while measuring #108: that extra cold-start cost was enough
 * to trip this line, and cold runs there failed roughly half the time, always
 * with `Exceeded timeout of 20000 ms` — a number appearing nowhere in the
 * project config, so it reads as a mystery rather than as this override.
 *
 * **The measurement came from the NativeWind work; the bug did not.** This file
 * is the suite's slowest on a cold cache and was the only one capped below the
 * global, which was true of `main` before any of that landed — the transform
 * only made an existing margin too thin to survive.
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

  /**
   * #93 — signing in returns to the route the guard interrupted.
   *
   * Someone who opened a link to an expense, or whose session lapsed deep in
   * the list, was put back at the Overview and had to navigate again.
   */
  it('returns to the route the guard came from', async () => {
    mockParams.current = { next: '/expenses' };
    jest.spyOn(api, 'login').mockResolvedValue({ persisted: true });
    await render(<SignIn />);
    await fillIn();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/expenses'));
  });

  it('returns to a nested route, not just the section', async () => {
    mockParams.current = { next: '/expenses/abc-123' };
    jest.spyOn(api, 'login').mockResolvedValue({ persisted: true });
    await render(<SignIn />);
    await fillIn();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/expenses/abc-123'));
  });

  /**
   * The destination rides in a URL, and a URL is a thing you can send someone.
   * `safeReturnPath` is what refuses the off-site and traversal shapes; this
   * pins that the screen actually routes through it rather than trusting the
   * parameter.
   */
  it.each([
    ['an off-site absolute URL', 'https://evil.example/pwned'],
    ['a protocol-relative host', '//evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['traversal', '/expenses/../../etc'],
    ['an unknown route', '/not-a-destination'],
    ['the sign-in screen itself', '/sign-in'],
  ])('falls back to the Overview for %s', async (_label, next) => {
    mockParams.current = { next };
    jest.spyOn(api, 'login').mockResolvedValue({ persisted: true });
    await render(<SignIn />);
    await fillIn();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  /**
   * #94 — the mirror case. With a live session the form still rendered, and
   * submitting it spent a rate-limit slot and rotated a good session for
   * nothing, with the sign-out button sitting oddly above the form.
   */
  it('sends a visitor who already has a session away from the form', async () => {
    await act(async () => {
      await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
    });

    await render(<SignIn />);

    expect(mockRedirects).toEqual(['/']);
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  it('sends them to the intended route when the guard supplied one', async () => {
    mockParams.current = { next: '/expenses' };
    await act(async () => {
      await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
    });

    await render(<SignIn />);

    expect(mockRedirects).toEqual(['/expenses']);
  });

  /**
   * The rejecting shapes, through the *other* exit.
   *
   * The table above pins them against `mockReplace`, which is the post-submit
   * path only. Both branches read the same `target`, so today that coverage is
   * real — but a shared binding is exactly where a hole hides, which is the
   * lesson the `!submitted` mutation taught on this same file. This walks the
   * declarative branch instead.
   */
  it.each([
    ['an off-site absolute URL', 'https://evil.example/pwned'],
    ['a protocol-relative host', '//evil.example'],
    ['traversal', '/expenses/../../etc'],
    ['the sign-in screen itself', '/sign-in'],
  ])('turns a signed-in visitor away to the Overview for %s', async (_label, next) => {
    mockParams.current = { next };
    await act(async () => {
      await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
    });

    await render(<SignIn />);

    expect(mockRedirects).toEqual(['/']);
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
    // **Stays put on purpose.** The warning is the whole reason this branch
    // exists, and navigating away would take it off screen before it is read.
    // Stated in the screen's comment since #86 and unasserted until now.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRedirects).toHaveLength(0);
  });

  /**
   * The warning survives a login that really adopts a session.
   *
   * **The other tests here cannot catch this**, which is why this one mocks
   * `login` differently: they stub it wholesale, so no session is ever adopted,
   * `useSignedIn()` stays false and the redirect above cannot fire whatever
   * `submitted` says. Only a mock that performs the real side effect reaches
   * the state the flag exists for — session live, warning showing, and the
   * screen required to stay put so it can be read.
   *
   * Found by mutation: removing `!submitted` from the redirect left all 23
   * other tests green.
   */
  it('stays on the form when a real session is adopted but not persisted', async () => {
    jest.spyOn(api, 'login').mockImplementation(async () => {
      await api.session.adopt({ accessToken: 'access-1', expiresInSeconds: 900 }, true);
      return { persisted: false };
    });

    await render(<SignIn />);
    await fillIn();

    expect(await screen.findByText(/sign in again/i)).toBeOnTheScreen();
    expect(mockRedirects).toHaveLength(0);
    expect(mockReplace).not.toHaveBeenCalled();
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
