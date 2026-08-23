import { lastDays, monthOf, previousMonthOf, todayInManila } from '../periods';

describe('todayInManila', () => {
  it('is already tomorrow in Manila late in the UTC day', () => {
    // 17:00 UTC on 31 January is 01:00 on 1 February in Manila. Resolving this
    // against UTC would report the wrong month for eight hours a day, which is
    // the mistake spec §4 calls out by name.
    expect(todayInManila(Date.parse('2026-01-31T17:00:00Z'))).toBe('2026-02-01');
  });

  it('is still the same day earlier in the UTC day', () => {
    expect(todayInManila(Date.parse('2026-01-31T15:59:00Z'))).toBe('2026-01-31');
  });
});

describe('monthOf', () => {
  it('is half-open, ending on the first of the next month', () => {
    // [Jan 1, Feb 1) is January with no chance of the boundary day counting
    // twice — spec §6 is explicit that this is not a detail.
    expect(monthOf('2026-01-15')).toEqual({ from: '2026-01-01', to: '2026-02-01' });
  });

  it('rolls the year over in December', () => {
    expect(monthOf('2026-12-09')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
});

describe('previousMonthOf', () => {
  it('is the calendar month before, not thirty days back', () => {
    expect(previousMonthOf('2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-03-01' });
  });

  it('rolls the year back in January', () => {
    expect(previousMonthOf('2026-01-09')).toEqual({ from: '2025-12-01', to: '2026-01-01' });
  });
});

describe('lastDays', () => {
  it('ends tomorrow, so today is included', () => {
    // A window ending today would silently exclude everything recorded since
    // midnight — the expenses most likely to be why someone looked.
    expect(lastDays(30, '2026-08-23')).toEqual({ from: '2026-07-25', to: '2026-08-24' });
  });

  it('counts today as one of the days', () => {
    expect(lastDays(1, '2026-08-23')).toEqual({ from: '2026-08-23', to: '2026-08-24' });
  });

  it('crosses a month boundary without drift', () => {
    expect(lastDays(90, '2026-03-01')).toEqual({ from: '2025-12-02', to: '2026-03-02' });
  });
});
