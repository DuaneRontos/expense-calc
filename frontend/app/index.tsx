import Head from 'expo-router/head';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../src/api/problem';
import { BarChart } from '../src/charts/BarChart';
import { ComparisonChart } from '../src/charts/ComparisonChart';
import { DonutChart } from '../src/charts/DonutChart';
import { useLayout } from '../src/layout/useLayout';
import { webTitleFor } from '../src/layout/navigation';
import { MIN_TOUCH_TARGET } from '../src/layout/breakpoints';
import { formatMoney } from '../src/money/format';
import { PeriodPicker } from '../src/reports/PeriodPicker';
import { bucketLegendTitle, describePeriod, PERIOD_CHOICES } from '../src/reports/periods';
import { useDelayedFlag } from '../src/reports/useDelayedFlag';
import { useManilaToday } from '../src/reports/useManilaToday';
import { useReports } from '../src/reports/useReports';
import { palette, spacing } from '../src/theme/tokens';

/**
 * The three reports of spec §7, from the reporting endpoints (issue #16).
 *
 * **Every number here is the server's.** The endpoints return pre-aggregated
 * buckets and this screen renders them — nothing sums a list of expenses, and
 * nothing converts an amount to a `number` except the chart geometry deciding
 * how tall to draw a bar. That is what keeps iOS, Android and web from
 * disagreeing about a total.
 */
export default function Overview() {
  const layout = useLayout();
  const [choice, setChoice] = useState(PERIOD_CHOICES[0]!.key);

  const today = useManilaToday();
  const selected = useMemo(
    () => PERIOD_CHOICES.find((candidate) => candidate.key === choice) ?? PERIOD_CHOICES[0]!,
    [choice],
  );
  const period = useMemo(() => selected.period(today), [selected, today]);

  // The bucket travels with the preset: a fixed one slices "Last 90 days" into
  // partial months and then labels them as whole ones. See `PeriodChoice`.
  const { breakdown, overTime, comparison, loading, error, retry } = useReports(
    period,
    selected.bucket,
  );

  // Held back so a fast response simply appears. A spinner that shows and hides
  // inside 80ms reads as a glitch, not as progress.
  const showSpinner = useDelayedFlag(loading);

  const stale = loading && breakdown !== null;

  /**
   * Whether the reports refused the credential rather than failed to produce.
   *
   * **"Try again" is the wrong control for a 401**, and offering it is worse
   * than offering nothing: retrying without signing in reproduces the identical
   * refusal for as long as someone is willing to tap, and each tap fans out
   * three more requests. Since the cold-start fix lets a browser holding no
   * refresh cookie through unauthenticated, this is the state a deployed API
   * puts a signed-out visitor in — the honest answer to it is a way in.
   */
  const needsSignIn = error instanceof ApiError && error.isUnauthorized;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Head>
        <title>{webTitleFor('overview')}</title>
      </Head>

      <PeriodPicker selected={choice} onSelect={setChoice} period={period} />

      {error ? (
        <View style={{ gap: spacing.sm, paddingVertical: spacing.lg }}>
          <Text style={{ color: palette.negative, fontWeight: '600' }}>
            {error instanceof ApiError ? (error.problem.title ?? 'Request failed') : 'Could not reach the server'}
          </Text>
          <Text style={{ color: palette.textMuted }}>
            {error instanceof ApiError
              ? (error.problem.detail ?? 'Try again in a moment.')
              : 'Check that the API is running and try again.'}
          </Text>
          {/*
            The card stays up while the retry runs, and the button carries the
            attempt. Re-rendering the identical card would answer the tap with
            nothing at all — and on a connection-refused, which can hang for
            tens of seconds on web, the natural response to that is to tap
            again and fan out another three requests.
          */}
          {needsSignIn ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/sign-in')}
              style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <Text style={{ color: palette.accent, fontWeight: '600' }}>Sign in</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
              disabled={loading}
              onPress={retry}
              style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <Text
                style={{ color: loading ? palette.textMuted : palette.accent, fontWeight: '600' }}
              >
                {loading ? 'Trying…' : 'Try again'}
              </Text>
            </Pressable>
          )}
        </View>
      ) : showSpinner && !breakdown ? (
        <View style={{ paddingVertical: spacing.xl * 2, alignItems: 'center' }}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : !breakdown ? null : (
        // Dimmed rather than replaced while a new period loads, so the charts do
        // not disappear and reflow under the reader on every period change.
        <View style={{ gap: spacing.lg, opacity: stale ? 0.55 : 1 }}>
          <View style={{ flexDirection: layout.isExpanded ? 'row' : 'column', gap: spacing.lg }}>
            <View style={[styles.panel, layout.isExpanded && styles.panelInRow]}>
              <Text style={styles.heading}>By category</Text>
              {breakdown.buckets.length === 0 ? (
                // Spec §7: an empty period is a 200 with no buckets, and an
                // answer rather than an error.
                <EmptyPeriod />
              ) : (
                <DonutChart buckets={breakdown.buckets} total={breakdown.total} />
              )}
            </View>

            <View style={[styles.panel, layout.isExpanded && styles.panelInRow]}>
              <Text style={styles.heading}>Over time</Text>
              {overTime && overTime.buckets.length > 0 ? (
                <BarChart
                  buckets={overTime.buckets}
                  // From the response's own bucket, never from the request, so
                  // the heading cannot describe a slicing that was not used.
                  legendTitle={bucketLegendTitle(overTime.bucket)}
                />
              ) : (
                <EmptyPeriod />
              )}
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.heading}>This period against the one before</Text>
            {comparison ? (
              <>
                <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                  {formatMoney(comparison.currentTotal)} now,{' '}
                  {formatMoney(comparison.previousTotal)} in {describePeriod(comparison.previous)}
                </Text>
                <ComparisonChart buckets={comparison.buckets} />
              </>
            ) : (
              <EmptyPeriod />
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

/** "No spending in this period" is an answer, and the client renders it as one. */
function EmptyPeriod() {
  return (
    <View style={{ paddingVertical: spacing.lg }}>
      <Text style={{ color: palette.textMuted }}>No expenses recorded in this period.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.lg },
  heading: { fontWeight: '600', color: palette.text },
  panel: { gap: spacing.sm },
  /**
   * Applied **only** when the panels sit in a row, which is why it is a
   * separate style rather than part of `panel`.
   *
   * In a column inside a `ScrollView` the cross axis is unbounded, and `flex: 1`
   * there resolves to `flexBasis: 0%` — so each panel claims zero height and its
   * chart draws over the section beneath it. It looks like a z-index problem and
   * is not one.
   */
  panelInRow: { flex: 1 },
});
