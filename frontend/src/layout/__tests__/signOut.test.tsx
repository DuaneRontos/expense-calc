import { act, render, screen, userEvent } from '@testing-library/react-native';

import { AppShell } from '../AppShell';
import { BREAKPOINTS, type LayoutSize } from '../breakpoints';
import { api } from '../../api/client';
import { NEW_EXPENSE_DRAFT, clearAllDrafts, readDraft, saveDraft } from '../../expenses/draftStore';
import { ExpenseQueryProvider } from '../../expenses/ExpenseQueryProvider';

/**
 * Sign-out (the counterpart to the sign-in screen #86 added).
 *
 * `client.logout()` has existed and been tested since #57 and nothing called
 * it — the same shape `login()` was in before #86. This is the control that
 * calls it.
 *
 * **It is conditional, and that is the whole design.** Under the
 * `insecure-local` profile no session is ever adopted, so an unconditional
 * "Sign out" would sit in the chrome of an app you were never signed in to and
 * do nothing you could observe. `useSignedIn()` is what makes the condition
 * reactive rather than a snapshot taken at mount.
 */
const mockReplace = jest.fn();

// `mock`-prefixed so the hoisted factory may read it.
let mockPathname = '/expenses';

jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  router: {
    navigate: () => {},
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../expenses/useCategories', () => ({
  useCategories: () => ({ categories: [], loading: false, error: null, retry: () => {} }),
}));

// `mock`-prefixed so the hoisted factory above may reference it.
let mockWidth = BREAKPOINTS.compact + 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 2, fontScale: 1 }),
}));

const BANDS: { size: LayoutSize; width: number }[] = [
  { size: 'compact', width: BREAKPOINTS.compact - 1 },
  { size: 'medium', width: BREAKPOINTS.compact + 1 },
  { size: 'expanded', width: BREAKPOINTS.expanded + 1 },
];

// Web-shaped: no `refreshToken` in the body at all, because the server put it
// in an httpOnly cookie (issue #57). Matches what `viaCookie: true` means.
const TOKENS = { accessToken: 'access-1', expiresInSeconds: 900 };

// Rendered inside the provider because the expanded band mounts
// `ExpenseFilters`, and `useExpenseQuery` throws outside one.
const renderShell = () =>
  render(
    <ExpenseQueryProvider>
      <AppShell>
        <></>
      </AppShell>
    </ExpenseQueryProvider>,
  );

/** `viaCookie` so the refresh-token store is never touched — see useSignedIn.test.ts. */
const signIn = () => act(async () => {
  await api.session.adopt(TOKENS, true);
});

/**
 * Both presses, since #98 put a question between the tap and the request.
 *
 * `userEvent` rather than `fireEvent` throughout this file: `user.press`
 * respects `disabled` and `fireEvent.press` does not, which is the difference
 * the readiness test below exists to detect.
 */
const confirmSignOut = async () => {
  await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  await userEvent.press(screen.getByRole('button', { name: 'Confirm signing out' }));
};

/**
 * Wrapped, because RNTL registers its auto-cleanup at the root level and Jest
 * runs an inner `afterEach` *first* — so the tree is still mounted and clearing
 * the session notifies a live subscriber outside `act`. Warnings that all pass
 * are how a real one becomes invisible.
 */
const resetSession = () => act(async () => {
  await api.session.clear();
});

/**
 * Only the visibility rule is banded.
 *
 * `SignOutButton` sits in the header row, which every band renders — so all
 * three exercise an identical subtree, and banding the behaviour below would
 * assert the same thing three times. What banding is worth here is catching
 * someone moving the control into a band-conditional branch, where it would
 * quietly vanish on one or two of the three targets. That is a visibility
 * question, so it lives here and the rest does not.
 */
describe.each(BANDS)('Sign out visibility ($size)', (band) => {
  beforeEach(async () => {
    mockWidth = band.width;
    mockReplace.mockClear();
    await api.session.clear();
  });

  afterEach(resetSession);

  /**
   * The absence is asserted inside a tree known to have rendered. Anchored on
   * the header *by role*, not by text: `usePathname` is mocked to `/expenses`,
   * so the title and a nav label share the string, and `getByText` resolves to
   * one match only because the nav happens to be gated. Weaken that gate and
   * this suite fails with a message about sign-out for a reason that has
   * nothing to do with sign-out.
   */
  it('offers no way to sign out when there is no session', async () => {
    await renderShell();

    expect(screen.getByRole('header', { name: 'Expenses' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('offers sign out once a session exists', async () => {
    await renderShell();
    await signIn();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });
});

describe('Sign out behaviour', () => {
  beforeEach(async () => {
    // One band, since none of this is band-dependent — see the note above.
    mockWidth = BREAKPOINTS.compact + 1;
    mockReplace.mockClear();
    await api.session.clear();
  });

  /**
   * **`restoreAllMocks` as well as the session reset.** Every test here spies
   * on `api.logout` and restores it on its last line — which does not run when
   * an assertion above it throws, so one genuine failure used to reappear as
   * several unrelated ones in the tests that followed. Restoring here means a
   * red test reports only itself.
   */
  afterEach(async () => {
    await resetSession();
    jest.restoreAllMocks();
    // Same reasoning as the restore above, for the same reason: a per-test
    // cleanup on the last line does not run when an assertion above it throws,
    // and a leaked draft would surface as a failure in a later test.
    clearAllDrafts();
    mockPathname = '/expenses';
  });

  /**
   * One press asks; it does not end anything (#98).
   *
   * The control sits in the chrome on every screen, so it is reachable by an
   * accidental tap — and on web the credential is an `httpOnly` cookie, so once
   * the server has cleared it there is no undo short of signing in again.
   */
  it('asks before it ends the session', async () => {
    const logout = jest.spyOn(api, 'logout').mockResolvedValue(null);

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(logout).not.toHaveBeenCalled();
    expect(api.session.isSignedIn()).toBe(true);

    expect(screen.getByRole('button', { name: 'Confirm signing out' })).toBeOnTheScreen();

    logout.mockRestore();
  });

  /**
   * The question's *arrival*, which nothing else here tells anyone about.
   *
   * Five rounds of this PR went on the in-flight state — `busy`, the
   * accessible name, the visible label — and the moment that matters more
   * reached assistive tech through nothing. Pressing "Sign out" unmounts the
   * focused control and mounts two others, so focus falls to the document body
   * and no announcement follows.
   *
   * **This pins the announcement only.** Focus recovery is a separate problem
   * and is still open — see the component.
   */
  it('announces the question when it appears', async () => {
    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('button', { name: 'Confirm signing out' }).parent).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
  });

  /**
   * **The half of the double-tap protection that works in every band.**
   *
   * Ordering only helps where this control is not pinned to the row's right
   * edge; in the medium band it is, so the fill is what stops the confirm
   * reading as the button just pressed. It was the unpinned half, and it failed
   * quietly — under `variant="link"` the label renders in accent on the page
   * background rather than disappearing.
   *
   * Its own test rather than an assertion inside `asks before it ends the
   * session`, for the reason this file already gives about itself: a fill
   * regression reporting under that name says the wrong thing. Named rather
   * than positional, because this docblock has already been moved once and
   * "the one above" did not survive it.
   */
  it('shapes the confirm so it does not read as the button just pressed', async () => {
    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      screen.getByRole('button', { name: 'Confirm signing out' }).props.className,
    ).toContain('bg-negative');
  });

  it('ends the session on the second press', async () => {
    const logout = jest.spyOn(api, 'logout').mockResolvedValue(null);

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.press(screen.getByRole('button', { name: 'Confirm signing out' }));

    expect(logout).toHaveBeenCalledTimes(1);

    logout.mockRestore();
  });

  it('leaves the session alone when the question is declined', async () => {
    const logout = jest.spyOn(api, 'logout').mockResolvedValue(null);

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.press(screen.getByRole('button', { name: 'Stay signed in' }));

    expect(logout).not.toHaveBeenCalled();
    expect(api.session.isSignedIn()).toBe(true);
    // Back to the plain offer, so declining is not a one-way door either.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Confirm signing out' })).toBeNull();

    logout.mockRestore();
  });

  /**
   * Declining must not cost what a sign-out costs.
   *
   * `clearAllDrafts()` is on the sign-out path because leaving on purpose
   * should not leave typed work for the next person (#96). Asked-and-declined
   * is not leaving, so putting that call on the *first* press would destroy a
   * draft for someone who then said no — the exact opposite of what this
   * confirmation is for.
   */
  it('keeps a held draft when the question is declined', async () => {
    // Stubbed so a stray confirm could not reach the network; the spy itself
    // is not what this asserts on.
    jest.spyOn(api, 'logout').mockResolvedValue(null);
    const held = {
      amount: '2450.75',
      occurredOn: '2026-08-30',
      merchant: 'Puregold',
      description: '',
    };

    await renderShell();
    await signIn();
    saveDraft(NEW_EXPENSE_DRAFT, held);

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.press(screen.getByRole('button', { name: 'Stay signed in' }));

    expect(readDraft(NEW_EXPENSE_DRAFT)).toEqual(held);
  });

  /**
   * **The state trap this component already has a scar from.**
   *
   * `AppShell` wraps the whole `Stack`, `sign-in` included, so navigating there
   * never unmounts this — the component re-renders as `null` and keeps its
   * `useState`. That is why `submitting` once stuck as a permanently disabled
   * "Signing out…", and a `confirming` flag left set is the same bug wearing a
   * different label: the next session would open with the chrome already asking
   * a question nobody had been asked.
   */
  it('does not carry the question into the next session', async () => {
    const logout = jest.spyOn(api, 'logout').mockImplementation(async () => {
      await api.session.clear();
      return null;
    });

    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.press(screen.getByRole('button', { name: 'Confirm signing out' }));
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    await signIn();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Confirm signing out' })).toBeNull();

    logout.mockRestore();
  });

  /**
   * A question is about the screen it was asked on.
   *
   * `AppShell` mounts this once above the navigator, so without binding the
   * question to a route it rides along: ask on `/expenses`, change your mind
   * and tap Overview rather than declining, and the Overview draws "Sign out?"
   * in its chrome — where one stray tap ends the session, which is the tap this
   * whole feature exists to prevent.
   *
   * **A separate rule from the signed-out reset, not a second mechanism for
   * it** — the #124 trap is two ways to enforce one rule, and each of these has
   * its own mutation. The delete control needs nothing like this because
   * `expenses/[id]` unmounts; persistent chrome is where it matters.
   */
  it('does not carry the question to another screen', async () => {
    const shell = await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Confirm signing out' })).toBeOnTheScreen();

    // **`rerender`, not a second `render`.** A fresh tree mounts a fresh
    // `SignOutButton` whose state starts empty, so it shows no question
    // whatever the code does — the first version of this test passed against a
    // `confirming` that ignored the pathname entirely. Re-rendering the same
    // tree is what a route change actually is here, since `AppShell` stays
    // mounted across one.
    mockPathname = '/';
    await shell.rerender(
      <ExpenseQueryProvider>
        <AppShell>
          <></>
        </AppShell>
      </ExpenseQueryProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Confirm signing out' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();

    // **And it stays dismissed on the way back.** Hiding the question behind a
    // pathname comparison passes everything above while leaving `askedOn` set,
    // so returning to the asking screen re-arms a question nobody asked on that
    // visit — one stray tap from ending the session, which is the whole point.
    mockPathname = '/expenses';
    await shell.rerender(
      <ExpenseQueryProvider>
        <AppShell>
          <></>
        </AppShell>
      </ExpenseQueryProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Confirm signing out' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });

  /**
   * The decline sits before the confirm, so the control under the finger that
   * just pressed "Sign out" is the safe one and a double-tap declines.
   *
   * Pinned by position rather than by name, because every other query here is
   * `getByRole` by name and none of them observes order — swapping the two
   * passed all seventeen tests. It is load-bearing in two of the three bands:
   * the medium band pins this component to the row's right edge, so ordering
   * alone does not carry it there and the confirm's filled shape is what does.
   */
  it('puts the safe control first', async () => {
    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    // Positions of the real elements, rather than a prop lookup: "Stay signed
    // in" takes its accessible name from its `Text` child and carries no
    // `accessibilityLabel`, so reading props finds only one of the two.
    const buttons = screen.getAllByRole('button');
    const decline = buttons.indexOf(screen.getByRole('button', { name: 'Stay signed in' }));
    const confirm = buttons.indexOf(screen.getByRole('button', { name: 'Confirm signing out' }));

    expect(decline).toBeGreaterThanOrEqual(0);
    expect(confirm).toBeGreaterThanOrEqual(0);
    expect(decline).toBeLessThan(confirm);
  });

  /**
   * Navigating away does not dismiss the question mid-request either.
   *
   * The third exit from the confirm row, and the one that used to opt out of a
   * rule the other two carry: both controls are `disabled` while the request is
   * in flight, and the route reset was unconditional. So a nav tap replaced the
   * row with a plain, enabled "Sign out" while `logout()` ran on and ended the
   * session — offering to start something already happening.
   */
  it('does not dismiss the question by navigating mid-request', async () => {
    let release: (value: null) => void = () => {};
    jest.spyOn(api, 'logout').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const shell = await renderShell();
    await signIn();
    await confirmSignOut();

    expect(screen.getByText('Signing out…')).toBeOnTheScreen();

    mockPathname = '/';
    await shell.rerender(
      <ExpenseQueryProvider>
        <AppShell>
          <></>
        </AppShell>
      </ExpenseQueryProvider>,
    );

    expect(screen.getByText('Signing out…')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    await act(async () => {
      release(null);
    });
  });

  /**
   * The case that decides *where* the reset lives.
   *
   * A session can end while the question is on screen without anyone answering
   * it — a refresh that finally fails. Resetting in `signOut`'s `finally` would
   * not cover this, because `signOut` never ran; resetting on the signed-out
   * render covers both, which is why there is one mechanism and it is that one.
   */
  it('does not leave the question up when the session ends underneath it', async () => {
    await renderShell();
    await signIn();

    await userEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Confirm signing out' })).toBeOnTheScreen();

    // Not a sign-out: what a failed refresh does.
    await resetSession();
    await signIn();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Confirm signing out' })).toBeNull();
  });

  /**
   * **Calls `logout()` and navigates nowhere.**
   *
   * Deliberately not "ends the session": `logout` is stubbed here, so nothing
   * clears anything. The test below is the one that observes the session
   * actually ending.
   *
   * `AuthGuard` owns where a signed-out visitor goes — it sits above the
   * navigator and swaps the whole subtree for a `Redirect` the moment the
   * session clears. This button navigating as well raced that redirect, and
   * expo-router's `ContextNavigator` resolved the collision by looping:
   *
   *     Uncaught  Maximum update depth exceeded
   *       at ContextNavigator
   *     An error occurred in the <Content> component.
   *
   * which leaves a blank screen. Reproduced in a browser against a real
   * backend; the two navigations land in either order and only one of those
   * orders survives, which is why it presents as intermittent.
   */
  it('calls logout without navigating, leaving that to the guard', async () => {
    const logout = jest
      .spyOn(api, 'logout')
      .mockResolvedValue({ revokedSessions: 1, note: 'Signed out everywhere.' });

    await renderShell();
    await signIn();

    await confirmSignOut();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    logout.mockRestore();
  });

  /**
   * `logout()` clears local state in a `finally`, so the session is gone even
   * when the network call failed — and the guard follows the session rather
   * than the call's outcome. A `null` return is exactly that case: the request
   * failed for a reason the client could not narrow, and the visitor is still
   * signed out locally.
   */
  it('still ends the session when the server call fails', async () => {
    const logout = jest.spyOn(api, 'logout').mockImplementation(async () => {
      await api.session.clear();
      return null;
    });

    await renderShell();
    await signIn();

    await confirmSignOut();

    // Positive first, so the absence below is asserted against a real outcome
    // rather than against a render that did nothing.
    expect(api.session.isSignedIn()).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();

    logout.mockRestore();
  });

  /**
   * Signing out and back in leaves a usable control.
   *
   * **The other tests here cannot catch this**, which is why it mocks `logout`
   * differently: they stub it wholesale, so `session.clear()` never runs,
   * `signedIn` stays true and the button stays mounted and visible. Only a mock
   * that performs the real side effect reaches the state where the component
   * re-renders as `null` — which does *not* discard its `useState`, because
   * `AppShell` wraps the whole `Stack` including `sign-in`, so navigating there
   * never unmounts it.
   *
   * Before the fix this found a permanently disabled "Signing out…" that no
   * further press could clear.
   */
  it('is pressable again after signing out and back in', async () => {
    const logout = jest.spyOn(api, 'logout').mockImplementation(async () => {
      await api.session.clear();
      return null;
    });

    await renderShell();
    await signIn();

    await confirmSignOut();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    await signIn();

    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeDisabled();

    logout.mockRestore();
  });

  /**
   * A second press while the first is in flight would revoke twice and race two
   * navigations. The label is the state, so it is also what a screen reader
   * hears — colour and a disabled prop alone would say nothing on web, where
   * RNW forwards no `accessibilityState` (issue #69).
   */
  it('says it is signing out while the request is in flight', async () => {
    let release: (value: null) => void = () => {};
    const logout = jest
      .spyOn(api, 'logout')
      .mockReturnValue(new Promise((resolve) => {
        release = resolve;
      }));

    await renderShell();
    await signIn();

    await confirmSignOut();

    const confirm = screen.getByRole('button', { name: 'Signing out…' });
    expect(confirm).toBeDisabled();

    // **The decline is disabled too, and this is the one control here whose
    // name is a promise.** Pressing it mid-flight would swap the whole confirm
    // row for the plain "Sign out" — dropping the busy state and the "Signing
    // out…" label — while `logout()` goes on to clear the session anyway. No
    // double revoke (`signOut`'s own guard covers that); the cost is that
    // "Stay signed in" appears to have worked and has not.
    expect(screen.getByRole('button', { name: 'Stay signed in' })).toBeDisabled();

    // **The visible label, which the two assertions above cannot see.** They
    // resolve the accessible name off the `accessibilityLabel` ternary; the
    // `Text` child is a second, independent expression, and flattening it to a
    // constant passed all 405 tests.
    //
    // It is the only in-flight signal a sighted visitor gets here. `Button`
    // makes `destructive` dim rather than grey while disabled — deliberately,
    // so an irreversible action does not look like a different button
    // mid-commit — so without this the whole visible change on pressing the
    // confirm is `opacity-50`, and a slow `logout()` reads as a press that
    // never registered.
    expect(screen.getByText('Signing out…')).toBeOnTheScreen();
    // **`aria-busy`, and asserted rather than assumed.** `accessibilityState`
    // is absent from react-native-web's forwarded-prop list, so the busy state
    // used to be dropped on web entirely — silently, because the label change
    // made the control look like it was saying something. The flat prop reaches
    // all three targets, and this is what stops it going missing again.
    expect(confirm).toBeBusy();

    await act(async () => {
      release(null);
    });

    logout.mockRestore();
  });
});
