import { Redirect, usePathname } from 'expo-router';
import { type ReactNode } from 'react';
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

  // Rendered rather than pushed from an effect: `Redirect` is declarative, so
  // there is no window in which the children mount and fire their requests
  // before the navigation lands.
  if (gate === 'signed-out' && !isExactly(pathname, SIGN_IN)) {
    return <Redirect href={SIGN_IN} />;
  }

  return <>{children}</>;
}
