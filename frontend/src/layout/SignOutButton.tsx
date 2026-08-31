import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { MIN_TOUCH_TARGET } from './breakpoints';
import { api } from '../api/client';
import { useSignedIn } from '../api/useSignedIn';
import { clearAllDrafts } from '../expenses/draftStore';
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
      // Drafts are held for a session that ended *involuntarily* (#96);
      // someone pressing this is leaving on purpose, and possibly handing over
      // the machine, so what they typed does not survive to be restored into
      // the next person's form. A page reload would have cleared it, and a
      // sign-out that did not would be the weaker of the two.
      //
      // **Before the request, not after**, and unconditional because
      // `logout()` clears local state in a `finally` — there is no path where
      // this press leaves the session alive, so there is none where the draft
      // should have been kept. After the await it might not run at all: the
      // session clearing unmounts this component through `AuthGuard`.
      clearAllDrafts();
      await api.logout();
    } finally {
      // **This navigates nowhere, and that is the fix.** `AuthGuard` owns where
      // a signed-out visitor goes: it sits above the navigator and swaps the
      // whole subtree for a `Redirect` the moment the session clears. Doing it
      // here as well meant two navigations to the same route racing, and
      // expo-router's `ContextNavigator` resolved that collision by looping —
      //
      //     Uncaught  Maximum update depth exceeded
      //       at ContextNavigator
      //
      // — leaving a blank screen. The previous comment here called the second
      // navigation "belt to its braces" and argued the `finally` completes
      // before React commits, so the two could not disagree. They do not
      // disagree about the *destination*; they collide over who is driving, and
      // the ordering that claim rests on is not guaranteed. It held often
      // enough to look deliberate and failed often enough to be reported.
      //
      // The reset stays: it is cheap, and it is correct whether or not the
      // guard unmounts this component first.
      setSubmitting(false);
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
