import { Platform } from 'react-native';

import { ApiError, readProblem } from './problem';
import { Session, type AdoptResult } from './session';
import type {
  CategoryBreakdown,
  CategoryView,
  ClientType,
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
    // A release build pointed at `http://` sends the password from `login()`
    // and the refresh token from `refresh()` in cleartext, and nothing in the
    // build, the tests or CI would say a word — a one-character omission in a
    // CI variable is all it takes. Spec §10 requires TLS everywhere once
    // deployed; this is that rule with a way to fail loudly.
    if (!__DEV__ && !configured.startsWith('https://')) {
      throw new Error(
        'EXPO_PUBLIC_API_URL must be https:// in a release build; got ' +
          `${configured}. Tokens and passwords would otherwise cross the network in cleartext.`,
      );
    }
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
    // Validated like a write amount, and for the same reason: the server runs
    // these through the same `Money.toMinorUnits` and 400s on sub-centavo
    // precision, so a typo in #15's filter inputs should be a field error
    // rather than a round trip.
    ['minAmount', query.minAmount && assertSendableAmount(query.minAmount)],
    ['maxAmount', query.maxAmount && assertSendableAmount(query.maxAmount)],
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
  /**
   * Which half of spec §9.2's storage table to follow. Defaults to
   * {@link CLIENT_TYPE}, this build's platform.
   *
   * Injectable for the same reason `fetchImpl` is: jest runs the native
   * variant of every platform-split module, so without this the web branch —
   * the one issue #57 exists for — could be type-checked and never executed.
   */
  clientType?: ClientType;
}

interface RequestOptions extends RequestInit {
  /** Endpoints that must not carry a token or trigger a refresh. */
  anonymous?: boolean;
}

/**
 * Which half of spec §9.2's storage table this build follows (issue #57).
 *
 * Derived once from the platform rather than passed in by a screen: it is a
 * property of the bundle, not of the sign-in form, and a screen that got it
 * wrong would fail silently in both directions.
 */
export const CLIENT_TYPE: ClientType = Platform.OS === 'web' ? 'web' : 'device';

/**
 * Sent on a refresh that authenticates with the cookie (issue #57).
 *
 * **The header's presence is the CSRF defence, not its value.** The browser
 * attaches the cookie by itself, so an attacker's page can cause the request;
 * it cannot make the browser add a header, and a cross-origin `fetch` that adds
 * one is preflighted against the API's origin allowlist.
 */
const REFRESH_SOURCE_HEADER = 'X-Refresh-Source';

/** The server's problem type for "no refresh token arrived" (issue #57). */
const MISSING_REFRESH_TOKEN_PROBLEM = 'https://expense-calc.invalid/problems/bad-request';

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

  private readonly clientType: ClientType;

  /**
   * Set once sign-out is requested, cleared when a session is adopted.
   *
   * Only meaningful on web, where the credential is a cookie this code cannot
   * delete. See {@link canResume}.
   */
  private signedOut = false;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/$/, '');
    // Wrapped rather than captured bare, so `fetch` is invoked on the global
    // instead of as a method on this instance.
    //
    // **This is load-bearing on web, not defensive.** Calling the browser's
    // native `fetch` with `this` bound to anything else rejects with
    // `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`,
    // and every request from this client would fail before reaching the
    // network. Confirmed in Chrome against the running dev server:
    //
    //     const holder = { f: globalThis.fetch };
    //     await holder.f('/favicon.ico');   // → Illegal invocation
    //     await ((i) => globalThis.fetch(i))('/favicon.ico');  // → fine
    //
    // The `await` matters: `fetch` surfaces this as a **rejected promise**, not
    // a synchronous throw. An earlier check of this used an un-awaited call
    // inside try/catch, saw nothing, and wrongly reported the problem as not
    // reproducing. Native tests cannot catch it either — RN's `fetch` is the
    // whatwg-fetch polyfill, a plain function that ignores its receiver — and
    // neither can jest, which injects a mock.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.session = options.session ?? new Session();
    this.clientType = options.clientType ?? CLIENT_TYPE;
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
      // Without this a browser sends no cookie on a cross-origin request, so
      // the refresh cookie the server set would never come back and the web
      // client would be signed out by every page refresh — the exact bug #57
      // exists to fix. Ignored by the native platforms, which have no cookies.
      credentials: 'include',
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

    if (this.session.needsRefresh() && (await this.canResume())) {
      try {
        await this.refresh();
      } catch (error) {
        // A proactive refresh is an optimisation, not a precondition. It runs
        // during the last 30 seconds of a token that still works, so a 503 or a
        // dropped connection from /auth/refresh used to fail every request on
        // the screen while a perfectly good token sat in memory — and the 401
        // path below, which exists for exactly this, never ran.
        //
        // With nothing in memory there is no fallback, so that still propagates.
        if (!this.session.currentAccessToken()) {
          throw error;
        }
      }
    }

    // Snapshotted before the request so a 401 that arrives after another
    // caller already refreshed retries with the new token instead of rotating
    // again. The single-flight guard only covers refreshes that overlap; two
    // requests failing in sequence on the same dead token do not.
    const attemptedWith = this.session.currentAccessToken();

    try {
      return await this.send<T>(path, options);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isUnauthorized) {
        throw error;
      }
      if (!(await this.canResume())) {
        throw error;
      }

      // Deliberately not `needsRefresh()`: the server can reject a token the
      // client believes is fresh — clock skew, or an instance restarted with a
      // new signing key — and that is the case this path exists for.
      if (this.session.currentAccessToken() === attemptedWith) {
        await this.refresh();
      }
      return this.send<T>(path, options);
    }
  }

  /**
   * `POST /auth/refresh` — exchanges the stored refresh token for a new pair,
   * collapsing concurrent callers into one exchange.
   *
   * **This is the public entry point, and the guard is the reason.** The
   * unguarded exchange used to be the public method while the guard was
   * private, so a screen calling `api.refresh()` directly — a plausible thing
   * to reach for — raced any in-flight refresh and produced exactly the
   * rotation collision the guard exists to prevent.
   */
  /**
   * Whether a refresh is worth attempting at all.
   *
   * **On web this cannot be answered from the client**, and asking the session
   * gets the wrong answer. `Session.isResumable()` is the truthiness of the
   * store, and since #57 the web store is empty *by design* — the browser holds
   * the credential in an `httpOnly` cookie no script can read. Gating on it
   * there made both refresh paths unreachable, so a page reload still signed a
   * web user out: the cookie sat in the browser and was never exchanged.
   *
   * So on web: assume yes, and let `/auth/refresh` be the thing that says
   * otherwise. It is one cheap request, and it is the only participant that can
   * actually see the cookie.
   */
  private canResume(): Promise<boolean> {
    if (this.clientType !== 'web') {
      return this.session.isResumable();
    }

    // **Except once sign-out has been asked for.** `logout()` clears local state
    // even when the call fails, and on web `store.clear()` cannot touch the
    // cookie — only the server can. Without this flag a failed sign-out shows
    // the user a signed-out screen and then silently signs them back in on the
    // next request, because the cookie is still live and this method would
    // otherwise still say "try".
    return Promise.resolve(!this.signedOut);
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.exchangeRefreshToken()
      .catch(async (error: unknown) => {
        // A rejected refresh token is not recoverable: it has either expired or
        // been rotated away. Clearing here means the next request presents no
        // credential and gets a clean 401 rather than replaying a dead token.
        //
        // A 400 counts on web. The server answers that when no token arrived at
        // all, which for a cookie client means precisely "you are signed out" —
        // and treating it as a transport error instead put a request failure on
        // screen where a sign-in prompt belonged.
        if (error instanceof ApiError && (error.isUnauthorized || this.isMissingWebCookie(error))) {
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

  /**
   * `POST /auth/login`. Stores both halves per the spec's per-target table.
   *
   * Returns whether the refresh token was persisted. A device with no secure
   * lock screen has no Keystore to write to, and the session then ends silently
   * when the access token expires — so the caller gets told rather than the
   * user discovering it fifteen minutes later at a sign-in screen.
   */
  async login(credentials: Omit<LoginRequest, 'client'>): Promise<AdoptResult> {
    const tokens = await this.send<Tokens>('/auth/login', {
      method: 'POST',
      // `client` is this build's, never the caller's: the server uses it to
      // decide whether the refresh token comes back in a cookie or in the body,
      // and a screen is not the thing that knows which platform it is on.
      body: JSON.stringify({ ...credentials, client: this.clientType }),
      anonymous: true,
    });
    this.signedOut = false;
    return this.session.adopt(tokens, this.clientType === 'web');
  }

  /**
   * The refresh exchange itself. Always reached through {@link refresh}.
   *
   * The old token dies the moment this succeeds, so a client that loses the
   * response has to sign in again. That is the correct trade: a refresh token
   * that survives being used never expires in practice once captured.
   */
  /**
   * A web refresh the browser sent no cookie with: signed out, not broken.
   *
   * Matched on the server's own problem type rather than on the bare status. A
   * 400 from a proxy, or from the auth validation handler if the refresh body
   * ever gains a constraint, would otherwise drop the user at a sign-in screen
   * for a reason that has nothing to do with their session.
   */
  private isMissingWebCookie(error: ApiError): boolean {
    return (
      this.clientType === 'web' &&
      error.status === 400 &&
      error.problem.type === MISSING_REFRESH_TOKEN_PROBLEM
    );
  }

  private async exchangeRefreshToken(): Promise<void> {
    const viaCookie = this.clientType === 'web';
    const refreshToken = viaCookie ? null : await this.session.refreshToken();

    // On web there is nothing to read: the token is in an `httpOnly` cookie the
    // browser attaches to this request on its own, and no script can see it.
    // An empty store is the normal state there, not an expired session.
    if (!refreshToken && !viaCookie) {
      throw new ApiError({ status: 401, title: 'Session expired' });
    }

    // **Both keyed off the client type, not off whether the store happened to
    // hold something.** The server picks its branch the same way — a body token
    // means "device" — so a web build that ever put a value in that store would
    // send one, be classified as a device, and get the refresh token back in a
    // response body a script can read. That is the single outcome `httpOnly`
    // exists to prevent, reached without either side doing anything it thinks
    // is wrong.
    const tokens = await this.send<Tokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(viaCookie ? {} : { refreshToken }),
      headers: viaCookie ? { [REFRESH_SOURCE_HEADER]: 'cookie' } : undefined,
      anonymous: true,
    });

    this.signedOut = false;
    await this.session.adopt(tokens, viaCookie);
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
      // Set even when the call failed, which is the point: local state is
      // cleared regardless, and on web the cookie outlives it.
      this.signedOut = true;
      await this.session.clear();
    }
  }

  // ---- reads ------------------------------------------------------------

  /** `GET /categories` — the taxonomy, so no screen hardcodes a label. */
  categories(): Promise<CategoryView[]> {
    return this.request<CategoryView[]>('/categories');
  }

  /**
   * `GET /expenses` — filtered, sorted, paginated (spec §6).
   *
   * `async` because the amount bounds are validated while building the query,
   * and a synchronous throw would escape a caller's `.catch`.
   */
  async expenses(query: ExpenseQuery = {}): Promise<ExpensePage> {
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
