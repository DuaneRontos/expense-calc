import { arcPath, barModel, donutModel } from '../geometry';
import type { ReportBucket } from '../../api/types';

const bucket = (key: string, total: string): ReportBucket => ({ key, label: key, total });

describe('donutModel', () => {
  it('excludes net-negative categories from the arc but hands them back', () => {
    const model = donutModel(
      [bucket('GROCERIES', '100.00'), bucket('MAINTENANCE', '-25.00')],
      50,
      50,
      50,
      30,
    );

    expect(model.arcs.map((arc) => arc.key)).toEqual(['GROCERIES']);
    // Spec §7: listed with its real value, not dropped and not clamped to zero.
    expect(model.excluded.map((b) => b.total)).toEqual(['-25.00']);
  });

  it('divides the ring by the positive total, not by the net total', () => {
    // Net is 75.00, but the single drawn slice must still be a full circle —
    // dividing by the net would make one category sweep 133% of the ring.
    const model = donutModel(
      [bucket('GROCERIES', '100.00'), bucket('MAINTENANCE', '-25.00')],
      50,
      50,
      50,
      30,
    );

    expect(model.positiveTotal).toBe(100);
    expect(model.arcs[0]!.endAngle).toBeCloseTo(Math.PI * 2, 6);
  });

  it('drops zero buckets, which a contiguous time axis is full of', () => {
    const model = donutModel([bucket('DINING', '10.00'), bucket('HEALTH', '0.00')], 50, 50, 50, 30);
    expect(model.arcs.map((arc) => arc.key)).toEqual(['DINING']);
  });

  it('returns no arcs when every bucket is zero or negative', () => {
    const model = donutModel([bucket('HEALTH', '-5.00')], 50, 50, 50, 30);
    expect(model.arcs).toEqual([]);
    expect(model.positiveTotal).toBe(0);
  });

  it('preserves the server ranking so ring and legend read in the same order', () => {
    const model = donutModel(
      [bucket('A', '30.00'), bucket('B', '20.00'), bucket('C', '10.00')],
      50,
      50,
      50,
      30,
    );
    expect(model.arcs.map((arc) => arc.key)).toEqual(['A', 'B', 'C']);
  });
});

describe('arcPath', () => {
  it('draws a full circle as two arcs rather than one degenerate one', () => {
    // A single A command from an angle back to itself renders as nothing, which
    // would make the one-category report — the first one a new user sees — an
    // empty ring.
    const path = arcPath(50, 50, 50, 30, 0, Math.PI * 2);
    expect(path.match(/A /g)?.length).toBe(4);
  });

  it('sets the large-arc flag past a half turn', () => {
    expect(arcPath(50, 50, 50, 30, 0, Math.PI * 1.5)).toContain('0 1 1');
    expect(arcPath(50, 50, 50, 30, 0, Math.PI * 0.5)).toContain('0 0 1');
  });
});

describe('barModel', () => {
  it('puts the baseline off the floor when a bucket is negative', () => {
    const model = barModel([bucket('a', '100.00'), bucket('b', '-100.00')], 200, 100);
    expect(model.baselineY).toBeCloseTo(50, 6);
    expect(model.bars[1]!.negative).toBe(true);
    expect(model.bars[1]!.y).toBeCloseTo(50, 6);
  });

  it('does not clamp the domain at zero', () => {
    const model = barModel([bucket('a', '-50.00')], 200, 100);
    expect(model.bars[0]!.height).toBeGreaterThan(0);
  });

  it('survives an all-zero period, which spec §7 calls a valid answer', () => {
    const model = barModel([bucket('a', '0.00'), bucket('b', '0.00')], 200, 100);
    expect(model.bars.every((bar) => bar.height === 0)).toBe(true);
    expect(model.baselineY).toBe(100);
  });

  it('returns nothing to draw for an empty bucket array', () => {
    expect(barModel([], 200, 100).bars).toEqual([]);
  });
});
