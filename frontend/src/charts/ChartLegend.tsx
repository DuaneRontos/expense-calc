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
 * Rendered as rows of label + value rather than as a colour key, because the
 * value is the point. A legend that only maps colour to name still leaves a
 * screen-reader user with no numbers.
 */
function ChartLegendComponent({
  buckets,
  excluded = [],
  title,
}: {
  buckets: ReportBucket[];
  /** Net-negative buckets left out of a donut arc, shown here with real values. */
  excluded?: ReportBucket[];
  title?: string;
}) {
  const rows = [...buckets, ...excluded];

  if (rows.length === 0) {
    return (
      <Text style={{ color: palette.textMuted, padding: spacing.md }}>
        No spending in this period.
      </Text>
    );
  }

  return (
    <View accessibilityRole="summary" style={{ gap: spacing.xs }}>
      {title ? (
        <Text style={{ fontWeight: '600', color: palette.text, marginBottom: spacing.xs }}>
          {title}
        </Text>
      ) : null}

      {rows.map((bucket) => {
        const negative = isNegative(bucket.total);
        const amount = formatMoney(bucket.total);

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
              // Decorative — the label beside it carries the meaning.
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: colorForCategory(bucket.key),
              }}
            />
            <Text style={{ flex: 1, color: palette.text }} numberOfLines={1}>
              {bucket.label}
            </Text>
            <Text
              style={{
                color: negative ? palette.negative : palette.text,
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
