import { Session } from '../session';
import { RefreshTokenUnavailableError, type RefreshTokenStore } from '../refreshTokenStore.types';

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

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresInSeconds: 900 };

describe('Session', () => {
  it('keeps the access token in memory and the refresh token in the store', async () => {
    // Spec §9.2: the access token is never written to storage on any target.
    const store = memoryStore();
    const session = new Session(store);

    await session.adopt(TOKENS);

    expect(session.currentAccessToken()).toBe('access-1');
    expect(await store.read()).toBe('refresh-1');
  });

  it('treats a token near expiry as needing refresh', () => {
    let now = 1_000_000;
    const session = new Session(memoryStore(), () => now);

    return session.adopt(TOKENS).then(() => {
      expect(session.needsRefresh()).toBe(false);

      // Inside the skew: a token with seconds left expires in flight on a slow
      // connection, and the resulting 401 looks like a real one.
      now += 900_000 - 15_000;
      expect(session.needsRefresh()).toBe(true);
    });
  });

  it('needs a refresh when there is no access token at all', () => {
    expect(new Session(memoryStore()).needsRefresh()).toBe(true);
  });

  it('is not resumable on a store that returns undefined', async () => {
    // A native module can hand back undefined rather than null. Testing
    // `!== null` read that as a live session and sent the client into a refresh
    // for a token it never had.
    const store = { ...memoryStore(), read: () => Promise.resolve(undefined as unknown as null) };
    expect(await new Session(store).isResumable()).toBe(false);
  });

  it('is not resumable on an empty string', async () => {
    expect(await new Session(memoryStore('')).isResumable()).toBe(false);
  });

  it('drops both halves on clear', async () => {
    const store = memoryStore();
    const session = new Session(store);
    await session.adopt(TOKENS);

    await session.clear();

    expect(session.currentAccessToken()).toBeNull();
    expect(await store.read()).toBeNull();
    expect(session.needsRefresh()).toBe(true);
  });

  it('reports persistence failure instead of half-building the session', async () => {
    // The write used to happen after the in-memory assignment and its exception
    // escaped, so login() rejected — "sign-in failed" on screen — while the
    // client held a working access token it would attach to the next request.
    const store: RefreshTokenStore = {
      ...memoryStore(),
      write: () => Promise.reject(new RefreshTokenUnavailableError()),
    };
    const session = new Session(store);

    await expect(session.adopt(TOKENS)).resolves.toEqual({ persisted: false });

    // The session is usable for this access token's life, and honest about it.
    expect(session.currentAccessToken()).toBe('access-1');
    expect(await session.isResumable()).toBe(false);
  });

  it('reports a persisted session', async () => {
    await expect(new Session(memoryStore()).adopt(TOKENS)).resolves.toEqual({ persisted: true });
  });

  it('lets an unexpected storage error escape rather than reporting success', async () => {
    // Only the typed unavailability case is recoverable. A programming error in
    // the store should not be laundered into "the session is fine".
    const store: RefreshTokenStore = {
      ...memoryStore(),
      write: () => Promise.reject(new Error('boom')),
    };

    await expect(new Session(store).adopt(TOKENS)).rejects.toThrow('boom');
  });
});
