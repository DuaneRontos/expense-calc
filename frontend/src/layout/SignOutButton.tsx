import { usePathname } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

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

  // **The question is dismissed by leaving the screen it was asked on.**
  // `AppShell` mounts this once above the navigator, so without a route rule
  // the question rides along: ask on `/expenses`, change your mind and tap
  // Overview rather than declining, and the Overview draws "Sign out?" in its
  // chrome — where one stray tap ends the session, which is the tap this exists
  // to prevent.
  //
  // **Cleared rather than out-matched**, which is a real difference and not a
  // spelling of the same thing. Deriving `askedOn === pathname` only *hides*
  // the question: `askedOn` survives, so navigating back to the asking screen
  // re-arms a question nobody asked on that visit. That was the first version
  // of this, and it passed the away-leg test because that test never went back.
  const [askedOn, setAskedOn] = useState<string | null>(null);

  if (askedOn !== null && askedOn !== pathname) {
    setAskedOn(null);
  }

  const confirming = askedOn !== null;

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
      // **Before the request, and unconditional**, because `logout()` clears
      // local state in a `finally`: there is no path where this press leaves
      // the session alive, so none where the draft was worth keeping.
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
      <View className="flex-row items-center gap-3">
        {/*
          **Decline first, so the safe control sits under the finger that just
          pressed "Sign out".** A double-tap then declines instead of signing
          out. Ordering alone is not enough, though: in the medium band
          `AppShell` gives the nav `flex-1`, which pins this component to the
          row's right edge, so a two-control row grows leftward and the *last*
          child keeps the slot the single button had. That is why the confirm
          below is also shaped differently — the ordering helps in two bands,
          the shape helps in all three.
        */}
        <Button variant="ghost" disabled={submitting} onPress={() => setAskedOn(null)}>
          <Text className="text-textMuted">Stay signed in</Text>
        </Button>

        {/*
          Filled `destructive`, which is the other half of the delete control's
          idiom (`Delete this expense` → a filled `negative` pill). A confirm
          that differs from the control it replaced by one character reads as
          the same button, and this one ends a session that cannot be resumed
          without signing in again.
        */}
        <Button
          variant="destructive"
          // Named for a screen reader rather than left to the visible text: two
          // controls both announcing "Sign out" is the ambiguity a confirmation
          // exists to remove, and a question mark is not spoken.
          //
          // **It still has to carry the in-flight state**, which a fixed label
          // would have silently taken away: an `accessibilityLabel` overrides
          // the text, so a constant one leaves nothing that changes when the
          // press registers. `busy` carries it to assistive tech; this carries
          // it to the name.
          accessibilityLabel={submitting ? 'Signing out…' : 'Confirm signing out'}
          busy={submitting}
          disabled={submitting}
          onPress={signOut}
        >
          {/* Filled, so the label is on the fill rather than in accent. */}
          <Text className="font-semibold text-white">
            {submitting ? 'Signing out…' : 'Sign out?'}
          </Text>
        </Button>
      </View>
    );
  }

  return (
    // No `busy`/`disabled` here: this press only asks, and the request can only
    // be in flight on the confirm control above.
    <Button variant="link" onPress={() => setAskedOn(pathname)}>
      <Text>Sign out</Text>
    </Button>
  );
}
