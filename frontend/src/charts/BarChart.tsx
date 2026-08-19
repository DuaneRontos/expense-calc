import { Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { ChartLegend } from './ChartLegend';
import { barModel } from './geometry';
import { useMeasuredWidth } from './useMeasuredWidth';
import { palette, spacing } from '../theme/tokens';
import type { ReportBucket } from '../api/types';

/**
 * The spend-over-time bars of spec §7, with the same mandatory pairing.
 *
 * Draws a zero line rather than resting every bar on the bottom edge. With
 * signed amounts the baseline is not the floor, and without the line a small
 * negative bar and a small positive one look identical.
 */
export function BarChart({
  buckets,
  height = 180,
  legendTitle,
}: {
  buckets: ReportBucket[];
  height?: number;
  legendTitle?: string;
}) {
  const [width, onLayout] = useMeasuredWidth();
  const { bars, baselineY } = barModel(buckets, width, height);

  return (
    <View style={{ gap: spacing.md }} onLayout={onLayout}>
      {width > 0 && bars.length > 0 ? (
        <Svg
          width={width}
          height={height}
          // Decorative; the legend below carries every value. See DonutChart
          // for why this is `aria-hidden` rather than the per-platform props.
          aria-hidden
        >
          <Line
            x1={0}
            y1={baselineY}
            x2={width}
            y2={baselineY}
            stroke={palette.border}
            strokeWidth={1}
          />
          {bars.map((bar) => (
            <Rect
              key={bar.key}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill={bar.negative ? palette.negative : palette.accent}
              rx={2}
            />
          ))}
        </Svg>
      ) : null}

      {bars.length === 0 ? (
        <Text style={{ color: palette.textMuted }}>No periods to plot.</Text>
      ) : null}

      <ChartLegend buckets={buckets} title={legendTitle} />
    </View>
  );
}
