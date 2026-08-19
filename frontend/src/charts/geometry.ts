import { isNegative, toChartNumber } from '../money/format';
import type { ReportBucket } from '../api/types';

/**
 * Pure geometry for the chart layer.
 *
 * Separated from the components because this is where the rules of spec §7
 * live, and rules deserve tests that do not need a renderer. Nothing here
 * imports React.
 */

/** A slice of the donut, already resolved to angles. */
export interface Arc {
  key: string;
  label: string;
  /** The original decimal string, for the legend. Never formatted here. */
  total: string;
  startAngle: number;
  endAngle: number;
  path: string;
}

export interface DonutModel {
  arcs: Arc[];
  /**
   * Buckets excluded from the arc because they are net negative.
   *
   * **Spec §7: a donut cannot show a negative slice**, so the category
   * breakdown surfaces these in the legend with their real value and leaves
   * them out of the ring. They are returned rather than dropped so the legend
   * cannot forget them — losing a category here would understate a refund and
   * make the legend disagree with the total above it.
   */
  excluded: ReportBucket[];
  /** Sum of the positive buckets — the denominator the arcs divide. */
  positiveTotal: number;
}

const TAU = Math.PI * 2;

/** Cartesian point on a circle, with 0 radians at 12 o'clock, going clockwise. */
function pointOn(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
}

/**
 * The SVG path for one donut segment.
 *
 * A segment covering the whole circle is drawn as two half arcs. A single
 * `A` command from an angle back to itself is a zero-length arc, and SVG
 * renders it as nothing — so the one-category report, which is the most likely
 * report a new user sees, would come back as an empty ring.
 */
export function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;

  if (sweep >= TAU - 1e-9) {
    const midAngle = startAngle + Math.PI;
    return [
      arcPath(cx, cy, outerRadius, innerRadius, startAngle, midAngle),
      arcPath(cx, cy, outerRadius, innerRadius, midAngle, startAngle + TAU),
    ].join(' ');
  }

  const largeArc = sweep > Math.PI ? 1 : 0;
  const [outerStartX, outerStartY] = pointOn(cx, cy, outerRadius, startAngle);
  const [outerEndX, outerEndY] = pointOn(cx, cy, outerRadius, endAngle);
  const [innerEndX, innerEndY] = pointOn(cx, cy, innerRadius, endAngle);
  const [innerStartX, innerStartY] = pointOn(cx, cy, innerRadius, startAngle);

  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
    `L ${innerEndX} ${innerEndY}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`,
    'Z',
  ].join(' ');
}

/**
 * Turns report buckets into donut geometry.
 *
 * Buckets arrive ranked by total descending from the server, and that order is
 * preserved — the ring and the ranked legend of spec §7 read in the same order,
 * which is the only reason a legend beside a donut is usable at all.
 */
export function donutModel(
  buckets: ReportBucket[],
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
): DonutModel {
  const excluded = buckets.filter((bucket) => isNegative(bucket.total));

  // Zero-valued buckets are dropped from the ring too: a zero-width arc is
  // invisible, but it still consumes a legend colour and reads as a rendering
  // bug when a category with "0.00" appears to have a slice.
  const drawable = buckets.filter(
    (bucket) => !isNegative(bucket.total) && toChartNumber(bucket.total) > 0,
  );

  const positiveTotal = drawable.reduce((sum, bucket) => sum + toChartNumber(bucket.total), 0);

  if (positiveTotal <= 0) {
    return { arcs: [], excluded, positiveTotal: 0 };
  }

  let angle = 0;
  const arcs = drawable.map((bucket) => {
    const sweep = (toChartNumber(bucket.total) / positiveTotal) * TAU;
    const startAngle = angle;
    const endAngle = angle + sweep;
    angle = endAngle;

    return {
      key: bucket.key,
      label: bucket.label,
      total: bucket.total,
      startAngle,
      endAngle,
      path: arcPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle),
    };
  });

  return { arcs, excluded, positiveTotal };
}

/** One bar, resolved to a rectangle in chart space. */
export interface Bar {
  key: string;
  label: string;
  total: string;
  x: number;
  y: number;
  width: number;
  height: number;
  negative: boolean;
}

export interface BarModel {
  bars: Bar[];
  /** Where zero sits vertically. Not the bottom whenever any bar is negative. */
  baselineY: number;
}

/**
 * Lays out a bar chart over a domain that may straddle zero.
 *
 * **The domain is not clamped at zero.** A bucket whose refunds exceeded its
 * spending is genuinely negative (spec §7), and a chart that floors the axis at
 * zero would draw it as absent — indistinguishable from a month with no
 * spending at all.
 */
export function barModel(
  buckets: ReportBucket[],
  width: number,
  height: number,
  gap = 8,
): BarModel {
  if (buckets.length === 0) {
    return { bars: [], baselineY: height };
  }

  const values = buckets.map((bucket) => toChartNumber(bucket.total));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min;

  // An all-zero period — every bucket "0.00", which spec §7 says is a valid
  // answer — has no span to scale against. Everything sits on the baseline.
  if (span === 0) {
    return {
      bars: buckets.map((bucket, index) => ({
        key: bucket.key,
        label: bucket.label,
        total: bucket.total,
        x: index * (width / buckets.length) + gap / 2,
        y: height,
        width: Math.max(1, width / buckets.length - gap),
        height: 0,
        negative: false,
      })),
      baselineY: height,
    };
  }

  const slot = width / buckets.length;
  const baselineY = (max / span) * height;

  const bars = buckets.map((bucket, index) => {
    const value = values[index] ?? 0;
    const magnitude = (Math.abs(value) / span) * height;

    return {
      key: bucket.key,
      label: bucket.label,
      total: bucket.total,
      x: index * slot + gap / 2,
      y: value >= 0 ? baselineY - magnitude : baselineY,
      width: Math.max(1, slot - gap),
      height: magnitude,
      negative: value < 0,
    };
  });

  return { bars, baselineY };
}
