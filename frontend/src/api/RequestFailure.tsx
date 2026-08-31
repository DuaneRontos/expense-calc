import { router } from 'expo-router';
import { Text as RNText, View } from 'react-native';

import { ApiError, needsSignIn } from './problem';
import { palette, spacing } from '../theme/tokens';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

/**
 * How this app renders a failed request.
 *
 * Lives beside `problem.ts` because that is what it reads: every decision here
 * is a question about an {@link ApiError}, and the three screens that had their
 * own copy were each re-deriving the same answers from the same fields.
 *
 * **The action is chosen from the failure, which is the reason this is shared.**
 * "Try again" is wrong for a 401 — retrying without signing in reproduces the
 * identical refusal for as long as someone is willing to tap, and on the
 * Overview each tap fans out three more requests. That reasoning was applied on
 * one screen and not the other two, which is exactly the drift a copied branch
 * produces.
 */
export function RequestFailure({
  error,
  onRetry,
  retrying = false,
}: {
  error: ApiError | Error;
  /**
   * Omitted where the caller has nothing to retry, which hides the control
   * rather than offering one that cannot work.
   */
  onRetry?: () => void;
  /** Drives the button's own busy state; the card stays up while it runs. */
  retrying?: boolean;
}) {
  const problem = error instanceof ApiError ? error.problem : null;

  // Not `instanceof ApiError` at each use: a `TypeError` from `fetch` is a
  // connection failure with no status and no document, so reading one prints
  // "undefined" in place of the one sentence worth showing.
  const signIn = needsSignIn(error);

  const heading = problem ? (problem.title ?? 'Request failed') : 'Could not reach the server';
  // **The fallback has to know which button is underneath it.** Every 401 this
  // app can surface arrives without a `detail` — the filter chain answers a
  // tokenless request before any controller runs, and `client.ts` raises its own
  // "Session expired" and "Signed out" with none — so the generic sentence put
  // "Try again in a moment." directly above the button that exists precisely
  // because trying again cannot work.
  const detail = problem
    ? (problem.detail ?? (signIn ? 'Sign in to continue.' : 'Try again in a moment.'))
    : 'Check that the API is running and try again.';

  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.lg }}>
      {/*
        Announced together, so a screen reader gets the failure and its reason
        rather than a heading with no explanation. The card replaces the screen's
        content, so nothing else says what happened.
      */}
      <RNText accessibilityLiveRegion="polite" style={{ color: palette.negative, fontWeight: '600' }}>
        {heading}
      </RNText>
      <RNText style={{ color: palette.textMuted }}>{detail}</RNText>

      {signIn ? (
        <Button variant="link" onPress={() => router.navigate('/sign-in')}>
          <Text>Sign in</Text>
        </Button>
      ) : onRetry ? (
        // `disabled` alone never reaches the DOM under react-native-web, so a
        // screen reader on web would announce an actionable button that does
        // nothing. `Button` declares both spellings, and `busy` separately —
        // "will do nothing" and "already did something" are different claims.
        <Button variant="link" busy={retrying} disabled={retrying} onPress={onRetry}>
          {/* Muted while in flight, as before — see `SignOutButton`. */}
          <Text className={retrying ? 'text-textMuted' : undefined}>
            {retrying ? 'Trying…' : 'Try again'}
          </Text>
        </Button>
      ) : null}
    </View>
  );
}
