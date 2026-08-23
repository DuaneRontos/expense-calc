import { arcPath, barModel, donutModel, holeRadius } from '../geometry';
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

describe('donutModel drawable', () => {
  it('reports exactly the buckets that got an arc', () => {
    const model = donutModel(
      [bucket('DINING', '10.00'), bucket('HEALTH', '0.00'), bucket('CAPITAL', '-5.00')],
      50,
      50,
      50,
      30,
    );

    // The legend renders `drawable`. A zero bucket is in neither the ring nor
    // `excluded`, so deriving the legend as "buckets minus excluded" gave it a
    // coloured swatch claiming a slice that was deliberately not drawn.
    expect(model.drawable.map((b) => b.key)).toEqual(['DINING']);
    expect(model.arcs.map((a) => a.key)).toEqual(['DINING']);
    expect(model.excluded.map((b) => b.key)).toEqual(['CAPITAL']);
  });
});

describe('holeRadius', () => {
  it('stays positive when the ring is thicker than the radius', () => {
    // A negative `A` radius is invalid SVG; the renderer errors rather than
    // clamping. Reachable from a narrow container or a large `thickness` prop.
    expect(holeRadius(30, 34)).toBeGreaterThan(0);
    expect(holeRadius(5, 34)).toBeGreaterThan(0);
  });

  it('subtracts the thickness when there is room for it', () => {
    expect(holeRadius(130, 34)).toBe(96);
  });

  it('never emits a negative radius into a path', () => {
    const model = donutModel([bucket('DINING', '10.00')], 15, 15, 15, holeRadius(15, 34));
    expect(model.arcs[0]!.path).not.toMatch(/A -/);
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

describe('empty periods', () => {
  it('has no arcs and no drawn buckets for a period with nothing in it', () => {
    // Spec §7: an empty period is a 200 with no buckets — an answer, not an
    // error — so every model has to survive one rather than divide by zero.
    const model = donutModel([], 50, 50, 50, 30);

    expect(model.arcs).toEqual([]);
    expect(model.drawable).toEqual([]);
    expect(model.excluded).toEqual([]);
    expect(model.positiveTotal).toBe(0);
  });

  it('has no bars for a period with nothing in it', () => {
    const model = barModel([], 200, 100);

    expect(model.bars).toEqual([]);
    expect(model.baselineY).toBe(100);
  });
});

describe('barModel width', () => {
  it('keeps every bar inside a panel too narrow to spare the whole gap', () => {
    // A day-bucketed quarter is ninety slots in one panel. Flooring the width
    // at 1 instead pushed the last bars past the edge.
    const buckets = Array.from({ length: 90 }, (_, index) => bucket(`B${index}`, '10.00'));
    const model = barModel(buckets, 340, 100);

    for (const bar of model.bars) {
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(340);
    }
  });

  it('keeps an all-zero period inside its width too', () => {
    const buckets = Array.from({ length: 90 }, (_, index) => bucket(`B${index}`, '0.00'));
    const model = barModel(buckets, 340, 100);

    for (const bar of model.bars) {
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(340);
    }
  });
});
