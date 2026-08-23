import type { RefreshTokenStore } from './refreshTokenStore.types';

/**
 * Refresh-token storage for the web target (spec §9.2) — the browser's, not ours.
 *
 * **This store deliberately holds nothing.** Spec §9.2 puts the web client's
 * refresh token in an `httpOnly; Secure; SameSite=Strict` cookie, and issue #57
 * made the server set one. Such a cookie is unreadable and unwritable from
 * JavaScript by definition — that is the entire point of the flag — so there is
 * no value here to keep, and the absence is the feature.
 *
 * `read()` returning null is therefore the **normal** state on web, not a
 * signed-out one. `client.ts` reads it that way: with nothing to send, it posts
 * an empty refresh body and lets the browser attach the cookie, adding
 * `X-Refresh-Source` so the server can tell the request was not made
 * cross-site.
 *
 * ## What this replaced, and why it was not a smaller change
 *
 * Until #57 the API returned both tokens in the body and set no cookie, because
 * three targets need two storage mechanisms and only the client knows which it
 * is. That left web with four options, three of them worse:
 *
 *  - `localStorage` — forbidden outright by spec §9.2 and §10. Readable by any
 *    script that achieves XSS.
 *  - `sessionStorage` — the same exposure with a shorter life. The rule is
 *    about script-readability, not about persistence.
 *  - a non-`httpOnly` cookie — script-readable by construction, so it buys the
 *    persistence without the protection that made the spec ask for a cookie.
 *  - memory — safe, and lost on reload.
 *
 * This file held the token in memory, and **a page refresh signed the user
 * out.** Closing that needed the server to set the cookie, which is why it was
 * a backend issue and not a client one.
 *
 * The contract is imported from `refreshTokenStore.types` rather than from
 * `./refreshTokenStore`, which in a web bundle resolves to this file itself.
 */
export const refreshTokenStore: RefreshTokenStore = {
  /** Always null on web: the cookie is not visible to script. */
  read() {
    return Promise.resolve(null);
  },

  /**
   * A no-op. The server writes the cookie with `Set-Cookie`; a script cannot,
   * and one that appeared to would be writing something the browser ignores.
   */
  write() {
    return Promise.resolve();
  },

  /**
   * Also a no-op. `POST /auth/logout` clears the cookie server-side with a
   * matching `Set-Cookie`, which is the only thing that can remove it.
   */
  clear() {
    return Promise.resolve();
  },
};
