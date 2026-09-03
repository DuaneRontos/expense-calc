import { memo } from 'react';
import { Text, View } from 'react-native';

import { formatMoney, isNegative } from '../money/format';
import { colorForCategory } from '../theme/tokens';
import { cn } from '../ui/cn';
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
      <Text className="p-4 text-textMuted">No spending in this period.</Text>
    );
  }

  return (
    // No `accessibilityRole="summary"`: that maps to iOS's
    // UIAccessibilityTraitSummaryElement, which means "summary information when
    // the application starts" and is treated specially by VoiceOver at launch.
    // A screen with two charts would declare two app summaries. The per-row
    // labels below are what actually carry the data.
    <View accessibilityRole="list" className="gap-1">
      {title ? <Text className="mb-1 font-semibold text-text">{title}</Text> : null}

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
            className="flex-row items-center gap-2 py-1"
          >
            <View
              // Decorative — the label beside it carries the meaning. A row the
              // chart did not draw keeps the spacer but loses the colour.
              aria-hidden
              className="h-3 w-3 rounded-[3px]"
              // The category colour comes from the server's bucket key, so
              // there is no class to write ahead of time — the same runtime
              // lookup the chart slices use, which is what keeps the swatch and
              // the slice the same colour.
              style={{ backgroundColor: drawn ? colorForCategory(bucket.key) : 'transparent' }}
            />
            <Text className="flex-1 text-text" numberOfLines={1}>
              {bucket.label}
            </Text>
            <Text
              className={cn(negative ? 'text-negative' : 'text-text')}
              // Honoured on iOS and web; historically a no-op on Android RN,
              // so the column may not align there. Cosmetic, and there is no
              // clean fix short of shipping a mono-digit font. No NativeWind
              // utility maps to it, so it stays a style prop.
              style={{ fontVariant: ['tabular-nums'] }}
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
 * Memoized: the screen re-renders its panels on every resize frame, and the
 * legend's props are unchanged across all of them.
 */
export const ChartLegend = memo(ChartLegendComponent);
