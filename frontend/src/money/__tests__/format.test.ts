import {
  formatMoney,
  isNegative,
  resetMoneyFormatCache,
  splitAmount,
  toChartNumber,
} from '../format';

/**
 * These stub `Intl` to stand in for Hermes.
 *
 * The suite runs on Node, which has full ICU — so the engine that actually
 * ships this code is the one environment the tests can never observe directly.
 * Faking the shapes a shim can return is the only way to cover it at all.
 */
describe('degraded Intl engines', () => {
  const RealIntl = globalThis.Intl;

  afterEach(() => {
    globalThis.Intl = RealIntl;
    resetMoneyFormatCache();
  });

  it('formats with the ISO code when formatToParts is missing', () => {
    globalThis.Intl = {
      ...RealIntl,
      // Hermes shims Intl over platform ICU; formatToParts is among the least
      // reliably present members. Calling it blind throws inside render.
      NumberFormat: function () {
        return { format: (value: number) => String(value) };
      },
    } as unknown as typeof Intl;
    resetMoneyFormatCache();

    const formatted = formatMoney('1234.56');

    expect(formatted).toContain('1,234.56');
    // The ISO code, never a hardcoded peso glyph — the CLAUDE.md rule holds
    // on the fallback path too.
    expect(formatted).toContain('PHP');
    expect(formatted).not.toContain('₱');
  });

  it('survives Intl.NumberFormat throwing outright', () => {
    globalThis.Intl = {
      ...RealIntl,
      NumberFormat: function () {
        throw new Error('no ICU data');
      },
    } as unknown as typeof Intl;
    resetMoneyFormatCache();

    expect(formatMoney('-500.00')).toContain('500.00');
    expect(formatMoney('-500.00')).toMatch(/^-/);
  });

  it('does not inject the sign into every amount when it arrives as a literal', () => {
    // An engine that reports the minus as a `literal` rather than a `minusSign`
    // would poison the separator taken by document order, so 1234.56 would
    // render as a negative. The separator is taken positionally instead.
    globalThis.Intl = {
      ...RealIntl,
      NumberFormat: function () {
        return {
          formatToParts: () => [
            { type: 'literal', value: '-' },
            { type: 'currency', value: '₱' },
            { type: 'integer', value: '1' },
            { type: 'group', value: ',' },
            { type: 'integer', value: '234' },
            { type: 'decimal', value: '.' },
            { type: 'fraction', value: '56' },
          ],
        };
      },
    } as unknown as typeof Intl;
    resetMoneyFormatCache();

    expect(formatMoney('1234.56')).not.toContain('-');
  });
});

describe('splitAmount', () => {
  it('pads a short fraction to scale 2', () => {
    expect(splitAmount('1234.5')).toEqual({ negative: false, integer: '1234', fraction: '50' });
    expect(splitAmount('7')).toEqual({ negative: false, integer: '7', fraction: '00' });
  });

  it('keeps the sign separate from the digits', () => {
    expect(splitAmount('-500.00')).toEqual({ negative: true, integer: '500', fraction: '00' });
  });

  it('rounds HALF_UP at the presentation boundary, carrying into the integer', () => {
    expect(splitAmount('1.005')).toEqual({ negative: false, integer: '1', fraction: '01' });
    expect(splitAmount('0.999')).toEqual({ negative: false, integer: '1', fraction: '00' });
    expect(splitAmount('9.994')).toEqual({ negative: false, integer: '9', fraction: '99' });
  });

  it('rejects anything that is not a decimal string', () => {
    expect(() => splitAmount('1,234.56')).toThrow(TypeError);
    expect(() => splitAmount('abc')).toThrow(TypeError);
    expect(() => splitAmount('')).toThrow(TypeError);
  });
});

describe('formatMoney', () => {
  it('formats pesos without the code hardcoding the symbol', () => {
    const formatted = formatMoney('1234.56');
    // Asserted against Intl rather than against a literal: the point of the
    // implementation is that the symbol comes from the locale data, so a test
    // spelling "₱" itself would pass even if the code hardcoded it.
    const symbol = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
      .formatToParts(1)
      .find((part) => part.type === 'currency')!.value;

    expect(formatted).toContain(symbol);
    expect(formatted).toContain('1,234.56');
  });

  it('preserves precision that a float would lose', () => {
    // 0.1 + 0.2 arithmetic is exactly what the decimal-string contract exists
    // to avoid; this value survives only because it is never a number.
    expect(formatMoney('9007199254740993.99')).toContain('9,007,199,254,740,993.99');
  });

  it('renders a refund as a negative rather than dropping the sign', () => {
    expect(formatMoney('-500.00')).toMatch(/^-/);
  });

  it('does not render negative zero with a minus', () => {
    // `isNegative` already refused to call this negative; `formatMoney` used to
    // disagree, so one legend row showed a minus sign in the non-negative text
    // colour. Both now answer from the same predicate.
    expect(formatMoney('-0.00')).not.toMatch(/^-/);
    expect(formatMoney('-0.00')).toBe(formatMoney('0.00'));
  });

  it('does not render a sign for a negative that rounds away to zero', () => {
    expect(formatMoney('-0.001')).not.toMatch(/^-/);
  });

  it('groups thousands and leaves smaller amounts ungrouped', () => {
    expect(formatMoney('999.00')).toContain('999.00');
    expect(formatMoney('1000.00')).toContain('1,000.00');
  });
});

describe('isNegative', () => {
  it('is true for a refund', () => {
    expect(isNegative('-0.01')).toBe(true);
  });

  it('is false for negative zero, which is what a fully offset category nets to', () => {
    expect(isNegative('-0.00')).toBe(false);
  });

  it('is false for positives and zero', () => {
    expect(isNegative('0.00')).toBe(false);
    expect(isNegative('12.34')).toBe(false);
  });
});

describe('toChartNumber', () => {
  it('keeps the sign, because a negative bucket is drawn below the baseline', () => {
    expect(toChartNumber('-4200.00')).toBe(-4200);
    expect(toChartNumber('18420.25')).toBeCloseTo(18420.25, 2);
  });
});
