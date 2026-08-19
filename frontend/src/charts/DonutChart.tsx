import { Text, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { ChartLegend } from './ChartLegend';
import { donutModel } from './geometry';
import { useMeasuredWidth } from './useMeasuredWidth';
import { formatMoney } from '../money/format';
import { colorForCategory, palette, spacing } from '../theme/tokens';
import type { ReportBucket } from '../api/types';

/** Beyond this the ring stops reading as a chart and starts reading as a wall. */
const MAX_DIAMETER = 260;

/**
 * The category-breakdown donut of spec §7, with its ranked legend.
 *
 * The legend is rendered by this component rather than by the caller, because
 * spec §10 makes it mandatory and spec §7 puts net-negative categories *only*
 * in the legend. Splitting the two apart is how a screen ends up with a ring
 * that quietly omits a category and no list to notice it by.
 */
export function DonutChart({
  buckets,
  total,
  thickness = 34,
}: {
  buckets: ReportBucket[];
  /** The period total, as the server computed it. Never re-summed here. */
  total: string;
  thickness?: number;
}) {
  const [available, onLayout] = useMeasuredWidth();
  const size = Math.min(available, MAX_DIAMETER);
  const radius = size / 2;

  const { arcs, excluded } = donutModel(buckets, radius, radius, radius, radius - thickness);
  const drawn = buckets.filter((bucket) => !excluded.includes(bucket));

  return (
    <View style={{ gap: spacing.md }} onLayout={onLayout}>
      <View style={{ alignItems: 'center' }}>
        {size > 0 && arcs.length > 0 ? (
          <Svg
            width={size}
            height={size}
            // The ring is decorative: every value in it is in the legend below,
            // which is the representation assistive technology reads.
            //
            // `aria-hidden` rather than the iOS/Android pair
            // (`accessibilityElementsHidden` / `importantForAccessibility`):
            // react-native-svg forwards unknown props straight to the DOM
            // `<svg>` on web, so those two reach React as invalid attributes
            // and log an error on every render. `aria-hidden` is the
            // cross-platform spelling — RN maps it to both native props.
            aria-hidden
          >
            <G>
              {arcs.map((arc) => (
                <Path key={arc.key} d={arc.path} fill={colorForCategory(arc.key)} />
              ))}
            </G>
          </Svg>
        ) : (
          <View style={{ paddingVertical: spacing.lg }}>
            <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
              Nothing to plot for this period.
            </Text>
          </View>
        )}

        <Text style={{ fontSize: 20, fontWeight: '600', color: palette.text }}>
          {formatMoney(total)}
        </Text>
        <Text style={{ color: palette.textMuted }}>Net for the period</Text>
      </View>

      <ChartLegend buckets={drawn} excluded={excluded} />

      {excluded.length > 0 ? (
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>
          {excluded.length === 1 ? 'One category is' : `${excluded.length} categories are`} net
          negative for this period and cannot be drawn as a slice. Their values are listed above.
        </Text>
      ) : null}
    </View>
  );
}
