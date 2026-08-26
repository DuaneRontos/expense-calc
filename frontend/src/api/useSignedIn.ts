import { useSyncExternalStore } from 'react';

import { api } from './client';

/**
 * Whether this client currently holds a live session.
 *
 * `useSyncExternalStore` rather than a context, because the session is not
 * React state and never was — it is a field on a module singleton that the API
 * client mutates from outside any render. A provider would have to mirror it,
 * and a mirror is a second source of truth that can disagree with the one the
 * requests actually use.
 *
 * Both arguments are read straight off the instance. They are arrow properties
 * on {@link Session}, so their identity is stable for the life of the client —
 * which matters here rather than being tidiness: React re-subscribes whenever
 * `subscribe` changes identity, so a fresh closure per render would tear down
 * and re-establish the subscription on every commit.
 *
 * **The server snapshot is `false`, and that is the honest answer rather than a
 * placeholder.** `app.json` sets `web.output: "static"`, so expo-router
 * pre-renders these screens in Node at export time. There is no browser there,
 * therefore no cookie and no session — and without this argument React throws
 * during that render rather than defaulting. It is not covered by a test: doing
 * so needs `react-dom/server`, and this suite runs under jest-expo's native
 * environment where that is not the renderer in play.
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(api.session.subscribe, api.session.isSignedIn, () => false);
}
