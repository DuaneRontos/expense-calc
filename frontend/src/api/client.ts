import { Platform } from 'react-native';

import { ApiError, readProblem } from './problem';
import { Session } from './session';
import type {
  CategoryBreakdown,
  CategoryView,
  CreateExpenseRequest,
  ExpenseDetail,
  ExpensePage,
  ExpenseQuery,
  LoginRequest,
  LogoutResult,
  PeriodComparison,
  ReclassifyRequest,
  SpendOverTime,
  TimeBucket,
  Tokens,
  UpdateExpenseRequest,
} from './types';
import { assertSendableAmount } from '../money/format';

/**
 * The typed API client (issue #13).
 *
 * Everything the app knows about HTTP lives here. Screens call methods that
 * return the wire types in `./types` and throw {@link ApiError} on failure —
 * they never see a `Response`, a status code, or a query string.
 *
 * **Money crosses this boundary as a decimal string in both directions.** No
 * method takes or returns a `number` for an amount, and none does arithmetic on
 * one: the backend owns every total (spec §3), so there is nothing here to add
 * up. That is the whole reason this layer can be type-safe about money at all.
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
  session?: Session;
}

interface RequestOptions extends RequestInit {
  /** Endpoints that must not carry a token or trigger a refresh. */
  anonymous?: boolean;
}

export class ExpenseCalcClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

  readonly session: Session;

  /**
   * The in-flight refresh, shared by every caller that needs one.
   *
   * Without this, a screen that fires three requests on mount with an expired
   * token starts three refreshes. Rotation makes that actively harmful rather
   * than merely wasteful: each exchange invalidates the previous token, so the
   * second and third arrive holding a token the first just killed, and the user
   * is signed out by their own app loading a screen.
   */
  private refreshing: Promise<void> | null = null;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.session = options.session ?? new Session();
  }

  private async send<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { anonymous, ...init } = options;
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json, application/problem+json');
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (!anonymous) {
      const token = this.session.currentAccessToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
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

  /**
   * Sends a request, refreshing the access token around it when needed.
   *
   * Refreshes proactively when the token is at or near expiry — the API returns
   * `expiresInSeconds` precisely so a client can do that rather than wait for a
   * failure — and reactively, exactly once, on a 401. The single retry matters:
   * retrying a 401 that a fresh token also fails is an infinite loop against the
   * server, and the second failure is real.
   */
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (options.anonymous) {
      return this.send<T>(path, options);
    }

    if (this.session.needsRefresh() && (await this.session.isResumable())) {
      await this.refreshOnce();
    }

    try {
      return await this.send<T>(path, options);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isUnauthorized) {
        throw error;
      }
      if (!(await this.session.isResumable())) {
        throw error;
      }

      await this.refreshOnce();
      return this.send<T>(path, options);
    }
  }

  /** Collapses concurrent refreshes into one exchange. */
  private refreshOnce(): Promise<void> {
    this.refreshing ??= this.refresh()
      .catch(async (error: unknown) => {
        // A rejected refresh token is not recoverable: it has either expired or
        // been rotated away. Clearing here means the next request presents no
        // credential and gets a clean 401 rather than replaying a dead token.
        if (error instanceof ApiError && error.isUnauthorized) {
          await this.session.clear();
        }
        throw error;
      })
      .finally(() => {
        this.refreshing = null;
      });

    return this.refreshing;
  }

  // ---- auth (spec §9.2) -------------------------------------------------

  /** `POST /auth/login`. Stores both halves per the spec's per-target table. */
  async login(credentials: LoginRequest): Promise<void> {
    const tokens = await this.send<Tokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
      anonymous: true,
    });
    await this.session.adopt(tokens);
  }

  /**
   * `POST /auth/refresh` — exchanges the stored refresh token for a new pair.
   *
   * The old token dies the moment this succeeds, so a client that loses the
   * response has to sign in again. That is the correct trade: a refresh token
   * that survives being used never expires in practice once captured.
   */
  async refresh(): Promise<void> {
    const refreshToken = await this.session.refreshToken();
    if (!refreshToken) {
      throw new ApiError({ status: 401, title: 'Session expired' });
    }

    const tokens = await this.send<Tokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      anonymous: true,
    });
    await this.session.adopt(tokens);
  }

  /**
   * `POST /auth/logout` — revokes every refresh token server-side.
   *
   * Local state is cleared even if the call fails. A user who pressed sign out
   * on a flaky connection should not be left holding a usable token because the
   * request timed out.
   */
  async logout(): Promise<LogoutResult | null> {
    try {
      return await this.request<LogoutResult>('/auth/logout', { method: 'POST' });
    } catch {
      return null;
    } finally {
      await this.session.clear();
    }
  }

  // ---- reads ------------------------------------------------------------

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

  // ---- writes -----------------------------------------------------------

  /**
   * `POST /expenses` — creates and classifies.
   *
   * `async` so that a rejected amount arrives as a rejected promise like every
   * other failure here. Validating in a non-async method threw synchronously,
   * which a caller written as `create(...).catch(showFieldError)` would miss
   * entirely — the throw escapes before there is a promise to catch on.
   */
  async createExpense(request: CreateExpenseRequest): Promise<ExpenseDetail> {
    return this.request<ExpenseDetail>('/expenses', {
      method: 'POST',
      body: JSON.stringify({ ...request, amount: assertSendableAmount(request.amount) }),
    });
  }

  /**
   * `PATCH /expenses/{id}` — partial update.
   *
   * Undefined fields are dropped rather than serialized as `null`. Both mean
   * "leave alone" to this API, but only one of them says so without relying on
   * the server reading a null the same way.
   */
  async updateExpense(id: string, request: UpdateExpenseRequest): Promise<ExpenseDetail> {
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(request)) {
      if (value !== undefined) {
        body[key] = key === 'amount' ? assertSendableAmount(value) : value;
      }
    }

    return this.request<ExpenseDetail>(`/expenses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /** `POST /expenses/{id}/classification` — appends a user reclassification. */
  reclassify(id: string, request: ReclassifyRequest): Promise<ExpenseDetail> {
    return this.request<ExpenseDetail>(`/expenses/${encodeURIComponent(id)}/classification`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** `DELETE /expenses/{id}` — 204, classification history cascaded. */
  deleteExpense(id: string): Promise<void> {
    return this.request<void>(`/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ---- reports (spec §7) ------------------------------------------------

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
