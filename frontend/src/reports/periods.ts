/**
 * Reporting periods, resolved in `Asia/Manila` (spec §4).
 *
 * **Never UTC and never the host default.** At 17:00 UTC on 31 January it is
 * already February in Manila, so a UTC-derived "this month" reports the wrong
 * month for eight hours a day. The Philippines has observed no DST since 1978,
 * so the offset is a constant +08:00 and the arithmetic below is exact.
 *
 * Every period is **half-open** — `[from, to)` — so month boundaries cannot
 * double-count. `to` is the first day of the next month, not the last of this
 * one, which is why the pickers say so out loud.
 */

import type { TimeBucket } from '../api/types';

export interface Period {
  from: string;
  to: string;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's date in Manila, as `YYYY-MM-DD`. */
export function todayInManila(now: number = Date.now()): string {
  return new Date(now + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function parts(date: string): { year: number; month: number } {
  const [year, month] = date.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1 };
}

function firstOf(year: number, month: number): string {
  // `month` is 1-based and may fall outside 1..12; normalise by arithmetic
  // rather than by Date, which would drag the host's zone back in.
  const shifted = year * 12 + (month - 1);
  const y = Math.floor(shifted / 12);
  const m = (shifted % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

/** The calendar month containing `date`, half-open. */
export function monthOf(date: string): Period {
  const { year, month } = parts(date);
  return { from: firstOf(year, month), to: firstOf(year, month + 1) };
}

/** The calendar month before the one containing `date`. */
export function previousMonthOf(date: string): Period {
  const { year, month } = parts(date);
  return { from: firstOf(year, month - 1), to: firstOf(year, month) };
}

/**
 * The last `days` days ending today, half-open.
 *
 * `to` is tomorrow, so today's own expenses are included — a range ending today
 * would silently exclude everything recorded since midnight.
 */
export function lastDays(days: number, today: string = todayInManila()): Period {
  const start = new Date(`${today}T00:00:00Z`).getTime() - (days - 1) * 86_400_000;
  const end = new Date(`${today}T00:00:00Z`).getTime() + 86_400_000;
  return {
    from: new Date(start).toISOString().slice(0, 10),
    to: new Date(end).toISOString().slice(0, 10),
  };
}

/**
 * A period in words, stated as the half-open range it actually is.
 *
 * Lives here so every caption on the screen says it the same way. "1 July to
 * 1 August" reads as including 1 August, which is precisely the day the window
 * excludes and the totals beside it leave out — a sentence that contradicts the
 * number next to it.
 */
export function describePeriod(period: Period): string {
  return `${period.from} up to but not including ${period.to}`;
}

export interface PeriodChoice {
  key: string;
  label: string;
  period: (today: string) => Period;
  /**
   * How `/reports/over-time` should slice this preset.
   *
   * **Chosen per preset because the bucket has to divide the window.** A fixed
   * `MONTH` turns "Last 30 days" into a seven-day slice of July drawn beside a
   * twenty-three-day slice of August, both labelled as whole months — the bar
   * heights then compare two different lengths of time while the labels claim
   * they don't.
   *
   * `DAY` can never be partial, so it is the honest default. Ninety of them is
   * more bars than a panel can draw legibly, so the widest preset steps up to
   * `WEEK`, whose label names the week's first day rather than claiming a whole
   * unit — the end buckets there are still clipped by the window, but the label
   * no longer overstates them.
   */
  bucket: TimeBucket;
}

/** The presets offered. Custom ranges are #17's business, not this screen's. */
export const PERIOD_CHOICES: PeriodChoice[] = [
  { key: 'this-month', label: 'This month', period: (today) => monthOf(today), bucket: 'DAY' },
  {
    key: 'last-month',
    label: 'Last month',
    period: (today) => previousMonthOf(today),
    bucket: 'DAY',
  },
  { key: 'last-30', label: 'Last 30 days', period: (today) => lastDays(30, today), bucket: 'DAY' },
  { key: 'last-90', label: 'Last 90 days', period: (today) => lastDays(90, today), bucket: 'WEEK' },
];

/** What a bar in an over-time chart of `bucket` covers, for the legend heading. */
export function bucketLegendTitle(bucket: TimeBucket): string {
  // Derived from the response's own `bucket` rather than from the request, so
  // the heading cannot outlive a change to what was actually asked for.
  return { DAY: 'Net per day', WEEK: 'Net per week', MONTH: 'Net per month' }[bucket];
}
