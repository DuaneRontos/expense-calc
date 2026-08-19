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
  async adopt(tokens: Tokens): Promise<AdoptResult> {
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
    return { persisted };
  }

  currentAccessToken(): string | null {
    return this.accessToken;
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
    await this.store.clear();
  }
}
