import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { MIN_TOUCH_TARGET } from './breakpoints';
import { api } from '../api/client';
import { useSignedIn } from '../api/useSignedIn';
import { palette, spacing } from '../theme/tokens';

/**
 * Ends the session, and only appears when there is one to end.
 *
 * The counterpart to the sign-in screen. `client.logout()` had existed and been
 * tested since #57 with nothing calling it — the same shape `login()` was in
 * before #86 — so a signed-in web user had no way out short of clearing a
 * cookie from the console.
 *
 * **Conditional on {@link useSignedIn}, which is reactive rather than a mount
 * snapshot.** Under the `insecure-local` profile no session is ever adopted, so
 * this renders nothing at all and the chrome does not offer to end something
 * that never began. Read once at mount it would be wrong the moment someone
 * signed in, which is precisely when it needs to appear.
 */
export function SignOutButton() {
  const signedIn = useSignedIn();
  const [submitting, setSubmitting] = useState(false);

  if (!signedIn) {
    return null;
  }

  async function signOut() {
    if (submitting) {
      return;
    }
    setSubmitting(true);

    try {
      await api.logout();
    } finally {
      // In a `finally`, because `logout()` clears local state in one of its own:
      // the session is gone whether or not the server was reached, so staying
      // put would leave someone on chrome claiming a session that no longer
      // exists. `replace`, not `push` — a signed-out session is not somewhere
      // to go back to.
      //
      // **Reset before navigating, because this component does not unmount.**
      // `AppShell` wraps the whole `Stack` and `sign-in` is a screen inside it,
      // so `replace` navigates *within* the shell: `signedIn` goes false and
      // this re-renders as `null`, which does not discard its `useState`.
      // Leaving the flag set meant signing back in restored the same instance
      // with `submitting` still true — a permanently disabled "Signing out…"
      // that no further press could clear.
      setSubmitting(false);
      router.replace('/sign-in');
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      // Declared as well as applied: `disabled` alone never reaches the DOM
      // under react-native-web (issue #69), so a screen reader on web would
      // announce an actionable button that ignores presses.
      accessibilityState={{ disabled: submitting, busy: submitting }}
      disabled={submitting}
      onPress={signOut}
      style={{
        minHeight: MIN_TOUCH_TARGET,
        // Symmetric, so the label sits in the middle of its 44dp target.
        justifyContent: 'center',
        paddingVertical: spacing.sm,
      }}
    >
      {/*
        The label carries the in-flight state rather than a spinner alone,
        because RNW forwards no `accessibilityState` — so on web the text is the
        only thing that can say a press was registered. Unlike the sign-in
        button, the accessible name is *allowed* to change here: nothing holds a
        reference to this control across the transition, since the whole
        component unmounts the moment the session clears.
      */}
      <Text style={{ color: submitting ? palette.textMuted : palette.accent, fontWeight: '600' }}>
        {submitting ? 'Signing out…' : 'Sign out'}
      </Text>
    </Pressable>
  );
}
