import { Redirect, router, usePathname } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuthGate } from '../api/useAuthGate';
import { isExactly } from './navigation';
import { palette, spacing } from '../theme/tokens';

/** The one route that must render without a session, or the guard traps its own exit. */
const SIGN_IN = '/sign-in';

/**
 * Keeps the app behind a session (issue #92).
 *
 * Before this, every route was reachable signed out: each screen mounted, fired
 * its requests, collected 401s, and showed the failure card from #87. That
 * works, but it reads as broken rather than locked, and the Overview spends
 * three doomed requests arriving at it.
 *
 * **The three-state gate is what makes this safe on web**, and a boolean would
 * not have been. The credential there is an `httpOnly` cookie no script can
 * read, so a returning visitor has nothing in memory at first paint and is
 * indistinguishable from a signed-out one until `/auth/refresh` answers.
 * Redirecting on that first reading would bounce precisely the people who are
 * signed in. See {@link useAuthGate}.
 *
 * **On the `insecure-local` profile nothing signs in on its own**, so this sends
 * developers to the sign-in screen against an API that would have served them
 * anyway. `dev`/`dev` clears it. Accepted as friction rather than designed
 * around: a guard that is off in development is a guard nobody exercises until
 * it matters.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const gate = useAuthGate();
  const pathname = usePathname();

  const lockedOut = gate === 'signed-out' && !isExactly(pathname, SIGN_IN);

  /**
   * Whether the navigator below has ever been on screen.
   *
   * The two ways out of here need different mechanisms, and this is what tells
   * them apart. State set from an effect rather than a ref read during render —
   * `react-hooks/refs` rejects the latter, and is right to: a value the render
   * branches on is state, whatever it is stored in.
   *
   * Keyed off the children actually rendering, not off `!lockedOut`. During the
   * `resolving` pass the gate is not yet `signed-out`, so `lockedOut` is false
   * while the spinner shows — and treating that as "the navigator was up" would
   * send a cold, signed-out load down the imperative path, where there is no
   * navigator yet to receive it.
   */
  const showingChildren = gate !== 'resolving' && !lockedOut;
  const [navigatorMounted, setNavigatorMounted] = useState(false);

  // Adjusted during render rather than from an effect. React documents this for
  // state derived from what the previous render did, and it is the only shape
  // the hooks lint accepts here: a ref read during render is rejected, and so
  // is a `setState` in an effect body. It settles in one extra render, before
  // anything is painted.
  if (showingChildren && !navigatorMounted) {
    setNavigatorMounted(true);
  }

  /**
   * The exit for a session that ends while the app is up — signing out, or a
   * refresh that comes back rejected.
   *
   * **Imperative, and the children stay rendered underneath it.** Returning a
   * `Redirect` here instead unmounts the navigator, and every form of
   * navigation expo-router offers — declarative or imperative — needs that
   * navigator to still be there. Doing it anyway left a blank screen on `/`
   * with the URL unchanged, because nothing was left to perform the move.
   *
   * This is also why `SignOutButton` no longer navigates. When it did, its
   * `router.replace` raced the `Redirect` this component used to return, and
   * `ContextNavigator` resolved the collision by looping:
   * `Maximum update depth exceeded`, then a blank screen. One owner, one
   * mechanism per case.
   */
  useEffect(() => {
    if (lockedOut && navigatorMounted) {
      router.replace(SIGN_IN);
    }
  }, [lockedOut, navigatorMounted]);

  if (gate === 'resolving') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        {/*
          **On the indicator, not the wrapper.** react-native-web renders a bare
          `View` as a `div` with no role, and ARIA prohibits naming a generic
          element — so a label there is dropped and the spinner announces as an
          unnamed progressbar, on a screen that is the whole app while it shows.
          `ActivityIndicator` already carries `role="progressbar"`; what it
          lacked was a name, not a role.
        */}
        <ActivityIndicator accessibilityLabel="Checking your session" color={palette.accent} />
      </View>
    );
  }

  // The cold-load exit, where the navigator has never mounted and expo-router
  // resolves this before anything below it runs. Declarative on purpose: there
  // is no window in which the children mount and fire their requests first,
  // which is the regression #92 exists to prevent.
  if (lockedOut && !navigatorMounted) {
    return <Redirect href={SIGN_IN} />;
  }

  return <>{children}</>;
}
