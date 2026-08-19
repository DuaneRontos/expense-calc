import * as SecureStore from 'expo-secure-store';

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

export interface RefreshTokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * True when the device can actually store a secret.
 *
 * An Android device with no secure lock screen has no Keystore to write to, and
 * a simulator can be configured the same way. `expo-secure-store` throws rather
 * than degrading, and a sign-in that fails with a native exception reads as a
 * broken app rather than an unusual device.
 */
async function usable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
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

  async write(token: string) {
    if (!(await usable())) {
      return;
    }
    await SecureStore.setItemAsync(KEY, token, {
      // The token is only useful to a running app, so it does not need to be
      // readable before the first unlock after a reboot.
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
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
