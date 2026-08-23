import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { comparisonModel } from './geometry';
import { useMeasuredWidth } from './useMeasuredWidth';
import { formatMoney, isNegative } from '../money/format';
import { palette, spacing } from '../theme/tokens';
import type { ComparisonBucket } from '../api/types';

/**
 * Current against prior, as spec §7's grouped bar (issue #16).
 *
 * The paired table below is the accessible representation the chart is never
 * allowed to be without (spec §10), and here it carries something the bars
 * cannot: the change. **That figure is the server's, absolute rather than a
 * percentage** — every category that was zero last period has a zero
 * denominator, and with signed amounts a category can cross zero, where a
 * percentage is not merely undefined but misleading.
 */
export function ComparisonChart({
  buckets,
  height = 180,
}: {
  buckets: ComparisonBucket[];
  height?: number;
}) {
  const [width, onLayout] = useMeasuredWidth();

  // Memoized on the identity of `buckets`: the screen hands through the array
  // the response arrived with, so this rebuilds only when the period changes.
  const { pairs, baselineY } = useMemo(
    () => comparisonModel(buckets, width, height),
    [buckets, width, height],
  );

  return (
    <View style={{ gap: spacing.md }} onLayout={onLayout}>
      {width > 0 && pairs.length > 0 ? (
        <View aria-hidden>
          <Svg width={width} height={height}>
            <Line
              x1={0}
              y1={baselineY}
              x2={width}
              y2={baselineY}
              stroke={palette.border}
              strokeWidth={1}
            />
            {pairs.flatMap((pair) =>
              pair.bars.map((bar, index) => (
                <Rect
                  key={bar.key}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx={2}
                  fill={comparisonBarFill(bar.negative, index === 0)}
                />
              )),
            )}
          </Svg>
        </View>
      ) : null}

      {pairs.length === 0 ? (
        <Text style={{ color: palette.textMuted }}>Nothing recorded in either period.</Text>
      ) : (
        <View accessibilityRole="list" style={{ gap: spacing.xs }}>
          <View
            // One entry rather than four: without this the column headings are
            // announced as four separate list items ahead of the data, which is
            // why every row below is wrapped the same way.
            accessible
            accessibilityLabel="Category, this period, prior, change"
            style={{ flexDirection: 'row', gap: spacing.sm }}
          >
            <Text style={{ flex: 1, color: palette.textMuted, fontSize: 11 }}>Category</Text>
            <Text style={{ width: 90, textAlign: 'right', color: palette.textMuted, fontSize: 11 }}>
              This period
            </Text>
            <Text style={{ width: 90, textAlign: 'right', color: palette.textMuted, fontSize: 11 }}>
              Prior
            </Text>
            <Text style={{ width: 90, textAlign: 'right', color: palette.textMuted, fontSize: 11 }}>
              Change
            </Text>
          </View>

          {pairs.map((pair) => (
            <View
              key={pair.key}
              accessible
              accessibilityLabel={`${pair.label}, ${formatMoney(pair.current)} this period, ${formatMoney(pair.previous)} prior, change ${formatMoney(pair.change)}`}
              style={{ flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs }}
            >
              <Text style={{ flex: 1, color: palette.text }} numberOfLines={1}>
                {pair.label}
              </Text>
              <Text style={cell(isNegative(pair.current))}>{formatMoney(pair.current)}</Text>
              <Text style={cell(isNegative(pair.previous))}>{formatMoney(pair.previous)}</Text>
              <Text style={cell(isNegative(pair.change))}>{formatMoney(pair.change)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * The fill for one bar, on two orthogonal axes: **hue carries the sign,
 * lightness carries the series.**
 *
 * Selecting on `negative` alone — as this did — paints both halves of a
 * refund-heavy pair the single negative colour, so a category net negative in
 * both periods draws as two adjacent bars of the same dark red with nothing to
 * say which is which. The pairing is the only thing this chart exists to show,
 * and spec §5 makes a refund-heavy month an ordinary outcome, not an edge case.
 *
 * Exported so that pairing is testable without a renderer.
 */
export function comparisonBarFill(negative: boolean, current: boolean): string {
  if (negative) {
    return current ? palette.negative : palette.negativeMuted;
  }
  return current ? palette.accent : palette.border;
}

function cell(negative: boolean) {
  return {
    width: 90,
    textAlign: 'right' as const,
    color: negative ? palette.negative : palette.text,
    fontVariant: ['tabular-nums' as const],
  };
}
