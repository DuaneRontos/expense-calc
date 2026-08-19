import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { ChartLegend } from './ChartLegend';
import { donutModel, holeRadius } from './geometry';
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

  // Memoized because `AppShell` reads `useWindowDimensions`, so every resize
  // frame on web re-renders this subtree — and each render otherwise rebuilds
  // a trigonometric path string per arc.
  const { arcs, drawable, excluded } = useMemo(() => {
    const radius = size / 2;
    return donutModel(buckets, radius, radius, radius, holeRadius(radius, thickness));
  }, [buckets, size, thickness]);

  const hasRing = size > 0 && arcs.length > 0;

  return (
    <View style={{ gap: spacing.md }} onLayout={onLayout}>
      <View style={{ alignItems: 'center' }}>
        {hasRing ? (
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
        ) : null}

        <Text style={{ fontSize: 20, fontWeight: '600', color: palette.text }}>
          {formatMoney(total)}
        </Text>
        <Text style={{ color: palette.textMuted }}>Net for the period</Text>
      </View>

      {/*
        `drawable` rather than "buckets minus excluded". The two differ for a
        category netting exactly "0.00": it has no arc, but it is not excluded
        either, so it used to keep a coloured swatch claiming a slice.
      */}
      <ChartLegend buckets={drawable} excluded={excluded} />

      {excluded.length > 0 ? (
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>
          {excluded.length === 1 ? 'One category is' : `${excluded.length} categories are`} net
          negative for this period and cannot be drawn as a slice. Their values are listed above.
        </Text>
      ) : null}
    </View>
  );
}
