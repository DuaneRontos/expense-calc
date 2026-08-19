/**
 * The refresh-token storage contract, shared by both platform variants.
 *
 * Platform-neutral on purpose. The web variant used to import this type from
 * `./refreshTokenStore`, which under Metro resolves to *itself* in a web bundle
 * — harmless only because `import type` is erased by the TypeScript transform,
 * so nothing self-imported at runtime. That made "neither platform bundles the
 * other's mechanism" rest on a single keyword: drop `type` to also import a
 * constant, and the web bundle pulls in `expo-secure-store`. Keeping the
 * contract in a file with no platform variant removes the hazard structurally
 * rather than by convention.
 */

export interface RefreshTokenStore {
  read(): Promise<string | null>;
  /** @throws RefreshTokenUnavailableError when the token could not be persisted */
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The device could not persist the refresh token.
 *
 * Thrown rather than swallowed because the consequence is invisible until it
 * bites: an Android device with no secure lock screen has no Keystore to write
 * to, so the session works for fifteen minutes and then drops the user at the
 * sign-in screen with no explanation. The one condition the availability check
 * exists to detect was the one nobody was told about.
 */
export class RefreshTokenUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The refresh token could not be stored securely on this device.');
    this.name = 'RefreshTokenUnavailableError';
    this.cause = cause;
  }
}
