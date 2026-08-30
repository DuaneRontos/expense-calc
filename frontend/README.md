# expense-calc frontend

Expo app targeting **iOS, Android, and desktop web** from one codebase
(spec §2, decision 9.1). Scaffolded in #3.

Read [`docs/SPECIFICATION.md`](../docs/SPECIFICATION.md) before implementing
anything here, and [`CLAUDE.md`](../CLAUDE.md) for the money and date
conventions the client shares with the backend.

## Running

```bash
npm install
npm run web        # desktop web target
npm run ios        # needs Xcode and a simulator
npm run android    # needs Android Studio and an emulator
```

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # jest
```

CI runs the last three on Node 22.

### `testTimeout` is 30s, and that is about the cache, not slow tests

`package.json` sets `testTimeout: 30000`, well above jest's 5s default. Nothing
here is slow: on a developer machine a warm cache runs the whole suite in about
two seconds with the longest single test around 550ms. A 4-core CI runner
measures 4s and 388ms — same order, different box, which is the point.

The setting exists for the **first** run after `jest --clearCache`, or on any
fresh checkout, where each test file's first test absorbs the babel transform
of the Expo and React Native dependency graph behind it. The same test measured
156ms warm and 1,886ms cold in isolation, and under full-suite worker
contention the slowest ones reached 9–21 seconds.

Left at the default that produced a **flaky suite rather than a slow one**:
render-heavy tests timed out at 5,000ms in no fixed order, one to four per run,
across `chipState`, `overview`, `expensesFailure` and `categoryFailure`. It
reproduced on every cold run and never once on a warm one — which is the worst
shape for a merge gate, because **CI installs into a fresh runner every time**
and so only ever runs cold.

Raise it further rather than adding per-test timeouts if this reappears: a
per-test override fixes the one test that happened to lose the race and leaves
the next one to find it.

**And an override does not stay an override.** `signIn.test.tsx` carried
`jest.setTimeout(20_000)`, written as a raise off jest's 5s default before this
setting existed. The day `testTimeout` landed at 30s it silently became a
*lowering*, in the suite's slowest file, and nothing failed so nothing noticed
for months. `src/__tests__/timeoutOverrides.test.ts` now fails the build on any
per-file `jest.setTimeout`, because a rule this easy to break by accident should
not depend on someone having read this paragraph.

### There are two timeout budgets, and `testTimeout` is only one

`waitFor` and every `findBy*` arm their **own** timer rather than deferring to
jest's. It reads `asyncUtilTimeout` from
`@testing-library/react-native`, which defaults to **1,000ms** — so raising
`testTimeout` alone left async waits on a budget thirty times tighter, in the
suites that were flaking hardest. There are 27 such waits across `useReports`,
`expensesFailure`, `signIn` and `overview`.

`jest.setup.js` raises it to 10s, registered through `setupFilesAfterEnv`
because the jest-expo preset provides no setup file that calls `configure()`.

**It is deliberately below `testTimeout`.** A `waitFor` that runs out reports
the assertion that never became true; jest's timer reports only
`Exceeded timeout of Nms`, naming no wait. Keeping the async budget the smaller
of the two means the more useful message is always the one that fires — so
raise `testTimeout` first if you ever need this above 30s.

### A typecheck failure naming a route that exists is a stale generated file

`experiments.typedRoutes` makes expo-router generate `.expo/types/router.d.ts`
from whatever is in `app/` at the time. It is git-ignored, so it is regenerated
per machine and can fall behind when a route is added on another branch:

```
error TS2345: Argument of type '"/sign-in"' is not assignable to parameter of
type '"/expenses" | "/" | RelativePathString | ...'
```

The route is there and CI is green, because CI installs into a fresh checkout
with no `.expo/` at all. Delete the stale file and it regenerates:

```bash
rm -f frontend/.expo/types/router.d.ts
```

**Component-render tests work**, and `renderHook` drives hook tests. The
dependency pair in `package.json` is what makes that true, so that is where to
check it — this file deliberately keeps no list of which suites mount, because
every version of such a list has gone stale.

This file used to describe empty renders as a known gap. The cause was that
`@testing-library/react-native` 14 **requires `test-renderer` as a peer
dependency** and it was missing; #64 installed it and the gap closed. Note
`test-renderer` is not `react-test-renderer` — the latter is a different
package, still present transitively, and checking *its* version against React's
is what made the original diagnosis read as "an integration problem rather than
a version mismatch" when it was a missing peer.

Render where the behavior is about announced state or accessibility — the
period-chip bug in #69 was invisible to a pure-logic test because the logic was
right and the announced state was not. Keep testing pure logic where the
behavior is pure logic: geometry, money formatting, query serialization,
problem parsing.

`npm run export:web` produces the static web build; `npm run export:check` bundles all three targets and is the
cheapest way to prove the JS compiles for iOS and Android without a simulator.

**Expo SDK 57, React Native 0.86, React 19.** Expo changes fast and its docs are
versioned — read <https://docs.expo.dev/versions/v57.0.0/> rather than the
latest-version pages, which describe a different SDK.

### `app.json` carries no `newArchEnabled` key, on purpose

The new architecture is the default in SDK 57 and the option went with it. The
key is absent from `@expo/config-types`, and nothing in `@expo/config`,
`@expo/config-plugins` or `@expo/prebuild-config` reads it — so it set nothing
either way. Re-adding it from an older snippet only fails the schema check
below.

### `expo-doctor` has one known failure, and it is deliberate

The failing check is the SDK-patch drift: several packages sit a patch or two
below what the installed SDK expects, `react-native` among them. **It is left
that way on purpose.**

`npx expo install --fix` cannot complete it. The bump wants a newer
`react-native`, which declares a matching `@react-native/jest-preset` as a
peer, and npm cannot resolve that against the rest of the tree:

```
npm error Conflicting peer dependency: @react-native/jest-preset@0.86.3
npm error Could not resolve dependency: react-native@"0.86.3" from the root project
```

Both packages are published, and installing every drifted package together in
one `npm install` hits the same wall — so this is a genuine conflict in the
SDK 57 patch set, not an ordering artefact. The only ways past are `--force` or
`--legacy-peer-deps`, which npm itself describes as accepting "an incorrect
(and potentially broken) dependency resolution."

Everything is within one SDK major, so nothing is broken by waiting. **Retry
`npx expo install --fix` after the next SDK 57 patch** rather than forcing it.
If a partial run leaves `package.json` ahead of `node_modules`, `git checkout
-- package.json package-lock.json && npm ci` puts it back.

### `npm audit` advisories are build tooling, not shipped code

They reach `@expo/cli`, `@expo/metro`, `@expo/config-plugins` and `xcode`.
Metro and the CLI do not go into the app bundle, so this is not "the app is
vulnerable".

Do **not** run `npm audit fix --force` — it fights the SDK's pins and lands you
in the resolution conflict above. They move when the SDK moves.

### Pointing at the backend

`EXPO_PUBLIC_API_URL` overrides the API base. Without it the client defaults to
`http://localhost:8080`, except on Android where it defaults to
`http://10.0.2.2:8080` — on an emulator `localhost` is the emulator itself, and
the mistake presents as a connection refused that looks like the backend is
down.

## Layout

| Path | What lives here |
| --- | --- |
| `app/` | Routes. File-based; `app/expenses.tsx` is the URL `/expenses` |
| `src/api/` | Typed client, wire types, RFC 7807 errors |
| `src/charts/` | Chart geometry and components |
| `src/layout/` | Breakpoints and the responsive shell |
| `src/money/` | Decimal-string formatting |
| `src/theme/` | Colour and spacing tokens |

## Charting: `react-native-svg`

Decided in #3, resolving spec §9.5. Four libraries were considered and two were
built and rendered on the web target:

| Library | Web support | Outcome |
| --- | --- | --- |
| **`react-native-svg`** | First-class; the canonical RNW SVG library | **Chosen** |
| `react-native-gifted-charts` | Yes, verified rendering | Rejected — see below |
| `victory-native` (XL) | Skia/WASM, not officially supported on web | Eliminated without building |
| `recharts` | Web only — no native renderer | Eliminated without building |

Both finalists rendered on web. The measurement that decided it, from two
`expo export --platform web` runs differing only in the chart implementation:

| Variant | Total web JS |
| --- | --- |
| `react-native-gifted-charts` | 1,551,630 bytes |
| `react-native-svg` | 1,168,197 bytes |

**374 KiB — 33% — for less functionality.** gifted-charts depends on
`react-native-svg` anyway, so it is strictly additive weight. It also drops
negative pie slices silently, peer-depends on `react-native-linear-gradient`
(a bare RN module, not Expo-managed), and emits deprecated-prop warnings on
RN 0.86.

The deciding factor beyond size is spec §7: **a net-negative category is listed
in the legend with its real value and excluded from the arc.** No library
implements that, so the legend and the exclusion had to be written here either
way — which left the library supplying only arc math, at 374 KiB.

## Rules this code is built around

**Money is a decimal string end to end.** `src/money/format.ts` formats without
ever converting to a `number`: it asks `Intl` for the *shape* of a peso amount
and substitutes exactly-preserved digits into it. The symbol still comes from
the locale, so nothing hardcodes `₱`, and no float ever touches an amount.
`toChartNumber` is the single deliberate exception, for bar heights and arc
sweeps only — never for a displayed value.

**Totals come from the server.** Report endpoints return pre-aggregated buckets
(spec §3). Nothing here sums a list of expenses.

**Buckets may be negative.** Refunds are negative amounts in their original
category (spec §5), so a bucket can be below zero. `barModel` does not clamp
the domain at zero and `donutModel` returns excluded categories rather than
dropping them. Both are pinned by tests.

**Every chart pairs with a legend carrying the same values** (spec §10), which
is why `ChartLegend` is rendered by the chart components rather than by callers
— a caller cannot forget it or turn it off. Colour never carries meaning alone.

**Tokens are never in `localStorage`** (spec §9.2). The access token lives in
memory on every target and is never written to storage. The refresh token goes
to the Keychain / Keystore on device via `expo-secure-store`
(`src/api/refreshTokenStore.ts`) — Metro picks the variant per platform.

**On web the browser holds it, in an `httpOnly` cookie the server sets**
([#57](https://github.com/DuaneRontos/expense-calc/issues/57)). Such a cookie is
unreadable and unwritable from JavaScript by definition, which is the point — so
`refreshTokenStore.web.ts` now holds *nothing*, and `read()` returning null is
the normal state there rather than a signed-out one. `client.ts` reads it that
way: with nothing to send it posts an empty refresh body, lets the browser
attach the cookie, and adds `X-Refresh-Source` so the server can tell the
request was not made cross-site.

Which mechanism a build uses travels on the login request as
`client: 'web' | 'device'`, derived from `Platform.OS` rather than passed in by
a screen. The server honours exactly one per caller — cookie *or* body, never
both, since a body token is readable by any script that achieves XSS.

Until #57 this stayed **in memory only** on web, because the alternatives
available to a script were `localStorage` (forbidden by spec §9.2 and §10),
`sessionStorage` (the same script-readable exposure), or a non-`httpOnly` cookie
(ditto). Memory was the only one that kept the rule, and **a page reload signed
a web user out.** `refreshTokenStore.web.ts` carries the full argument, and a
test pins the rule against the source — scanning the whole tree, so the tempting
fix cannot land quietly wherever someone hits the problem.
