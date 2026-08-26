import { refreshTokenStore } from './refreshTokenStore';
import { RefreshTokenUnavailableError, type RefreshTokenStore } from './refreshTokenStore.types';
import type { Tokens } from './types';

/**
 * What happened to the refresh token when a session was adopted.
 *
 * `persisted: false` means the access token is live but nothing survives it:
 * the session ends silently in fifteen minutes unless the user is told.
 */
export interface AdoptResult {
  persisted: boolean;
}

/**
 * The signed-in session: an access token in memory, a refresh token in storage.
 *
 * Spec §9.2 splits these deliberately. The access token is a signed JWT the API
 * verifies without a database read, short-lived because it cannot be revoked —
 * its 15-minute life *is* the window a leaked one works in. The refresh token is
 * opaque, rotates on every use, and is the only one worth persisting.
 *
 * **The access token is never written to storage on any target**, which is why
 * that half of this class is a plain field rather than anything pluggable.
 */
export class Session {
  private accessToken: string | null = null;

  /** Epoch milliseconds, or null when there is no access token. */
  private expiresAtMs: number | null = null;

  /**
   * Subscribers to whether a session exists, for `useSyncExternalStore`.
   *
   * A `Set` so an unsubscribe is exact rather than by index, and so double
   * subscription by a component that re-runs its effect is idempotent.
   */
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: RefreshTokenStore = refreshTokenStore,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Takes a freshly issued or rotated pair and stores each half correctly.
   *
   * **The write happens before the in-memory assignment, and a failed write is
   * reported rather than thrown.** The previous order set the access token
   * first and let the store's exception escape, so a device that could not
   * persist produced a rejected `login()` — "sign-in failed" on screen — while
   * the client sat on a perfectly good access token it would attach to the next
   * request. Neither half of that was true.
   *
   * Now the session is either fully adopted or untouched, and the caller learns
   * whether it will outlive the access token.
   */
  async adopt(tokens: Tokens, viaCookie = false): Promise<AdoptResult> {
    // Web sends none: the server put it in an `httpOnly` cookie the browser
    // holds and no script can read (issue #57). There is nothing to persist and
    // nothing that can fail, so the session outlives the access token by way of
    // the cookie rather than by way of this store.
    //
    // **Keyed off the caller, not off the response shape.** A device build that
    // somehow received a web-shaped response would otherwise take this branch
    // and report `persisted: true` while nothing was stored — the exact
    // opposite of the signal this result exists to give, and the session would
    // then end in fifteen minutes with no warning.
    if (viaCookie) {
      this.accessToken = tokens.accessToken;
      this.expiresAtMs = this.now() + tokens.expiresInSeconds * 1000;
      this.notify();
      return { persisted: true };
    }

    // Falsy rather than `=== undefined`: a `refreshToken: null` in the JSON —
    // a serializer change, a gateway that normalises absent fields — would
    // otherwise be handed to the store as a value.
    if (!tokens.refreshToken) {
      this.accessToken = tokens.accessToken;
      this.expiresAtMs = this.now() + tokens.expiresInSeconds * 1000;
      this.notify();
      return { persisted: false };
    }

    let persisted = true;
    try {
      await this.store.write(tokens.refreshToken);
    } catch (error) {
      if (!(error instanceof RefreshTokenUnavailableError)) {
        throw error;
      }
      // Recoverable: the app works for this access token's lifetime. Surfaced
      // rather than swallowed so #14's sign-in screen can say so.
      persisted = false;
    }

    this.accessToken = tokens.accessToken;
    this.expiresAtMs = this.now() + tokens.expiresInSeconds * 1000;
    this.notify();
    return { persisted };
  }

  currentAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Whether this client currently holds a live session.
   *
   * The in-memory access token, which is the only honest answer available
   * synchronously: on web the refresh cookie is `httpOnly`, so "is there a
   * session" cannot be answered from script until a refresh has said so.
   *
   * An **arrow property, not a method**, because `useSyncExternalStore` calls
   * it unbound and re-subscribes whenever `subscribe` changes identity. A bare
   * method loses `this`; a fresh arrow per render resubscribes forever.
   */
  readonly isSignedIn = (): boolean => this.accessToken !== null;

  /**
   * How many listeners are attached.
   *
   * Observability for the leak that has no other symptom: a hook that forgets
   * to unsubscribe on unmount behaves identically until something notifies a
   * component React has already discarded. Asserting the count is the only way
   * to see it before that happens.
   */
  listenerCount(): number {
    return this.listeners.size;
  }

  /** Registers a listener and returns its unsubscribe. Arrow, for the reason above. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Called after a call that *may* have changed whether a session exists.
   *
   * Not "only after a real transition", which an earlier version of this
   * comment claimed: `clear()` on an already-signed-out session notifies with
   * nothing changed, and so does `adopt()` on a token rotation, where
   * `isSignedIn()` was true before and after. Both are harmless because
   * `useSyncExternalStore` bails out when `getSnapshot` returns an identical
   * value — but the guarantee is React's, not this method's, and stating it
   * here invited someone to lean on the wrong one.
   *
   * A *failed* `adopt()` does notify nothing, because it returns before
   * reaching any of the call sites.
   */
  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  refreshToken(): Promise<string | null> {
    return this.store.read();
  }

  /**
   * Whether the access token is gone, or close enough to expiry to be useless.
   *
   * The skew exists because `expiresInSeconds` is returned precisely so a client
   * can refresh *before* a request fails rather than after (the API's own words).
   * A token with two seconds left will expire in flight on a slow connection,
   * and the resulting 401 is indistinguishable from a real one.
   */
  needsRefresh(skewMs = 30_000): boolean {
    if (!this.accessToken || this.expiresAtMs === null) {
      return true;
    }
    return this.now() >= this.expiresAtMs - skewMs;
  }

  /**
   * True when there is a stored refresh token worth trying.
   *
   * Truthiness rather than `!== null`: a store backed by a native module can
   * return `undefined`, and an empty string is not a credential either. Both
   * used to read as "there is a session", which sent the client into a refresh
   * that failed for want of a token it never had.
   */
  async isResumable(): Promise<boolean> {
    return Boolean(await this.store.read());
  }

  /** Drops both halves. Used on sign-out and on a refresh that was rejected. */
  async clear(): Promise<void> {
    this.accessToken = null;
    this.expiresAtMs = null;
    try {
      await this.store.clear();
    } finally {
      // In a `finally` because the in-memory halves are already gone above: a
      // store that rejected would otherwise skip this and leave every subscriber
      // reporting a session that no longer exists — precisely the lie
      // `subscribe()` was added to prevent. `adopt()` reaches `notify()` on
      // both paths for the same reason.
      //
      // Not reachable through either store today — both swallow their own
      // failures — but `RefreshTokenStore.clear()` carries no contract
      // forbidding a rejection, and the ordering costs nothing.
      this.notify();
    }
  }
}
