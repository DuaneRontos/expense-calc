import {
  formatMoney,
  isNegative,
  splitAmount,
  toChartNumber,
} from '../format';

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
