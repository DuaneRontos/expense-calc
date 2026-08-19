import { Platform } from 'react-native';

import { ApiError, readProblem } from './problem';
import type {
  CategoryBreakdown,
  CategoryView,
  ExpenseDetail,
  ExpensePage,
  ExpenseQuery,
  PeriodComparison,
  SpendOverTime,
  TimeBucket,
} from './types';

/**
 * The typed API client layer (issue #3; the full client and models are #13).
 *
 * Everything the app knows about HTTP lives here. Screens call methods that
 * return the wire types in `./types` and throw {@link ApiError} on failure —
 * they never see a `Response`, a status code, or a query string.
 */

/**
 * Where the API lives.
 *
 * `EXPO_PUBLIC_` is the only env prefix Expo inlines into the bundle, and this
 * value is a hostname rather than a secret, so that is the right mechanism.
 *
 * The default is per-platform because `localhost` does not mean the same thing
 * on all three targets: on an Android emulator it is the emulator itself, and
 * the host machine is `10.0.2.2`. Getting this wrong presents as a connection
 * refused that looks like the backend is down.
 */
function defaultBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';
}

export const API_BASE_PATH = '/api/v1';

/**
 * Holds the access token in memory for the life of the process.
 *
 * **Spec §9.2 forbids `localStorage` outright**, and by extension
 * `AsyncStorage`, which is `localStorage` on web. A token there is readable by
 * any script that achieves XSS. The refresh token's storage differs per target
 * — SecureStore on device, an `httpOnly` cookie on web — and belongs to #13;
 * this holder deliberately covers only the access token, which is in memory on
 * every target.
 */
class AccessTokenHolder {
  private token: string | null = null;

  get(): string | null {
    return this.token;
  }

  set(token: string | null): void {
    this.token = token;
  }
}

export const accessToken = new AccessTokenHolder();

/**
 * Serializes {@link ExpenseQuery} into the shape the server parses (spec §6).
 *
 * `category` repeats rather than joining with commas — the server binds it as a
 * repeated parameter, and a comma-joined value would arrive as one unknown
 * category name and come back a 400.
 */
export function buildExpenseQuery(query: ExpenseQuery = {}): string {
  const params = new URLSearchParams();

  for (const category of query.category ?? []) {
    params.append('category', category);
  }

  const scalars: [string, string | number | undefined][] = [
    ['from', query.from],
    ['to', query.to],
    ['merchant', query.merchant],
    ['q', query.q],
    ['minAmount', query.minAmount],
    ['maxAmount', query.maxAmount],
    ['page', query.page],
    ['size', query.size],
  ];

  for (const [key, value] of scalars) {
    // `0` is a meaningful page number and a meaningful amount bound, so this
    // tests for null and undefined rather than for falsiness.
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  }

  if (query.sort) {
    params.append('sort', `${query.sort.field},${query.sort.direction}`);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export interface ClientOptions {
  baseUrl?: string;
  /** Injected in tests. Defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

export class ExpenseCalcClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = accessToken.get();
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json, application/problem+json');
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${API_BASE_PATH}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new ApiError(await readProblem(response));
    }

    // 204 from DELETE has no body, and `response.json()` on an empty body
    // throws a parse error that reads like the server misbehaved.
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /** `GET /categories` — the taxonomy, so no screen hardcodes a label. */
  categories(): Promise<CategoryView[]> {
    return this.request<CategoryView[]>('/categories');
  }

  /** `GET /expenses` — filtered, sorted, paginated (spec §6). */
  expenses(query: ExpenseQuery = {}): Promise<ExpensePage> {
    return this.request<ExpensePage>(`/expenses${buildExpenseQuery(query)}`);
  }

  /** `GET /expenses/{id}` — one expense with its classification history. */
  expense(id: string): Promise<ExpenseDetail> {
    return this.request<ExpenseDetail>(`/expenses/${encodeURIComponent(id)}`);
  }

  /**
   * `GET /reports/by-category`.
   *
   * Both bounds or neither: the server rejects one alone, because "January to
   * unspecified" has two readings and guessing produces a report that is wrong
   * without looking wrong.
   */
  byCategory(period?: { from: string; to: string }): Promise<CategoryBreakdown> {
    return this.request<CategoryBreakdown>(`/reports/by-category${periodQuery(period)}`);
  }

  /** `GET /reports/over-time` — contiguous buckets, zero-filled. */
  overTime(
    period?: { from: string; to: string },
    bucket: TimeBucket = 'MONTH',
  ): Promise<SpendOverTime> {
    const query = periodQuery(period);
    const separator = query ? '&' : '?';
    return this.request<SpendOverTime>(
      `/reports/over-time${query}${separator}bucket=${bucket.toLowerCase()}`,
    );
  }

  /** `GET /reports/compare` — current against the period before it. */
  compare(period?: { from: string; to: string }): Promise<PeriodComparison> {
    return this.request<PeriodComparison>(`/reports/compare${periodQuery(period)}`);
  }
}

function periodQuery(period?: { from: string; to: string }): string {
  if (!period) {
    return '';
  }
  return `?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`;
}

/** The app-wide instance. Tests construct their own with an injected `fetch`. */
export const api = new ExpenseCalcClient();
