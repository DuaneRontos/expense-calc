import { useEffect, useState, useSyncExternalStore } from 'react';

import { api } from './client';

/** What the guard is allowed to know. */
export type AuthGate = 'resolving' | 'signed-in' | 'signed-out';

/**
 * Whether the client has settled the session question, and how it answered.
 *
 * **The third state is the whole point.** `useSignedIn()` is a boolean, and on
 * web a boolean cannot distinguish "signed out" from "not asked yet": the
 * credential is an `httpOnly` cookie no script can read, so every returning
 * visitor starts with nothing in memory and looks signed out until
 * `/auth/refresh` answers. A guard reading that boolean would redirect all of
 * them to sign-in before the client had asked the one participant that can see
 * the cookie.
 *
 * **Nothing is memoised here, deliberately.** A second consumer calling
 * `resume()` again is harmless: it returns from memory once a session exists,
 * and otherwise joins the exchange already in flight, because `refresh()` is
 * single-flight. Memoising the promise at module scope instead made the answer
 * outlive the session — and outlive the test that set it up, which is how this
 * was noticed.
 */
export function useAuthGate(): AuthGate {
  // Tracks the session *after* it resolves, so signing out — which happens
  // outside React, on a module singleton — moves the gate rather than leaving it
  // reporting a session that has already ended.
  const signedIn = useSyncExternalStore(api.session.subscribe, api.session.isSignedIn, () => false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let live = true;
    void api
      .resume()
      // **Caught as well as settled.** A rejection would otherwise leave
      // `resolved` false for good, and the guard holds a spinner over the whole
      // app for as long as that lasts — so "we could not tell" has to land on
      // the signed-out side rather than on no side at all.
      //
      // `finally` alone is not enough: it settles the gate but passes the
      // rejection through, leaving it unhandled. `resume()` is contracted not
      // to reject; this is the belt to that braces, because the cost of being
      // wrong changed when the guard went in.
      .catch(() => false)
      .finally(() => {
        if (live) {
          setResolved(true);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  if (!resolved) {
    return 'resolving';
  }
  return signedIn ? 'signed-in' : 'signed-out';
}
