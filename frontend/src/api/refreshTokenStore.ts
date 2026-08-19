import * as SecureStore from 'expo-secure-store';

import { RefreshTokenUnavailableError, type RefreshTokenStore } from './refreshTokenStore.types';

/**
 * Refresh-token storage for iOS and Android (spec §9.2).
 *
 * The Keychain on iOS and the Keystore on Android, both reached through
 * `expo-secure-store`. The access token never comes here — it lives in memory
 * for the life of the process on every target, because a 15-minute credential
 * is not worth a disk write.
 *
 * Metro picks `refreshTokenStore.web.ts` for the web target instead. The split
 * is a file rather than a `Platform.OS` branch so that neither platform bundles
 * the other's mechanism, and so the reason each one is what it is has somewhere
 * to be written down.
 */

const KEY = 'expense-calc.refreshToken';

/**
 * Whether the device can store a secret, resolved once per process.
 *
 * Cached because availability cannot change while the app is running, and it
 * was previously re-checked on every operation — so a single refresh cost four
 * native bridge round-trips instead of the two reads it actually needed.
 */
let availability: Promise<boolean> | null = null;

function usable(): Promise<boolean> {
  availability ??= SecureStore.isAvailableAsync().catch(() => false);
  return availability;
}

/** Test seam; the cache is process-lifetime otherwise. */
export function resetAvailabilityCache(): void {
  availability = null;
}

export const refreshTokenStore: RefreshTokenStore = {
  async read() {
    if (!(await usable())) {
      return null;
    }
    try {
      // Normalised to null: the native module can hand back undefined, and a
      // caller testing `!== null` would read that as "there is a session".
      return (await SecureStore.getItemAsync(KEY)) ?? null;
    } catch {
      // A read failure means the session cannot be resumed, which is a sign-in
      // prompt rather than an error worth showing. Throwing here would take
      // down app start for a recoverable condition.
      return null;
    }
  },

  /**
   * Persists the refresh token, or says it could not.
   *
   * **Reports failure in both directions**, unlike `read` and `clear`, which
   * degrade quietly because their failure modes are recoverable. This one is
   * not: a token that was not written means the session silently ends at the
   * access token's fifteen-minute expiry. The caller can then tell the user
   * that rather than letting them discover it.
   */
  async write(token: string) {
    if (!(await usable())) {
      throw new RefreshTokenUnavailableError();
    }
    try {
      await SecureStore.setItemAsync(KEY, token, {
        // The token is only useful to a running app, so it does not need to be
        // readable before the first unlock after a reboot.
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch (error) {
      // The Android Keystore invalidates its key when the user adds or changes
      // a lock-screen credential, which is common and recoverable — but only if
      // somebody is told.
      throw new RefreshTokenUnavailableError(error);
    }
  },

  async clear() {
    if (!(await usable())) {
      return;
    }
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      // Already gone is the outcome we wanted.
    }
  },
};

export type { RefreshTokenStore };
