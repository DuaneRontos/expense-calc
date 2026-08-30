import Head from 'expo-router/head';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RequestFailure } from '../src/api/RequestFailure';
import { BarChart } from '../src/charts/BarChart';
import { ComparisonChart } from '../src/charts/ComparisonChart';
import { DonutChart } from '../src/charts/DonutChart';
import { useLayout } from '../src/layout/useLayout';
import { useSignedIn } from '../src/api/useSignedIn';
import { webTitleFor } from '../src/layout/navigation';
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

  /**
   * Without a session the reports are not fetched at all (#102), so `loading`
   * stays true and `error` stays null — which lands on the spinner branch below
   * and never leaves it. Said plainly instead.
   *
   * `AuthGuard` normally redirects before this is seen. The gap is the one its
   * own comment admits: a `replace` that fails to move the pathname leaves the
   * visitor on a protected route with no session. That was survivable while the
   * screen degraded into the 401 failure card; a spinner with no escape is
   * worse than what the gate replaced, so it degrades into a prompt instead.
   */
  const signedIn = useSignedIn();

  const stale = loading && breakdown !== null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Head>
        <title>{webTitleFor('overview')}</title>
      </Head>

      <PeriodPicker selected={choice} onSelect={setChoice} period={period} />

      {error ? (
        <RequestFailure error={error} onRetry={retry} retrying={loading} />
      ) : !signedIn && !breakdown ? (
        <View style={{ paddingVertical: spacing.xl * 2, alignItems: 'center' }}>
          <Text style={{ color: palette.textMuted }}>Sign in to see your reports.</Text>
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
