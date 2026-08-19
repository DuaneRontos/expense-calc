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

  // Memoized because the *screen* reads `useLayout()` and re-renders its panels
  // on every resize frame on web — each render otherwise rebuilds a
  // trigonometric path string per arc. Not the shell: it wraps the navigator
  // now, and its `children` element is referentially stable, so React bails out
  // of this subtree when the shell alone re-renders.
  //
  // The dependency is identity-based. It holds for the module-level fixtures
  // and stops holding the moment a caller passes `response.buckets.filter(…)`
  // inline, so #13 should keep the array stable rather than assume this memo
  // is doing anything.
  const { arcs, drawable, excluded } = useMemo(() => {
    const radius = size / 2;
    return donutModel(buckets, radius, radius, radius, holeRadius(radius, thickness));
  }, [buckets, size, thickness]);

  const hasRing = size > 0 && arcs.length > 0;
  const drawnKeys = useMemo(() => new Set(drawable.map((bucket) => bucket.key)), [drawable]);

  return (
    <View style={{ gap: spacing.md }} onLayout={onLayout}>
      <View style={{ alignItems: 'center' }}>
        {hasRing ? (
          // The ring is decorative: every value in it is in the legend below,
          // which is the representation assistive technology reads.
          //
          // `aria-hidden` on a wrapping `View` rather than on `Svg` itself, so
          // the mapping to each platform's native flag is RN core's job. On
          // `Svg` it would depend on react-native-svg forwarding an unknown
          // prop — which is what put the iOS/Android spellings into the DOM as
          // invalid attributes in the first place.
          <View aria-hidden>
            <Svg width={size} height={size}>
              <G>
                {arcs.map((arc) => (
                  <Path key={arc.key} d={arc.path} fill={colorForCategory(arc.key)} />
                ))}
              </G>
            </Svg>
          </View>
        ) : null}

        <Text style={{ fontSize: 20, fontWeight: '600', color: palette.text }}>
          {formatMoney(total)}
        </Text>
        <Text style={{ color: palette.textMuted }}>Net for the period</Text>
      </View>

      {/*
        Every bucket the server returned, with a swatch only on the ones that
        got an arc. Passing `drawable` alone dropped a category netting exactly
        "0.00" from the legend entirely — it is in neither the ring nor
        `excluded` — which left the legend carrying fewer values than the
        response, the one thing spec §10 does not allow it to do.
      */}
      <ChartLegend buckets={buckets} drawnKeys={drawnKeys} />

      {excluded.length > 0 ? (
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>
          {excluded.length === 1 ? 'One category is' : `${excluded.length} categories are`} net
          negative for this period and cannot be drawn as a slice. Their values are listed above.
        </Text>
      ) : null}
    </View>
  );
}
