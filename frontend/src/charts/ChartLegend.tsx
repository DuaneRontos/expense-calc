import { memo } from 'react';
import { Text, View } from 'react-native';

import { formatMoney, isNegative } from '../money/format';
import { colorForCategory, palette, spacing } from '../theme/tokens';
import type { ReportBucket } from '../api/types';

/**
 * The accessible half of every chart in this app.
 *
 * Spec §10: *charts are never the only representation of their data.* Every
 * chart pairs with a legend or table carrying the same values, and category
 * colour is supported by a label rather than carrying meaning alone. This
 * component is that pairing, which is why it is not optional on any chart
 * below — a caller cannot turn it off.
 *
 * **Every bucket in the response gets a row**, including the ones the chart
 * declined to draw. A category netting exactly `"0.00"` has no slice and a
 * net-negative one is excluded from the arc, but both are real answers the
 * server gave, and a legend that quietly omits them stops carrying the same
 * values as the response it describes.
 */
function ChartLegendComponent({
  buckets,
  drawnKeys,
  title,
}: {
  buckets: ReportBucket[];
  /**
   * Keys the chart actually drew. Rows outside it keep their value but lose
   * the colour swatch, so the colour never claims a slice that is not there.
   * Undefined means every row was drawn.
   */
  drawnKeys?: Set<string>;
  title?: string;
}) {
  if (buckets.length === 0) {
    return (
      <Text style={{ color: palette.textMuted, padding: spacing.md }}>
        No spending in this period.
      </Text>
    );
  }

  return (
    // No `accessibilityRole="summary"`: that maps to iOS's
    // UIAccessibilityTraitSummaryElement, which means "summary information when
    // the application starts" and is treated specially by VoiceOver at launch.
    // A screen with two charts would declare two app summaries. The per-row
    // labels below are what actually carry the data.
    <View accessibilityRole="list" style={{ gap: spacing.xs }}>
      {title ? (
        <Text style={{ fontWeight: '600', color: palette.text, marginBottom: spacing.xs }}>
          {title}
        </Text>
      ) : null}

      {buckets.map((bucket) => {
        const negative = isNegative(bucket.total);
        const amount = formatMoney(bucket.total);
        const drawn = drawnKeys === undefined || drawnKeys.has(bucket.key);

        return (
          <View
            key={bucket.key}
            // One label per row rather than per cell: a screen reader should
            // read "Groceries, ₱18,420.00", not stop between the two.
            accessible
            accessibilityLabel={`${bucket.label}, ${amount}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingVertical: spacing.xs,
            }}
          >
            <View
              // Decorative — the label beside it carries the meaning. A row the
              // chart did not draw keeps the spacer but loses the colour.
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: drawn ? colorForCategory(bucket.key) : 'transparent',
              }}
            />
            <Text style={{ flex: 1, color: palette.text }} numberOfLines={1}>
              {bucket.label}
            </Text>
            <Text
              style={{
                color: negative ? palette.negative : palette.text,
                // Honoured on iOS and web; historically a no-op on Android RN,
                // so the column may not align there. Cosmetic, and there is no
                // clean fix short of shipping a mono-digit font.
                fontVariant: ['tabular-nums'],
              }}
            >
              {amount}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Memoized: `AppShell` re-renders this subtree on every resize frame, and the
 * legend's props are unchanged across all of them.
 */
export const ChartLegend = memo(ChartLegendComponent);
