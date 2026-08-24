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

`npm run export:web` produces the static web build; `npx expo export --platform all` bundles all three targets and is the
cheapest way to prove the JS compiles for iOS and Android without a simulator.

**Expo SDK 57, React Native 0.86, React 19.** Expo changes fast and its docs are
versioned — read <https://docs.expo.dev/versions/v57.0.0/> rather than the
latest-version pages, which describe a different SDK.

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
