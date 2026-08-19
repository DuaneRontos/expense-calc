/**
 * The wire types of the backend API (spec §8).
 *
 * Mirrored by hand from the Java records rather than generated, because there
 * is no schema document to generate from yet. Kept in the same order as the
 * spec's endpoint table so the two can be read side by side.
 *
 * **Every money field is a `string`, and that is deliberate.** Spec §8: money
 * crosses the wire as a decimal string, never a JSON number, because a JSON
 * number is a double by the time `JSON.parse` is done with it. Typing these as
 * `number` here would not just be wrong, it would make the wrong thing
 * compile — `bucket.total * 2` would type-check and silently lose centavos.
 */

/** The closed taxonomy (spec §4). Served by `/categories`; never hardcode a label. */
export type Category =
  | 'HOUSING'
  | 'UTILITIES'
  | 'GROCERIES'
  | 'DINING'
  | 'TRANSPORT'
  | 'MAINTENANCE'
  | 'HEALTH'
  | 'DISCRETIONARY'
  | 'CAPITAL'
  | 'INCOME'
  | 'UNCLASSIFIED';

/** Who decided a category. `RULE_ENGINE` guessed; `USER` said so. */
export type ClassificationSource = 'RULE_ENGINE' | 'USER' | 'IMPORT';

/** Slice width for `/reports/over-time`. The API accepts these case-insensitively. */
export type TimeBucket = 'DAY' | 'WEEK' | 'MONTH';

/** ISO-8601 date, `YYYY-MM-DD`. A `LocalDate` on the server — no zone attached. */
export type IsoDate = string;

/** ISO-8601 instant. An audit timestamp, always UTC on the wire. */
export type IsoInstant = string;

/** A signed decimal string, e.g. `"1234.56"` or `"-500.00"`. Never a number. */
export type DecimalString = string;

/** `GET /categories` — the taxonomy with display labels. */
export interface CategoryView {
  key: Category;
  label: string;
}

/** One row of `GET /expenses`. */
export interface ExpenseSummary {
  id: string;
  amount: DecimalString;
  currency: string;
  occurredOn: IsoDate;
  merchant: string | null;
  description: string | null;
  category: Category;
  categoryLabel: string;
}

/** One entry of an expense's append-only classification history, newest first. */
export interface ClassificationView {
  category: Category;
  categoryLabel: string;
  source: ClassificationSource;
  reason: string;
  recordedAt: IsoInstant;
}

/** `GET /expenses/{id}` — one expense with its history. */
export interface ExpenseDetail {
  id: string;
  amount: DecimalString;
  currency: string;
  occurredOn: IsoDate;
  merchant: string | null;
  description: string | null;
  category: Category;
  categoryLabel: string;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
  classifications: ClassificationView[];
}

/**
 * `GET /expenses` — a page plus the counts a pager needs.
 *
 * `size` is what the server actually applied, which may be smaller than asked
 * for: the API clamps at 200 rather than rejecting, so a client that asked for
 * 500 has to read this field to know what it got.
 */
export interface ExpensePage {
  items: ExpenseSummary[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

/** A half-open reporting window, `[from, to)` (spec §6). */
export interface ReportPeriod {
  from: IsoDate;
  to: IsoDate;
}

/**
 * One slice of a single-series report.
 *
 * `total` may be negative — a category whose refunds exceeded its spending nets
 * below zero, and spec §7 requires that be rendered rather than clamped.
 */
export interface ReportBucket {
  key: string;
  label: string;
  total: DecimalString;
}

/** `GET /reports/by-category`. Buckets are ranked by total descending. */
export interface CategoryBreakdown {
  period: ReportPeriod;
  currency: string;
  total: DecimalString;
  buckets: ReportBucket[];
}

/** `GET /reports/over-time`. Buckets are contiguous — an empty slice is `"0.00"`. */
export interface SpendOverTime {
  period: ReportPeriod;
  bucket: TimeBucket;
  currency: string;
  total: DecimalString;
  buckets: ReportBucket[];
}

/** One category across both periods of a comparison. */
export interface ComparisonBucket {
  key: string;
  label: string;
  current: DecimalString;
  previous: DecimalString;
  /**
   * Current minus previous, absolute rather than a percentage. The server is
   * explicit about why: every category that was zero last period would have a
   * zero denominator, and with signed amounts a category can cross zero, where
   * a percentage is not merely undefined but misleading.
   */
  change: DecimalString;
}

/** `GET /reports/compare`. */
export interface PeriodComparison {
  current: ReportPeriod;
  previous: ReportPeriod;
  currency: string;
  currentTotal: DecimalString;
  previousTotal: DecimalString;
  buckets: ComparisonBucket[];
}

/** `POST /auth/login` and `/auth/refresh` (spec §9.2). */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/** Query parameters for `GET /expenses` (spec §6). All optional, AND semantics. */
export interface ExpenseQuery {
  /** OR within this list, AND against every other filter. */
  category?: Category[];
  /** Inclusive lower bound on `occurredOn`. */
  from?: IsoDate;
  /** **Exclusive** upper bound — the range is half-open. */
  to?: IsoDate;
  merchant?: string;
  /** Case-insensitive substring over the description. */
  q?: string;
  /** Compared against the *signed* amount, so `"0"` excludes refunds. */
  minAmount?: DecimalString;
  maxAmount?: DecimalString;
  sort?: ExpenseSortSpec;
  page?: number;
  /** Clamped to 200 by the server; the response reports what was applied. */
  size?: number;
}

export type ExpenseSortField = 'occurredOn' | 'amountMinor' | 'merchant' | 'category';

export type SortDirection = 'asc' | 'desc';

/**
 * Serialized as `field,dir`. Modelled as a pair rather than a raw string so a
 * typo cannot reach the server — it rejects an unknown direction with a 400
 * rather than silently reversing the order.
 */
export interface ExpenseSortSpec {
  field: ExpenseSortField;
  direction: SortDirection;
}
