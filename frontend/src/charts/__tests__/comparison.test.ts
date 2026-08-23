import { comparisonModel } from '../geometry';
import type { ComparisonBucket } from '../../api/types';

const pair = (key: string, current: string, previous: string, change: string): ComparisonBucket => ({
  key,
  label: key,
  current,
  previous,
  change,
});

describe('comparisonModel', () => {
  it('scales both series on one domain', () => {
    // Scaling each series to its own maximum would draw ₱100 and ₱10,000 the
    // same height, defeating the only comparison this chart makes.
    const model = comparisonModel([pair('A', '100.00', '10000.00', '-9900.00')], 200, 100);
    const [current, previous] = model.pairs[0]!.bars;

    expect(previous!.height).toBeGreaterThan(current!.height * 50);
  });

  it('does not clamp the domain at zero', () => {
    // A category can be net negative in either period (spec §7).
    const model = comparisonModel([pair('A', '-50.00', '100.00', '-150.00')], 200, 100);
    const [current] = model.pairs[0]!.bars;

    expect(current!.negative).toBe(true);
    expect(current!.height).toBeGreaterThan(0);
    expect(model.baselineY).toBeLessThan(100);
  });

  it('keeps both bars inside the width it was given', () => {
    const model = comparisonModel(
      [pair('A', '10.00', '20.00', '10.00'), pair('B', '30.00', '5.00', '25.00')],
      200,
      100,
    );

    for (const p of model.pairs) {
      for (const bar of p.bars) {
        expect(bar.x + bar.width).toBeLessThanOrEqual(200);
      }
    }
  });

  it('survives a period where everything is zero', () => {
    const model = comparisonModel([pair('A', '0.00', '0.00', '0.00')], 200, 100);

    expect(model.pairs[0]!.bars.every((bar) => bar.height === 0)).toBe(true);
    expect(model.baselineY).toBe(100);
  });

  it('has nothing to draw for an empty comparison', () => {
    expect(comparisonModel([], 200, 100).pairs).toEqual([]);
  });

  it('carries the server change figure through untouched', () => {
    // Absolute, not a percentage: every category that was zero last period has
    // a zero denominator, and a signed category can cross zero.
    expect(comparisonModel([pair('A', '10.00', '4.00', '6.00')], 200, 100).pairs[0]!.change).toBe(
      '6.00',
    );
  });
});
