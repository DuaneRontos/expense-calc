import Head from 'expo-router/head';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api } from '../src/api/client';
import { ApiError } from '../src/api/problem';
import { FormField } from '../src/expenses/FormField';
import { MIN_TOUCH_TARGET } from '../src/layout/breakpoints';
import { APP_NAME, safeReturnPath } from '../src/layout/navigation';
import { useSignedIn } from '../src/api/useSignedIn';
import { palette, spacing } from '../src/theme/tokens';

/**
 * Sign in (spec §9.2).
 *
 * **The screen `client.login()` was written for and never got.** The method has
 * been covered by tests since #57, but nothing in the app called it — so there
 * was no way to establish a session on any target, and on web that had a second
 * consequence: the refresh cookie `/auth/refresh` looks for could never come
 * into existence, and a cold page load could only ever discover that it had no
 * session.
 *
 * The credential leaves this screen and is not kept. `login()` hands both
 * halves of the response to `Session`, which stores them per §9.2's table — in
 * memory plus the Keychain on a device, in memory plus an `httpOnly` cookie on
 * web. Nothing here writes anything anywhere, which is what keeps that table
 * the only place storage is decided.
 */
export default function SignIn() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Shown after a *successful* sign-in that could not be persisted.
   *
   * Separate from `error` because it is not one: the user is signed in and the
   * app works. `AdoptResult.persisted` exists to carry exactly this, and
   * `session.ts` names this screen as the place that says it out loud rather
   * than leaving someone to be dropped back here in fifteen minutes with no
   * explanation.
   */
  const [warning, setWarning] = useState<string | null>(null);

  /**
   * Where to go once there is a session (#93).
   *
   * The guard puts the interrupted route in the URL, so someone who opened a
   * link to an expense — or whose session lapsed deep in the list — comes back
   * to it rather than to the Overview.
   *
   * **Routed through `safeReturnPath`, never used raw.** The value rides in a
   * URL, and a URL is a thing you can send someone: `?next=https://evil.example`
   * navigated blind is an open redirect, where the victim signs in on the real
   * site and lands on someone else's. That function refuses the off-site,
   * protocol-relative, traversal and unknown-route shapes, and `/sign-in`
   * itself, which would otherwise be a loop.
   */
  const target = safeReturnPath(useLocalSearchParams().next);

  /**
   * Set before the request goes out, so the redirect below cannot fire on the
   * session this screen is in the middle of creating (#94).
   *
   * Without it the two would race: `login()` adopts the session, `signedIn`
   * flips, and a redirect keyed on that alone would leave before the handler
   * decided where to go — taking the `persisted: false` warning off screen with
   * it. Departure after a submit belongs to the handler; this flag is what
   * keeps the two from both claiming it.
   */
  const [submitted, setSubmitted] = useState(false);
  const signedIn = useSignedIn();

  // Trimmed for the check but sent verbatim: a leading space in a username is
  // almost certainly a paste artefact, while one in a password may be the
  // password.
  const ready = username.trim() !== '' && password !== '';

  async function signIn() {
    if (!ready || submitting) {
      return;
    }

    setSubmitted(true);
    setSubmitting(true);
    setError(null);
    setWarning(null);

    try {
      const { persisted } = await api.login({ username, password });

      if (!persisted) {
        // Deliberately not navigated away from. The sentence is the whole point
        // of returning the flag, and it cannot be read from the Overview.
        setWarning(
          'Signed in, but this device could not store the session — you will need to sign in '
            + 'again when the app is next opened.',
        );
        return;
      }

      // `replace`, not `push`: a sign-in form is not somewhere to go "back" to
      // from inside a live session, and on web it would sit in the history
      // between the user and the page they came from.
      router.replace(target);
    } catch (caught) {
      // The server's own sentence where there is one (spec §8 asks for `detail`
      // to be surfaced rather than replaced), and an honest fallback where the
      // request never reached a server that could write one.
      setError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title ?? 'Sign-in failed.')
          : 'Could not reach the server. Check that the API is running and try again.',
      );
      // **Re-armed, because nothing was adopted on this path.** `Session.adopt`
      // assigns the access token only after the store write succeeds and
      // rethrows anything that is not `RefreshTokenUnavailableError`, so a
      // rejected sign-in leaves no session behind. Left set, the flag would
      // disarm the declarative exit for the life of this mount — wider than the
      // "the session this screen just created" it is documented to exclude.
      setSubmitted(false);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * A visitor who already has a session never sees the form (#94).
   *
   * It rendered before, and submitting it spent a `LoginRateLimiter` slot and
   * rotated a perfectly good session for nothing — with the sign-out button
   * sitting above the form, which read oddly.
   *
   * Declarative, and after every hook so the order is stable. `submitted`
   * excludes the session this screen just created: that departure is the
   * handler's, which is what lets the `persisted: false` branch stay put.
   */
  if (signedIn && !submitted) {
    return <Redirect href={target} />;
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}>
      <Head>
        <title>Sign in · {APP_NAME}</title>
      </Head>

      <Text style={{ color: palette.text, fontWeight: '600', fontSize: 16 }}>Sign in</Text>

      <FormField
        label="Username"
        value={username}
        onChangeText={(next) => {
          setUsername(next);
          setError(null);
        }}
        autoCapitalize="none"
        editable={!submitting}
      />

      <FormField
        label="Password"
        value={password}
        onChangeText={(next) => {
          setPassword(next);
          setError(null);
        }}
        autoCapitalize="none"
        editable={!submitting}
        secureTextEntry
      />

      {/*
        Both of these appear only after a press, and the button label returns to
        "Sign in" — so with nothing announced a screen-reader user gets silence.
        The warning is the worse of the two: the sign-in *worked*, so nothing
        else on screen is going to mention that the session will not survive.

        `accessibilityLiveRegion` rather than `aria-live`, matching `AppShell`.
        It is the cross-platform spelling — react-native-web maps it onto
        `aria-live`, and Android reads it natively, which bare `aria-live` would
        not cover. The deprecation `warnOnce` for this prop is commented out in
        the installed react-native-web, so it costs no build warning.
      */}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.negative, fontSize: 13 }}>
          {error}
        </Text>
      ) : null}

      {warning ? (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.text, fontSize: 13 }}>
          {warning}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          // `disabled` alone never reaches the DOM under react-native-web, so a
          // screen reader on web would announce an actionable button that does
          // nothing. The state is declared as well as applied.
          accessibilityState={{ disabled: !ready || submitting, busy: submitting }}
          disabled={!ready || submitting}
          onPress={signIn}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
            borderRadius: 6,
            backgroundColor: !ready || submitting ? palette.border : palette.accent,
          }}
        >
          {/*
            The accessible name stays "Sign in" while the request is in flight —
            the label below changes to show progress, and a name that changes
            with it would make the button a different control to anything
            holding a reference to it.
          */}
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Text>
        </Pressable>

        {submitting ? <ActivityIndicator color={palette.accent} /> : null}
      </View>
    </ScrollView>
  );
}
