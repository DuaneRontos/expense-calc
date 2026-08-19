import { refreshTokenStore, type RefreshTokenStore } from './refreshTokenStore';
import type { Tokens } from './types';

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

  /** Takes a freshly issued or rotated pair and stores each half correctly. */
  async adopt(tokens: Tokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.expiresAtMs = this.now() + tokens.expiresInSeconds * 1000;
    await this.store.write(tokens.refreshToken);
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
