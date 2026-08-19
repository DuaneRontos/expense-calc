import type { RefreshTokenStore } from './refreshTokenStore';

/**
 * Refresh-token storage for the web target (spec §9.2) — deliberately in memory.
 *
 * **Spec §9.2 asks for an `httpOnly; Secure; SameSite=Strict` cookie here, and
 * this file cannot provide one.** An `httpOnly` cookie is by definition
 * unreadable and unwritable from JavaScript; only the server can set it, via
 * `Set-Cookie`. The API currently returns both tokens in the response body and
 * sets no cookie — `AuthController` says so explicitly, on the grounds that
 * three targets need two different storage mechanisms and only the client knows
 * which it is.
 *
 * That leaves the web client with four options, three of which are worse:
 *
 *  - `localStorage` — forbidden outright by spec §9.2 and §10. Readable by any
 *    script that achieves XSS.
 *  - `sessionStorage` — the same exposure with a shorter life. The rule is
 *    about script-readability, not about persistence.
 *  - a non-`httpOnly` cookie — script-readable by construction, so it buys the
 *    persistence without the protection that made the spec ask for a cookie.
 *  - memory — safe, and lost on reload.
 *
 * So: memory. The cost is real and should not be discovered in review — a web
 * user is signed out by a page refresh. Closing that gap needs a backend change
 * (`Set-Cookie` on `/auth/login` and `/auth/refresh` for web callers, plus CSRF
 * protection, which the API currently disables), not a client one. Until then
 * this is the only option that does not trade the spec's security rule for
 * convenience.
 */

let token: string | null = null;

export const refreshTokenStore: RefreshTokenStore = {
  read() {
    return Promise.resolve(token);
  },

  write(value: string) {
    token = value;
    return Promise.resolve();
  },

  clear() {
    token = null;
    return Promise.resolve();
  },
};
