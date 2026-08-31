import { usePathname } from 'expo-router';
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
  const pathname = usePathname();
  const [submitting, setSubmitting] = useState(false);

  // **The question belongs to the screen it was asked on.** `AppShell` mounts
  // this once above the navigator, so without binding it to a route the
  // question rides along: ask on `/expenses`, change your mind and tap
  // Overview instead of declining, and the Overview draws "Sign out?" in its
  // chrome — where one stray tap ends the session, which is the tap this
  // exists to prevent. Deriving `confirming` rather than resetting on a
  // pathname effect keeps that a property of the state instead of a listener
  // that can miss.
  const [askedOn, setAskedOn] = useState<string | null>(null);
  const confirming = askedOn !== null && askedOn === pathname;

  if (!signedIn) {
    // **Adjusted during render, because this component does not unmount.**
    // `AppShell` wraps the whole `Stack`, `sign-in` included, so navigating
    // there re-renders this as `null` and keeps its `useState` — which is how
    // `submitting` once stuck as a permanently disabled "Signing out…".
    //
    // Not covered by the route binding above: signing out and back in returns
    // to the same route, where a stale `askedOn` would match it again and open
    // the next session mid-question.
    if (askedOn !== null) {
      setAskedOn(null);
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
      // the guard redirects imperatively rather than unmounting the children,
      // so this component is still mounted afterwards — but `clearAllDrafts`
      // belongs before the request regardless: `logout()` clears local state
      // in a `finally`, so there is no path where this press leaves the
      // session alive and the draft worth keeping.
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
      // The reset stays: it is cheap, and it is what keeps the control usable
      // on the next session — the guard redirects without unmounting the
      // children, so this component's state outlives the sign-out.
      setSubmitting(false);
      // **`askedOn` is deliberately not cleared here as well.** The
      // render-phase reset above already covers this path, and covers one more
      // besides — a session ending underneath the question rather than because
      // of it. Two mechanisms for one rule is what #124 shipped and had to
      // undo: with either one alone sufficient, removing either passed the
      // whole suite, so nothing was pinned and the tests only looked like they
      // held. One mechanism per rule, each with a mutation that kills it.
    }
  }

  if (confirming) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          // Disabled in flight as well: declining after the request has gone is
          // a promise this cannot keep, since `logout()` clears local state in
          // a `finally` whatever the server says. The flat prop is enough on
          // every target — see the note on the confirm control above.
          disabled={submitting}
          onPress={() => setAskedOn(null)}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingVertical: spacing.sm,
          }}
        >
          <Text style={{ color: palette.textMuted }}>Stay signed in</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          // Named for a screen reader rather than left to the visible text: two
          // controls both announcing "Sign out" is the ambiguity a confirmation
          // exists to remove, and a question mark is not spoken.
          //
          // **It still has to carry the in-flight state**, which a fixed label
          // would have silently taken away: an `accessibilityLabel` overrides
          // the text, so a constant one leaves nothing that changes when the
          // press registers.
          accessibilityLabel={submitting ? 'Signing out…' : 'Confirm signing out'}
          // `aria-busy` rather than `accessibilityState`, which react-native-web
          // does not forward at all — it is absent from
          // `modules/forwardedProps/index.js`, so the busy state was simply
          // dropped on web. `aria-busy` *is* forwarded, and RN native merges it
          // back into `accessibilityState.busy`, so one flat prop reaches all
          // three targets. The same argument `AppShell` makes for
          // `aria-expanded`.
          //
          // No `disabled` key beside it: RNW's `Pressable` already emits
          // `aria-disabled` from the flat `disabled` prop, and RN's overrides
          // `accessibilityState.disabled` with it regardless.
          aria-busy={submitting}
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
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => setAskedOn(pathname)}
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
