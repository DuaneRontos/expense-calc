import Head from 'expo-router/head';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BarChart } from '../src/charts/BarChart';
import { DonutChart } from '../src/charts/DonutChart';
import { sampleBreakdown, sampleOverTime } from '../src/charts/fixtures';
import { useLayout } from '../src/layout/useLayout';
import { palette, spacing } from '../src/theme/tokens';

/**
 * The scaffold's placeholder overview (issue #3).
 *
 * Its job is to prove the pipeline, not to be the real screen — #16 builds
 * that. It renders one chart of each shape on report-shaped fixtures so that
 * "does the chart layer work on this target?" is answerable by opening the app
 * rather than by reading a README.
 *
 * Brings its own `ScrollView`. The shell deliberately does not supply one:
 * every screen would otherwise share a single scroll offset, and #14's expense
 * list needs a `FlatList` rather than a scrolling container it did not choose.
 */
export default function Overview() {
  const layout = useLayout();

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Head>
        <title>Overview · Expense Calc</title>
      </Head>

      <View style={styles.notice}>
        <Text style={{ color: palette.text, fontWeight: '600' }}>Scaffold placeholder</Text>
        <Text style={{ color: palette.textMuted, fontSize: 13 }}>
          Charts below run on fixture data in the shape the report endpoints return. The live
          client lands with #13.
        </Text>
      </View>

      <View
        style={{
          flexDirection: layout.isExpanded ? 'row' : 'column',
          gap: spacing.lg,
        }}
      >
        {/*
          `flex: 1` only in the row direction. In a column inside a ScrollView
          the cross axis is unbounded, and `flex: 1` there resolves to
          `flexBasis: 0%` — so each panel claims zero height and its chart draws
          over the section beneath it. It looks like a z-index problem and is
          not one.
        */}
        <View style={[styles.panel, layout.isExpanded && styles.panelInRow]}>
          <Text style={{ fontWeight: '600', color: palette.text }}>By category</Text>
          <DonutChart buckets={sampleBreakdown.buckets} total={sampleBreakdown.total} />
        </View>

        <View style={[styles.panel, layout.isExpanded && styles.panelInRow]}>
          <Text style={{ fontWeight: '600', color: palette.text }}>Over time</Text>
          <BarChart buckets={sampleOverTime.buckets} legendTitle="Monthly net" />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    padding: spacing.md,
    gap: spacing.lg,
  },
  notice: {
    padding: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: 8,
    gap: spacing.xs,
  },
  panel: {
    gap: spacing.sm,
  },
  panelInRow: {
    flex: 1,
  },
});
