import { buildExpenseQuery, ExpenseCalcClient } from '../client';
import { ApiError } from '../problem';
import { RefreshTokenUnavailableError } from '../refreshTokenStore.types';
import { Session } from '../session';
import type { RefreshTokenStore } from '../refreshTokenStore.types';

/** An in-memory stand-in for the Keychain, so tests never touch a native module. */
function memoryStore(initial: string | null = null): RefreshTokenStore {
  let token = initial;
  return {
    read: () => Promise.resolve(token),
    write: (value: string) => {
      token = value;
      return Promise.resolve();
    },
    clear: () => {
      token = null;
      return Promise.resolve();
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const problem = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresInSeconds: 900 };

/** What the server returns to a web client: the refresh token is in the cookie. */
const WEB_TOKENS = { accessToken: 'access-1', expiresInSeconds: 900 };

function clientWith(
  fetchImpl: jest.Mock,
  store: RefreshTokenStore = memoryStore(),
  now?: () => number,
) {
  return new ExpenseCalcClient({
    baseUrl: 'http://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    session: new Session(store, now),
  });
}

describe('buildExpenseQuery', () => {
  it('repeats category rather than joining it, which the server would reject', () => {
    expect(buildExpenseQuery({ category: ['DINING', 'GROCERIES'] })).toBe(
      '?category=DINING&category=GROCERIES',
    );
  });

  it('serializes sort as field,dir', () => {
    expect(buildExpenseQuery({ sort: { field: 'occurredOn', direction: 'desc' } })).toBe(
      '?sort=occurredOn%2Cdesc',
    );
  });

  it('keeps page 0 and a zero amount bound, which falsiness would drop', () => {
    const query = buildExpenseQuery({ page: 0, minAmount: '0' });
    expect(query).toContain('page=0');
    // minAmount=0 excludes refunds; dropping it silently returns them and the
    // totals stop matching the report.
    expect(query).toContain('minAmount=0');
  });

  it('is empty when nothing is filtered', () => {
    expect(buildExpenseQuery()).toBe('');
  });
});

describe('reads', () => {
  it('calls the versioned base path', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json([]));
    await clientWith(fetchImpl).categories();

    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/api/v1/categories', expect.anything());
  });

  it('throws ApiError carrying field violations for a 400', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      problem(400, {
        detail: 'PHP is the only supported currency.',
        violations: [{ field: 'currency', message: 'PHP is the only supported currency.' }],
      }),
    );

    const error = await clientWith(fetchImpl)
      .expenses()
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    // Spec §8: surfaced inline against the offending field, not in a toast.
    expect((error as ApiError).messageFor('currency')).toBe('PHP is the only supported currency.');
  });

  it('sends both report bounds together, since the server rejects one alone', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ buckets: [] }));
    await clientWith(fetchImpl).overTime({ from: '2026-01-01', to: '2026-02-01' }, 'MONTH');

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-02-01');
    expect(url).toContain('bucket=month');
  });
});

describe('writes', () => {
  it('rejects a sub-centavo amount before it reaches the network', async () => {
    const fetchImpl = jest.fn();
    // The API rejects this rather than rounding, so the client does too — a
    // rounded amount is money the user did not enter.
    await expect(
      clientWith(fetchImpl).createExpense({
        amount: '10.005',
        currency: 'PHP',
        occurredOn: '2026-08-01',
      }),
    ).rejects.toThrow(TypeError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the amount verbatim rather than reformatting it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ id: 'e1' }, 201));
    await clientWith(fetchImpl).createExpense({
      amount: '-1234.5',
      currency: 'PHP',
      occurredOn: '2026-08-01',
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    // Not "-1234.50": presentation rounding belongs at the display boundary,
    // and this is not one.
    expect(body.amount).toBe('-1234.5');
  });

  it('omits undefined fields from a PATCH rather than sending null', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ id: 'e1' }));
    await clientWith(fetchImpl).updateExpense('e1', { merchant: 'SM' });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body).toEqual({ merchant: 'SM' });
    expect('amount' in body).toBe(false);
  });

  it('returns nothing for a 204 rather than failing to parse an empty body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(clientWith(fetchImpl).deleteExpense('e1')).resolves.toBeUndefined();
  });
});

describe('auth', () => {
  it('stores both halves on login and sends the access token thereafter', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(TOKENS)).mockResolvedValueOnce(json([]));
    const store = memoryStore();
    const client = clientWith(fetchImpl, store);

    await client.login({ username: 'duane', password: 'hunter2' });
    await client.categories();

    expect(await store.read()).toBe('refresh-1');
    const headers = fetchImpl.mock.calls[1]![1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer access-1');
  });

  it('declares which storage mechanism this build uses', async () => {
    // Issue #57: the server decides cookie-or-body from this, and guessing it
    // fails silently in both directions — a web caller handed a body token it
    // must not keep, a device handed a cookie it cannot read.
    const fetchImpl = jest.fn().mockResolvedValue(json(TOKENS));
    await clientWith(fetchImpl).login({ username: 'duane', password: 'hunter2' });

    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toEqual({
      username: 'duane',
      password: 'hunter2',
      // Jest runs the native variant, so this build is a device one.
      client: 'device',
    });
  });

  it('lets the browser attach its cookie', async () => {
    // Without `credentials: include` a browser sends no cookie cross-origin, so
    // the refresh cookie the server set never comes back and a page refresh
    // signs the user out — the exact bug #57 exists to fix.
    const fetchImpl = jest.fn().mockResolvedValue(json(TOKENS));
    await clientWith(fetchImpl).login({ username: 'duane', password: 'hunter2' });

    expect(fetchImpl.mock.calls[0]![1].credentials).toBe('include');
  });

  it('refreshes from the cookie, with the header, when it holds no token', async () => {
    // The web path. An empty store is the normal state there rather than a
    // signed-out one, because the token is in a cookie no script can read.
    const fetchImpl = jest.fn().mockResolvedValue(json(TOKENS));
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(memoryStore(null)),
      clientType: 'web',
    });

    await client.refresh();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({});
    // Presence is the CSRF defence: a cross-site request cannot set a header,
    // and a cross-origin fetch that does gets preflighted.
    expect(new Headers(init.headers).get('X-Refresh-Source')).toBe('cookie');
  });

  it('sends a stored token in the body, without the cookie header', async () => {
    // The device path is unchanged: the token is in a body an attacker's page
    // cannot construct, so there is no CSRF to defend against and no header.
    const fetchImpl = jest.fn().mockResolvedValue(json(TOKENS));
    const client = clientWith(fetchImpl, memoryStore('refresh-0'));

    await client.refresh();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-0' });
    expect(new Headers(init.headers).get('X-Refresh-Source')).toBeNull();
  });

  it('adopts a web login that carries no refresh token', async () => {
    // The server omits it for a web client and puts it in the cookie instead.
    // Treating the absence as a failure would break sign-in on web entirely.
    const fetchImpl = jest.fn().mockResolvedValue(json(WEB_TOKENS));
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(memoryStore(null)),
      clientType: 'web',
    });

    const result = await client.login({ username: 'duane', password: 'hunter2' });

    expect(result.persisted).toBe(true);
  });

  it('tells a device build its session will not outlive the access token', async () => {
    // A device that somehow receives a web-shaped response persisted nothing,
    // and `persisted` is the signal a sign-in screen uses to say so. Reporting
    // true there is the opposite of the truth: the session ends in fifteen
    // minutes with no warning.
    const fetchImpl = jest.fn().mockResolvedValue(json(WEB_TOKENS));
    const client = clientWith(fetchImpl, memoryStore(null));

    const result = await client.login({ username: 'duane', password: 'hunter2' });

    expect(result.persisted).toBe(false);
  });

  it('recovers a web session from the cookie on the next request', async () => {
    // Drives `categories()`, not `refresh()`. Both refresh paths in `request()`
    // sit behind `Session.isResumable()`, which is `Boolean(store.read())` —
    // and the web store is empty by design since the token became a cookie. So
    // testing `refresh()` directly passes while the app never refreshes at all,
    // which is the page-reload sign-out this whole change exists to fix.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockResolvedValueOnce(json([]));
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(webStore),
      clientType: 'web',
    });

    await client.categories();

    expect(fetchImpl.mock.calls.map((call) => call[0])).toContain(
      'http://api.test/api/v1/auth/refresh',
    );
  });

  it('treats a 400 from the cookie refresh as signed out, not as a broken request', async () => {
    // The server answers 400 when no cookie arrived, which on web means exactly
    // "you are signed out". Only 401 cleared the session, so a genuinely
    // signed-out web user got a request error on screen instead.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockResolvedValue(
        problem(400, {
          // The type is what the client matches on, so the mock has to carry
          // it. Without it this test passed against every version of the code,
          // including one with the feature deleted.
          type: 'https://expense-calc.invalid/problems/no-refresh-token',
          title: 'No refresh token',
        }),
      );
    const session = new Session(webStore);
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session,
      clientType: 'web',
    });

    // Signed in first, so there is something to clear — otherwise the assertion
    // cannot tell "cleared" from "never set".
    await client.login({ username: 'duane', password: 'hunter2' });
    expect(session.currentAccessToken()).not.toBeNull();

    await expect(client.refresh()).rejects.toBeInstanceOf(ApiError);

    // Session cleared, so the next request presents no credential and gets a
    // clean refusal rather than replaying a state the server has rejected.
    expect(session.currentAccessToken()).toBeNull();
  });

  it('stays signed out on web when the logout call itself fails', async () => {
    // The regression the cookie introduced. `logout()` clears local state even
    // when the request fails — but on web only the server can remove the
    // cookie, so without a signed-out flag the very next request refreshes from
    // a still-live cookie and silently signs the user back in, moments after a
    // screen told them they were out.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(json([]));
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(webStore),
      clientType: 'web',
    });

    await client.login({ username: 'duane', password: 'hunter2' });
    await client.logout();

    await client.categories();

    expect(fetchImpl.mock.calls.map((call) => call[0])).not.toContain(
      'http://api.test/api/v1/auth/refresh',
    );
  });

  it('signs back in normally after a failed logout', async () => {
    // The flag must not be a one-way door: logging in again clears it.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(json(WEB_TOKENS));
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(webStore),
      clientType: 'web',
    });

    await client.logout();
    await client.login({ username: 'duane', password: 'hunter2' });

    fetchImpl.mockResolvedValue(json([]));
    await expect(client.categories()).resolves.toBeDefined();
  });

  it('never sends a body token from a web build', async () => {
    // Structural, not incidental. The server reads a body token as "device", so
    // a web build that sent one would get its refresh token back in a response
    // body a script can read — the one thing httpOnly exists to prevent.
    const stockedStore: RefreshTokenStore = {
      read: () => Promise.resolve('should-never-be-sent'),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest.fn().mockResolvedValue(json(WEB_TOKENS));
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(stockedStore),
      clientType: 'web',
    });

    await client.refresh();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({});
    expect(new Headers(init.headers).get('X-Refresh-Source')).toBe('cookie');
  });

  it('does not treat an unrelated 400 as a signed-out session', async () => {
    // Only the server's own "no refresh token" problem means signed out. A 400
    // from a proxy would otherwise drop the user at a sign-in screen for a
    // reason that has nothing to do with their session.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockResolvedValue(problem(400, { title: 'Gateway rejected the request' }));
    const session = new Session(webStore);
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session,
      clientType: 'web',
    });

    await client.login({ username: 'duane', password: 'hunter2' });
    await expect(client.refresh()).rejects.toBeInstanceOf(ApiError);

    expect(session.currentAccessToken()).not.toBeNull();
  });

  it('drops a refresh that lands after a sign-out', async () => {
    // The race the flag alone does not close: a request 401s and passes the
    // resume check, the user signs out and the logout fails, then the refresh
    // response arrives. Adopting it would sign them back in through timing.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    let releaseRefresh: (value: Response) => void = () => {};
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      if (url.endsWith('/auth/logout')) {
        return Promise.reject(new TypeError('network down'));
      }
      return Promise.resolve(json(WEB_TOKENS));
    });
    const session = new Session(webStore);
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session,
      clientType: 'web',
    });

    // Signed in first, so `logout()`'s own request does not itself wait on the
    // refresh being held open below.
    await client.login({ username: 'duane', password: 'hunter2' });

    const inFlight = client.refresh();
    await client.logout();
    releaseRefresh(json(WEB_TOKENS));

    await expect(inFlight).rejects.toBeInstanceOf(ApiError);
    expect(session.currentAccessToken()).toBeNull();
  });

  it('reports an already-revoked session as signed out, not as unconfirmed', async () => {
    // Signing out on another device revokes every refresh token, so this
    // logout refreshes first, gets a 401, and the server's response clears the
    // cookie on the way past. Reporting that as unconfirmed would tell the user
    // to retry a sign-out that has already completely happened.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(problem(401, { title: 'Session expired' }));
      }
      return Promise.resolve(json(WEB_TOKENS));
    });
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(webStore),
      clientType: 'web',
    });

    const outcome = await client.logout();

    expect(outcome).not.toBeNull();
    expect(outcome!.revokedSessions).toBe(0);
  });

  it('still reports an unreachable server as unconfirmed', async () => {
    // The case the null is reserved for: nothing was confirmed, and on web the
    // cookie may still be live.
    const webStore: RefreshTokenStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockRejectedValue(new TypeError('network down'));
    const client = new ExpenseCalcClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: new Session(webStore),
      clientType: 'web',
    });

    await client.login({ username: 'duane', password: 'hunter2' });

    expect(await client.logout()).toBeNull();
  });

  it('does not attach a token to login itself', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(TOKENS));
    await clientWith(fetchImpl).login({ username: 'duane', password: 'hunter2' });

    const headers = fetchImpl.mock.calls[0]![1].headers as Headers;
    expect(headers.has('Authorization')).toBe(false);
  });

  it('refreshes before the request when the token is missing but resumable', async () => {
    // `expiresInSeconds` is returned so a client can refresh ahead of a failure
    // rather than after one, so a resumable session with no access token in
    // memory — a cold start on a device — exchanges first and never spends a
    // request on a 401 it could have predicted.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(TOKENS))
      .mockResolvedValueOnce(json([]));

    const client = clientWith(fetchImpl, memoryStore('refresh-0'));
    await expect(client.categories()).resolves.toEqual([]);

    expect(fetchImpl.mock.calls[0]![0]).toBe('http://api.test/api/v1/auth/refresh');
    expect(fetchImpl.mock.calls[1]![0]).toBe('http://api.test/api/v1/categories');
  });

  it('refreshes once on a 401 and retries the original request', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(problem(401))
      .mockResolvedValueOnce(json({ ...TOKENS, accessToken: 'access-2' }))
      .mockResolvedValueOnce(json([]));

    const client = clientWith(fetchImpl, memoryStore('refresh-0'));
    // A live access token, so this exercises the reactive path rather than the
    // proactive one above.
    await client.session.adopt(TOKENS);

    await expect(client.categories()).resolves.toEqual([]);

    expect(fetchImpl.mock.calls[1]![0]).toBe('http://api.test/api/v1/auth/refresh');
    const retried = fetchImpl.mock.calls[2]![1].headers as Headers;
    expect(retried.get('Authorization')).toBe('Bearer access-2');
  });

  it('gives up after one refresh rather than looping on a persistent 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(problem(401))
      .mockResolvedValueOnce(json(TOKENS))
      .mockResolvedValueOnce(problem(401));

    const client = clientWith(fetchImpl, memoryStore('refresh-0'));
    await client.session.adopt(TOKENS);

    await expect(client.categories()).rejects.toBeInstanceOf(ApiError);

    // Three calls, not an unbounded retry loop against the server.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('collapses concurrent refreshes into one exchange', async () => {
    // Rotation makes this correctness, not efficiency: each exchange kills the
    // previous refresh token, so three parallel refreshes would sign the user
    // out with tokens their own app invalidated.
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(json(TOKENS));
      }
      return Promise.resolve(json([]));
    });

    const client = clientWith(fetchImpl, memoryStore('refresh-0'));
    await Promise.all([client.categories(), client.expenses(), client.categories()]);

    const refreshes = fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });

  it('clears the session when the refresh token is rejected', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(problem(401)).mockResolvedValueOnce(problem(401));
    const store = memoryStore('refresh-dead');
    const client = clientWith(fetchImpl, store);

    await expect(client.categories()).rejects.toBeInstanceOf(ApiError);

    // A rotated-away token is not recoverable; replaying it forever is worse
    // than presenting no credential at all.
    expect(await store.read()).toBeNull();
  });

  it('clears local state on logout even when the call fails', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));
    const store = memoryStore('refresh-1');
    const client = clientWith(fetchImpl, store);

    await expect(client.logout()).resolves.toBeNull();
    expect(await store.read()).toBeNull();
    expect(client.session.currentAccessToken()).toBeNull();
  });

  it('serves the request on a live token when the proactive refresh fails', async () => {
    // The proactive refresh runs in the last 30 seconds of a token that still
    // works. A 503 there used to fail every request on the screen while a
    // perfectly good token sat in memory.
    let now = 1_000_000;
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(problem(503))
      .mockResolvedValueOnce(json([]));

    const client = clientWith(fetchImpl, memoryStore('refresh-0'), () => now);
    await client.session.adopt(TOKENS);
    now += 900_000 - 10_000; // inside the skew, token still valid

    await expect(client.categories()).resolves.toEqual([]);

    const attempted = fetchImpl.mock.calls[1]![1].headers as Headers;
    expect(attempted.get('Authorization')).toBe('Bearer access-1');
  });

  it('propagates a failed refresh when there is no token to fall back on', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(problem(503));
    const client = clientWith(fetchImpl, memoryStore('refresh-0'));

    // Cold start: nothing in memory, so there is no stale-but-live fallback.
    await expect(client.categories()).rejects.toBeInstanceOf(ApiError);
  });

  it('does not rotate twice when two requests 401 in sequence', async () => {
    // The single-flight guard only covers refreshes that overlap. Two requests
    // failing one after the other on the same dead token do not overlap, and
    // each late 401 used to burn another rotation.
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        return Promise.resolve(json({ ...TOKENS, accessToken: 'access-2' }));
      }
      const headers = fetchImpl.mock.calls.at(-1)![1].headers as Headers;
      return Promise.resolve(
        headers.get('Authorization') === 'Bearer access-2' ? json([]) : problem(401),
      );
    });

    const client = clientWith(fetchImpl, memoryStore('refresh-0'));
    await client.session.adopt(TOKENS);

    await client.categories();
    await client.expenses();

    const refreshes = fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });

  it('routes the public refresh through the single-flight guard', async () => {
    // `refresh()` used to be the unguarded exchange while the guard was
    // private, so a screen calling it directly raced any in-flight refresh —
    // the exact rotation collision the guard exists to prevent.
    const fetchImpl = jest.fn().mockResolvedValue(json(TOKENS));
    const client = clientWith(fetchImpl, memoryStore('refresh-0'));

    await Promise.all([client.refresh(), client.refresh(), client.refresh()]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports that a session was not persisted', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(TOKENS));
    const store: RefreshTokenStore = {
      ...memoryStore(),
      write: () => Promise.reject(new RefreshTokenUnavailableError()),
    };

    // A device with no secure lock screen: the session works until the access
    // token expires and then ends silently. Sign-in succeeds and says so.
    await expect(clientWith(fetchImpl, store).login({ username: 'd', password: 'p' })).resolves.toEqual(
      { persisted: false },
    );
  });
});

describe('filter validation', () => {
  it('rejects a sub-centavo filter bound before the request', async () => {
    // The server runs these through the same Money.toMinorUnits as a write
    // amount, so the same typo deserves the same field error.
    const fetchImpl = jest.fn();
    await expect(clientWith(fetchImpl).expenses({ minAmount: '10.005' })).rejects.toThrow(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('base URL', () => {
  const original = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = original;
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  });

  it('refuses a cleartext API URL in a release build', () => {
    // One missing character in a CI variable would send the password and the
    // refresh token over the wire in the clear, with nothing to say so.
    process.env.EXPO_PUBLIC_API_URL = 'http://api.example.com';
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    expect(() => new ExpenseCalcClient()).toThrow(/https/);
  });

  it('allows http in development, where the backend is local', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8080';
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;

    expect(() => new ExpenseCalcClient()).not.toThrow();
  });
});
