import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
 *
 * **It asks first (#98).** The control sits in the chrome on every screen, so
 * it is reachable by an accidental tap, and on web the credential is an
 * `httpOnly` cookie — once the server has cleared it there is no undo short of
 * signing in again. The question is in place rather than in a dialog or behind
 * a route, which is the same shape the delete control on the expense detail
 * screen uses.
 */
export function SignOutButton() {
  const signedIn = useSignedIn();
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!signedIn) {
    // **Adjusted during render, because this component does not unmount.**
    // `AppShell` wraps the whole `Stack`, `sign-in` included, so navigating
    // there re-renders this as `null` and keeps its `useState` — which is how
    // `submitting` once stuck as a permanently disabled "Signing out…". A
    // `confirming` left set is the same bug with a different label: the next
    // session would open with the chrome already asking a question nobody had
    // been asked. `signOut` clears it too, so this is the case that one cannot
    // reach — a session ending underneath the question rather than because of
    // it.
    if (confirming) {
      setConfirming(false);
    }
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
      // **`confirming` is deliberately not reset here as well.** The
      // render-phase reset above already covers this path, and covers one more
      // besides — a session ending underneath the question rather than because
      // of it. Two mechanisms for one rule is what #124 shipped and had to
      // undo: with either one alone sufficient, removing either passed the
      // whole suite, so nothing was pinned and the tests only looked like they
      // held. One mechanism, and a mutation that kills it.
    }
  }

  if (confirming) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          // Named for a screen reader rather than left to the visible text: two
          // controls both announcing "Sign out" is the ambiguity a confirmation
          // exists to remove, and a question mark is not spoken.
          //
          // **It still has to carry the in-flight state**, which a fixed label
          // would have silently taken away: an `accessibilityLabel` overrides
          // the text, and RNW forwards no `accessibilityState`, so this string
          // is the only thing that can tell a screen reader on web that the
          // press registered.
          accessibilityLabel={submitting ? 'Signing out…' : 'Confirm signing out'}
          accessibilityState={{ disabled: submitting, busy: submitting }}
          disabled={submitting}
          onPress={signOut}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingVertical: spacing.sm,
          }}
        >
          <Text
            style={{ color: submitting ? palette.textMuted : palette.accent, fontWeight: '600' }}
          >
            {submitting ? 'Signing out…' : 'Sign out?'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          // Disabled in flight as well: declining after the request has gone is
          // a promise this cannot keep, since `logout()` clears local state in
          // a `finally` whatever the server says.
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          onPress={() => setConfirming(false)}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingVertical: spacing.sm,
          }}
        >
          <Text style={{ color: palette.textMuted }}>Stay signed in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => setConfirming(true)}
      style={{
        minHeight: MIN_TOUCH_TARGET,
        // Symmetric, so the label sits in the middle of its 44dp target.
        justifyContent: 'center',
        paddingVertical: spacing.sm,
      }}
    >
      {/*
        Plain, because this press no longer does anything irreversible — it
        asks. The in-flight state lives on the confirm control above, which is
        the only one that can be in flight.
      */}
      <Text style={{ color: palette.accent, fontWeight: '600' }}>Sign out</Text>
    </Pressable>
  );
}
