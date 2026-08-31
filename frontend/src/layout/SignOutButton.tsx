import { useState } from 'react';

import { api } from '../api/client';
import { useSignedIn } from '../api/useSignedIn';
import { clearAllDrafts } from '../expenses/draftStore';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

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
    // `disabled` and `busy` both, and both spellings of each: `disabled` alone
    // never reaches the DOM under react-native-web (#69), so a screen reader
    // there would announce an actionable button that ignores presses. `Button`
    // handles the doubling; the two flags stay distinct because "will do
    // nothing" and "already did something" are different claims.
    <Button variant="link" busy={submitting} disabled={submitting} onPress={signOut}>
      {/*
        The label carries the in-flight state rather than a spinner alone,
        because RNW forwards no `accessibilityState` — so on web the text is the
        only thing that can say a press was registered. Unlike the sign-in
        button, the accessible name is *allowed* to change here: nothing holds a
        reference to this control across the transition, since the whole
        component unmounts the moment the session clears.
      */}
      {/*
        The label goes muted rather than the button going translucent. The
        container's `disabled:opacity-50` would render accent at half strength
        (≈ #8FB7F5) where this used to be slate — legible either way, but a
        different colour, and this one is the app's existing "inactive text".
      */}
      <Text className={submitting ? 'text-textMuted' : undefined}>
        {submitting ? 'Signing out…' : 'Sign out'}
      </Text>
    </Button>
  );
}
