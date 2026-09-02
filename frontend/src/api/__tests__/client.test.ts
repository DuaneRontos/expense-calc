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

/**
 * The web store, which deliberately holds nothing.
 *
 * **Not `memoryStore(null)`.** `write` here is a no-op, matching
 * `refreshTokenStore.web.ts` — the browser holds the token in an `httpOnly`
 * cookie and a script cannot put anything there. That difference is
 * load-bearing: the test that a web build never sends a body token stocks a
 * store with a value to prove the client ignores it, which only means something
 * if a web store's contents are irrelevant by construction.
 */
function webStore(read: string | null = null): RefreshTokenStore {
  return {
    read: () => Promise.resolve(read),
    write: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  };
}

/**
 * A web-target client. Takes a `Session` rather than a store, because several
 * tests assert on the session afterwards and need to hold the same instance.
 */
function webClient(fetchImpl: jest.Mock, session: Session = new Session(webStore())) {
  return new ExpenseCalcClient({
    baseUrl: 'http://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    session,
    clientType: 'web',
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
    const client = webClient(fetchImpl);

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
    const client = webClient(fetchImpl);

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
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockResolvedValueOnce(json([]));
    const client = webClient(fetchImpl);

    await client.categories();

    expect(fetchImpl.mock.calls.map((call) => call[0])).toContain(
      'http://api.test/api/v1/auth/refresh',
    );
  });

  it('treats a 400 from the cookie refresh as signed out, not as a broken request', async () => {
    // The server answers 400 when no cookie arrived, which on web means exactly
    // "you are signed out". Only 401 cleared the session, so a genuinely
    // signed-out web user got a request error on screen instead.
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
    const session = new Session(webStore());
    const client = webClient(fetchImpl, session);

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
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(json([]));
    const client = webClient(fetchImpl);

    await client.login({ username: 'duane', password: 'hunter2' });
    await client.logout();

    await client.categories();

    expect(fetchImpl.mock.calls.map((call) => call[0])).not.toContain(
      'http://api.test/api/v1/auth/refresh',
    );
  });

  it('signs back in normally after a failed logout', async () => {
    // The flag must not be a one-way door: logging in again clears it.
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(json(WEB_TOKENS));
    const client = webClient(fetchImpl);

    await client.logout();
    await client.login({ username: 'duane', password: 'hunter2' });

    fetchImpl.mockResolvedValue(json([]));
    await expect(client.categories()).resolves.toBeDefined();
  });

  it('never sends a body token from a web build', async () => {
    // Structural, not incidental. The server reads a body token as "device", so
    // a web build that sent one would get its refresh token back in a response
    // body a script can read — the one thing httpOnly exists to prevent.
    const fetchImpl = jest.fn().mockResolvedValue(json(WEB_TOKENS));
    const client = webClient(fetchImpl, new Session(webStore('should-never-be-sent')));

    await client.refresh();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({});
    expect(new Headers(init.headers).get('X-Refresh-Source')).toBe('cookie');
  });

  it('does not treat an unrelated 400 as a signed-out session', async () => {
    // Only the server's own "no refresh token" problem means signed out. A 400
    // from a proxy would otherwise drop the user at a sign-in screen for a
    // reason that has nothing to do with their session.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockResolvedValue(problem(400, { title: 'Gateway rejected the request' }));
    const session = new Session(webStore());
    const client = webClient(fetchImpl, session);

    await client.login({ username: 'duane', password: 'hunter2' });
    await expect(client.refresh()).rejects.toBeInstanceOf(ApiError);

    expect(session.currentAccessToken()).not.toBeNull();
  });

  it('loads on a cold web start, where no cookie means no session yet', async () => {
    // The reported bug. A browser that has never signed in sends no cookie, so
    // the cold-start refresh answers 400 `no-refresh-token` — and with nothing
    // in memory to fall back on, that rejection reached the screen. Every
    // request on the Overview failed before one was even attempted.
    //
    // On a device the identical state is an empty store: `canResume()` says no,
    // no refresh is attempted, and the request goes out unauthenticated. Web is
    // the only target where "no session yet" was a failure rather than a state,
    // and it is the same fact discovered by asking instead of by reading.
    const fetchImpl = jest.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('/auth/refresh')
          ? problem(400, {
              type: 'https://expense-calc.invalid/problems/no-refresh-token',
              title: 'No refresh token',
            })
          : json([]),
      ),
    );
    const client = webClient(fetchImpl);

    await expect(client.categories()).resolves.toEqual([]);

    // Anchored on the call actually reaching `/categories`, so the assertion
    // below cannot pass against a client that never sent one.
    const attempt = fetchImpl.mock.calls.find((call) =>
      String(call[0]).endsWith('/categories'),
    );
    expect(attempt).toBeDefined();
    expect(new Headers(attempt![1].headers).get('Authorization')).toBeNull();
  });

  it('stops asking for a refresh once the server says the browser holds no cookie', async () => {
    // `canResume()` on web is "assume yes, and let /auth/refresh be the thing
    // that says otherwise". It asked and then ignored the answer: every request
    // for the life of the page re-ran the same doomed exchange, so a screen
    // firing three reads on mount spent three round trips learning the same
    // thing it had already been told.
    const fetchImpl = jest.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('/auth/refresh')
          ? problem(400, {
              type: 'https://expense-calc.invalid/problems/no-refresh-token',
              title: 'No refresh token',
            })
          : json([]),
      ),
    );
    const client = webClient(fetchImpl);

    await client.categories();
    await client.categories();

    const refreshes = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).endsWith('/auth/refresh'),
    );
    expect(refreshes).toHaveLength(1);
  });

  it('refreshes again after a sign-in, since the browser now holds a cookie', async () => {
    // The counterpart to the test above, and the reason the flag is lifted by
    // `login()` rather than left latched. Without this, a user who signed in
    // after a cold start would hold an access token that could never be
    // renewed, and the session would end silently in fifteen minutes.
    let signedIn = false;
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      const target = String(url);
      if (target.endsWith('/auth/login')) {
        signedIn = true;
        return Promise.resolve(json(WEB_TOKENS));
      }
      if (target.endsWith('/auth/refresh')) {
        return Promise.resolve(
          signedIn
            ? json(WEB_TOKENS)
            : problem(400, {
                type: 'https://expense-calc.invalid/problems/no-refresh-token',
                title: 'No refresh token',
              }),
        );
      }
      return Promise.resolve(json([]));
    });
    // A clock the test advances, so the post-login request needs a refresh
    // rather than reusing the token `login()` just put in memory.
    let now = 1_000_000;
    const client = webClient(fetchImpl, new Session(webStore(), () => now));

    await client.categories(); // cold start: learns there is no cookie
    await client.login({ username: 'dev', password: 'dev' });
    now += 900_000; // the access token from login has expired

    await expect(client.categories()).resolves.toEqual([]);

    const refreshes = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).endsWith('/auth/refresh'),
    );
    expect(refreshes).toHaveLength(2);
  });

  it('still fails a cold web start when the refresh breaks rather than refuses', async () => {
    // The line the fix must not cross. A 503 from `/auth/refresh` says nothing
    // about whether a cookie exists — the request never reached the code that
    // can see one. Swallowing that too would show an empty Overview to a signed
    // -in user whose session was fine and whose auth service was down.
    //
    // **Only `/auth/refresh` fails here, and that is the whole assertion.**
    // Failing every URL instead made this pass against a client that swallowed
    // the refusal and then simply hit the same 503 on `/categories` — a reject
    // either way, and no way to tell which one it was. Serving `/categories`
    // leaves the propagated refresh as the only thing that can reject.
    const fetchImpl = jest.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).endsWith('/auth/refresh') ? problem(503) : json([])),
    );
    const client = webClient(fetchImpl);

    await expect(client.categories()).rejects.toBeInstanceOf(ApiError);
  });

  it('hands fetch a RequestInit, not the options this client reads itself', async () => {
    // `anonymous` was destructured out and its sibling was not, so
    // `requiresCredential` was spread into the init object. Browsers ignore an
    // unknown member, which is exactly why nothing caught it — but every test in
    // this file asserts on the injected `fetch`, so the leak is visible to the
    // one observer that matters here.
    //
    // **Signed in first, and asserted on the `/auth/logout` call specifically.**
    // Reading `calls[0]` instead caught the refresh, which never carries the
    // flag — so the assertion held whether or not the option leaked.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockResolvedValueOnce(json({ revokedSessions: 1 }));
    const client = webClient(fetchImpl);

    await client.login({ username: 'dev', password: 'dev' });
    await client.logout();

    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).endsWith('/auth/logout'));
    expect(call).toBeDefined();
    expect(Object.keys(call![1])).toContain('method');
    expect(Object.keys(call![1])).not.toContain('requiresCredential');
    expect(Object.keys(call![1])).not.toContain('anonymous');
  });

  it('answers a sign-out the same way whether or not a screen loaded first', async () => {
    // `requiresCredential` was only consulted inside the proactive refresh's
    // catch. Once `noSessionToResume` latches, `canResume()` says no, that whole
    // block is skipped, and the flag is never read — so the round trip it exists
    // to avoid went out anyway.
    //
    // What comes back is Spring Security's bodyless 401, from the filter chain
    // rather than from `AuthProblemHandler`, so it carries no problem type.
    // `holdsNoLiveCredential` matches neither branch and `logout()` returns
    // `null` — "we could not sign you out, try again" — for a browser that is
    // definitively signed out. The same fact, two opposite sentences, decided by
    // whether a screen happened to mount first.
    const refused = problem(400, {
      type: 'https://expense-calc.invalid/problems/no-refresh-token',
      title: 'No refresh token',
    });
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      const target = String(url);
      if (target.endsWith('/auth/refresh')) {
        return Promise.resolve(refused);
      }
      if (target.endsWith('/auth/logout')) {
        // Bodyless, as the entry point sends it — no problem document.
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return Promise.resolve(json([]));
    });
    const client = webClient(fetchImpl);

    // The cold start that latches. Nothing about it concerns signing out.
    await client.categories();

    const outcome = await client.logout();

    expect(outcome).not.toBeNull();
    expect(outcome!.revokedSessions).toBe(0);
    // And nothing was sent: an unauthenticated `/auth/logout` revokes nothing,
    // so the only thing the round trip can do is replace a specific answer this
    // client already holds with a generic refusal.
    expect(
      fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith('/auth/logout')),
    ).toHaveLength(0);
  });

  it('resumes a web session at startup, before any screen has asked for data', async () => {
    // **The route guard's precondition (#92).** The refresh has only ever run as
    // a side effect of the first data request. A guard that redirects before any
    // request goes out would therefore never trigger it, and every returning
    // user with a live cookie would be bounced to sign-in — the client having
    // never asked the one participant that can see the cookie.
    const fetchImpl = jest.fn().mockResolvedValue(json(WEB_TOKENS));
    const session = new Session(webStore());
    const client = webClient(fetchImpl, session);

    await expect(client.resume()).resolves.toBe(true);

    expect(session.isSignedIn()).toBe(true);
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toContain(
      'http://api.test/api/v1/auth/refresh',
    );
  });

  it('reports no session when the browser turns out to hold no cookie', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      problem(400, {
        type: 'https://expense-calc.invalid/problems/no-refresh-token',
        title: 'No refresh token',
      }),
    );
    const client = webClient(fetchImpl);

    // Resolved false rather than rejected: "you are signed out" is an answer, and
    // a guard should not have to tell a refusal apart from a transport failure
    // by catching.
    await expect(client.resume()).resolves.toBe(false);
  });

  it('does not ask twice once the server has said there is no cookie', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      problem(400, {
        type: 'https://expense-calc.invalid/problems/no-refresh-token',
        title: 'No refresh token',
      }),
    );
    const client = webClient(fetchImpl);

    await client.resume();
    await client.resume();

    expect(
      fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')),
    ).toHaveLength(1);
  });

  it('answers a device with an empty store without a request', async () => {
    // The native half of spec §9.2's table is readable, so there is nothing to
    // ask: an empty SecureStore already is the answer.
    const fetchImpl = jest.fn();
    const client = clientWith(fetchImpl, memoryStore(null));

    await expect(client.resume()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers from memory when a session is already live', async () => {
    const fetchImpl = jest.fn();
    const client = clientWith(fetchImpl, memoryStore('refresh-0'));
    await client.session.adopt(TOKENS);

    await expect(client.resume()).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports no session when the refresh fails for a reason that is not an answer', async () => {
    // A 503 says nothing about whether a credential exists. The guard still has
    // to decide something, and "not signed in" is the safe side — but the
    // session must not be reported as live on the strength of a failed ask.
    const fetchImpl = jest.fn().mockResolvedValue(problem(503));
    const client = webClient(fetchImpl);

    await expect(client.resume()).resolves.toBe(false);
  });

  it('gives up on a refresh that never answers, rather than waiting forever', async () => {
    // **The guard changed the blast radius of a hang.** Before it, a stalled
    // `/auth/refresh` cost one screen, which had #87's failure card and a retry.
    // Now the guard holds a spinner over the whole app until this settles — so a
    // proxy that accepts the connection and never replies is an app that never
    // renders. Connection-refused was already covered; a hang was not.
    let hung = false;
    const fetchImpl = jest.fn().mockImplementation(() => {
      hung = true;
      return new Promise<Response>(() => {});
    });
    const client = webClient(fetchImpl);

    // Fake timers, or this test waits out the real budget — ten seconds for one
    // assertion, on a suite that has already been bitten by a timeout flake.
    jest.useFakeTimers();
    try {
      const resumed = client.resume();
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(resumed).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }

    // The request did go out: this is a budget on the answer, not a refusal to ask.
    expect(hung).toBe(true);
  });

  it('reports no session when the store itself throws', async () => {
    // `resume()` promises to resolve rather than reject, but `canResume()` sat
    // outside the try — and on a device that reaches the injectable store. The
    // shipped stores swallow their own errors, so this is a contract gap rather
    // than a live bug; it is worth closing because the cost of a rejection here
    // is now the whole app rather than one screen.
    const exploding: RefreshTokenStore = {
      read: () => Promise.reject(new Error('Keychain unavailable')),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const client = clientWith(jest.fn(), exploding);

    await expect(client.resume()).resolves.toBe(false);
  });

  it('drops a refresh that lands after a sign-out', async () => {
    // The race the flag alone does not close: a request 401s and passes the
    // resume check, the user signs out and the logout fails, then the refresh
    // response arrives. Adopting it would sign them back in through timing.
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
    const session = new Session(webStore());
    const client = webClient(fetchImpl, session);

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
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          problem(401, {
            // The type this API actually sends. A bare 401 is not proof — see
            // the middlebox test below.
            type: 'https://expense-calc.invalid/problems/unauthenticated',
            title: 'Session expired',
          }),
        );
      }
      return Promise.resolve(json(WEB_TOKENS));
    });
    const client = webClient(fetchImpl);

    const outcome = await client.logout();

    expect(outcome).not.toBeNull();
    expect(outcome!.revokedSessions).toBe(0);
  });

  it('still reports an unreachable server as unconfirmed', async () => {
    // The case the null is reserved for: nothing was confirmed, and on web the
    // cookie may still be live.
    //
    // A guard against a future over-broad branch rather than evidence for the
    // current one — the previous code returned null here too, so reverting the
    // fix cannot make this fail. Kept deliberately, and labelled so it is not
    // mistaken for proof.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockRejectedValue(new TypeError('network down'));
    const client = webClient(fetchImpl);

    await client.login({ username: 'duane', password: 'hunter2' });

    expect(await client.logout()).toBeNull();
  });

  /**
   * The `null` a caller has to act on, remembered rather than only returned
   * (#142).
   *
   * `logout()`'s own doc says a caller must surface the `null` rather than show
   * a plain signed-out screen, because on web the refresh cookie may still be
   * live and a reload builds a fresh client that signs the user back in. It was
   * returned and dropped. Recording it here rather than at the one call site
   * makes every caller right, which is what the contract actually asks for.
   */
  it('remembers that a sign-out was never confirmed', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockRejectedValue(new TypeError('network down'));
    const client = webClient(fetchImpl);

    await client.login({ username: 'duane', password: 'hunter2' });
    expect(client.signOutWasUnconfirmed()).toBe(false);

    expect(await client.logout()).toBeNull();
    expect(client.signOutWasUnconfirmed()).toBe(true);
  });

  /**
   * A plain HTTP success is a confirmation, and must not raise it.
   *
   * Only that one: the `revokedSessions: 0` already-gone branch is a different
   * path through `logout()` and has its own test below. This docblock used to
   * describe both while the body drove only this one, which is how that branch
   * went unpinned — the same mistake, one level up, as a test asserting less
   * than its name claims.
   */
  it('does not claim a confirmed sign-out was unconfirmed', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockResolvedValue(json({ revokedSessions: 2, note: 'Signed out everywhere.' }));
    const client = webClient(fetchImpl);

    await client.login({ username: 'duane', password: 'hunter2' });
    await client.logout();

    expect(client.signOutWasUnconfirmed()).toBe(false);
  });

  /**
   * **The already-gone branch, which the test above does not reach.**
   *
   * That one drives a plain HTTP success, so the `catch` never runs and nothing
   * asserted what the flag is after a *failure* the client could narrow. The
   * gap was invisible: setting the flag as the first line of the `catch`, above
   * `holdsNoLiveCredential`, left the whole suite green while telling a user whose
   * credential the server had already rejected to worry about a session that is
   * definitively gone — the inversion `logout()`'s doc is emphatic about.
   */
  it('does not raise the warning when the credential was already gone', async () => {
    // The same shape as `reports an expired cookie as signed out`: the refresh
    // that `logout()` runs first comes back saying there is no cookie, which is
    // this client's credential being already gone.
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          problem(400, {
            type: 'https://expense-calc.invalid/problems/no-refresh-token',
            title: 'No refresh token',
          }),
        );
      }
      return Promise.resolve(json(WEB_TOKENS));
    });
    const client = webClient(fetchImpl);

    const outcome = await client.logout();

    // **The shape, not just non-null.** `not.toBeNull()` and a false flag are
    // both satisfied by the plain-success path — the mock falls back to
    // `json(WEB_TOKENS)` for `/auth/logout` — so this test could drift out of
    // the branch it is named after without saying so. Asserting the note is
    // what proves the `catch` ran and took the already-gone branch.
    expect(outcome).toEqual({
      revokedSessions: 0,
      note: expect.stringContaining('already gone'),
    });
    expect(client.signOutWasUnconfirmed()).toBe(false);
  });

  /**
   * **Never raised off web**, because the sentence it raises is about a cookie
   * a device does not have.
   *
   * `logout()`'s `finally` calls `session.clear()`, which empties the persisted
   * store on a device — so nothing is left to resume with. A phone with no
   * signal was being told a browser it does not have might sign back in without
   * a password: false, and not actionable. Every other test here is a
   * `webClient`, which is exactly why nothing caught it.
   */
  it('does not warn about a browser on a device', async () => {
    // `clientWith` is the device shape: the default `clientType` and a store
    // that really holds the refresh token, unlike `webClient`'s.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(TOKENS))
      .mockRejectedValue(new TypeError('network down'));
    const client = clientWith(fetchImpl);

    await client.login({ username: 'duane', password: 'hunter2' });

    // Same failure as the web case: the request never reached the server.
    expect(await client.logout()).toBeNull();
    expect(client.signOutWasUnconfirmed()).toBe(false);
  });

  /**
   * A retry that works clears the verdict of the one that did not.
   *
   * `login()` is not the only way out of the flag: `logout()` is public and a
   * second call can succeed where the first failed. Without a reset on entry
   * the client would keep reporting the stale failure, and the sign-in screen
   * would warn about a cookie that has since been revoked — the false direction,
   * since it tells someone to worry about a session that is actually gone.
   */
  it('drops the verdict when a later sign-out succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(json({ revokedSessions: 1, note: 'Signed out everywhere.' }));
    const client = webClient(fetchImpl);

    await client.login({ username: 'duane', password: 'hunter2' });
    expect(await client.logout()).toBeNull();
    expect(client.signOutWasUnconfirmed()).toBe(true);

    // No sign-in between the two, so `login()`'s reset cannot be what clears it.
    await client.logout();

    expect(client.signOutWasUnconfirmed()).toBe(false);
  });

  /**
   * Cleared by `login()`, like `signedOut` and `noSessionToResume`.
   *
   * Signing in is the thing that makes the warning moot: whatever cookie was
   * left live, there is a session now and this client is using it.
   */
  it('stops reporting an unconfirmed sign-out once signed in again', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(WEB_TOKENS))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(json(WEB_TOKENS));
    const client = webClient(fetchImpl);

    await client.login({ username: 'duane', password: 'hunter2' });
    await client.logout();
    expect(client.signOutWasUnconfirmed()).toBe(true);

    await client.login({ username: 'duane', password: 'hunter2' });

    expect(client.signOutWasUnconfirmed()).toBe(false);
  });

  it('reports an expired cookie as signed out, not as a failed sign-out', async () => {
    // The second operand of the web claim, and the only claim-deciding operand
    // in the file that nothing asserted. Delete `|| isMissingWebCookie(error)`
    // and every test still passes while a user whose cookie simply expired is
    // told "we could not sign you out, try again" — the exact symptom the
    // narrowing two commits ago existed to remove.
    //
    // It is also the operand a reader is most likely to think redundant, since
    // a 400 reading as a sign-out looks like the thing that was narrowed away.
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          problem(400, {
            type: 'https://expense-calc.invalid/problems/no-refresh-token',
            title: 'No refresh token',
          }),
        );
      }
      return Promise.resolve(json(WEB_TOKENS));
    });
    const client = webClient(fetchImpl);

    const outcome = await client.logout();

    expect(outcome).not.toBeNull();
    expect(outcome!.revokedSessions).toBe(0);
  });

  it('does not read a middlebox 401 as a completed sign-out', async () => {
    // A proxy or WAF answering /auth/refresh with a bodyless 401 never reached
    // the API: nothing was revoked, no clearing Set-Cookie was sent, and the
    // cookie is live for the rest of its 30 days. Claiming a completed sign-out
    // there is the same defect as reading any 400 as "signed out" — the one
    // that was narrowed away one commit earlier.
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        // No problem document at all, as an HTML error page would give.
        return Promise.resolve(new Response('<html>denied</html>', { status: 401 }));
      }
      return Promise.resolve(json(WEB_TOKENS));
    });
    const client = webClient(fetchImpl);

    expect(await client.logout()).toBeNull();
  });

  it('reports a device with nothing stored as signed out', async () => {
    // No cookie exists on device, so the only credential is the stored token —
    // an empty store means there was never anything this client could revoke,
    // and a bodyless 401 from the security filter is the expected answer.
    //
    // A regression guard, not evidence: the earlier bare-status branch answered
    // this the same way, so reverting cannot make it fail. Labelled so it is
    // not mistaken for proof of the device narrowing.
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 401 }));
    const client = clientWith(fetchImpl, memoryStore(null));

    const outcome = await client.logout();

    expect(outcome).not.toBeNull();
    expect(outcome!.revokedSessions).toBe(0);
  });

  it('does not read a server error on a device as a completed sign-out', async () => {
    // The evidence for the device narrowing. A phone with no secure lock screen
    // signs in with `persisted: false`, so the store is empty — and a 500 on
    // logout has nothing to do with its credential being gone. Reporting a
    // completed sign-out there tells the user every other session was already
    // dealt with while the server never processed the request.
    const fetchImpl = jest.fn().mockResolvedValue(problem(500, { title: 'Internal Server Error' }));
    const client = clientWith(fetchImpl, memoryStore(null));

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
