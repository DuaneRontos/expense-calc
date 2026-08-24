# Running the backend on your machine

Everything here has been exercised in CI. What CI cannot tell you is whether it
works on *your* laptop, which is what this is for.

## What you need

| | |
| --- | --- |
| **JDK 21 or newer** | `java -version`. A newer JDK is fine — the build targets 21 bytecode whatever you compile with, so there is nothing to install to match. |
| **Docker** | Only for the tests and for the throwaway database below. Not needed to compile. |

You do **not** need Maven installed. `./mvnw` downloads the right version.

## The fastest way to see it work

One command, no database setup, no configuration:

```bash
cd backend && ./mvnw -B verify
```

That compiles everything and runs the whole suite — over 400 tests, including a dozen that
start a real PostgreSQL in Docker. The one worth watching is
`BackendOperabilityTest` — it boots the whole application on a random port
against that database, then drives it over HTTP: creates an expense, watches
the rule engine file it under Groceries unprompted, lists it, checks the
report, reclassifies it, watches the report follow, and deletes it.

**If that passes, the backend works.** Everything below is for poking at it by
hand.

## Authentication changed how you run this

The API now requires a token on every request except signing in (#21, spec
§9.2). That gives you two ways to run it locally, and **the first is what you
want unless you are specifically testing auth.**

### Option A — turn authentication off (recommended for local poking)

```bash
cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=insecure-local
```

Every `curl` below then works with no token. The profile ships credentials that
are published in this repository and worthless by design. It also allows the
Expo dev server's origin through CORS, so `npm run web` can reach the API — see
below for why that is not something `curl` can check.

### `curl` cannot tell you whether the web client will work

Nothing on this page exercises CORS, and for a while nothing anywhere did. The
API sent no `Access-Control-Allow-Origin`, so a browser refused **every** call
from the web client — while every `curl` here passed, and iOS and Android were
unaffected, because neither is a browser and neither sends an `Origin` header
(#58).

To check the way a browser would, send one:

```bash
curl -s -D - -o /dev/null -H "Origin: http://localhost:8081" http://localhost:8080/api/v1/categories
```

An `Access-Control-Allow-Origin` line in the response means the web client can
read it. No such line means it cannot, whatever the status code says — the
request succeeds at the server and the browser throws the answer away.

Origins come from `app.cors.allowed-origins`, which is **empty by default**, so
a deployment is reachable only from its own origin until it is configured.

**This profile cannot be deployed, and that is enforced rather than documented.**
`SecurityStartupGuard` refuses to start the application if the profile is active
alongside `app.deployment=production`, *or* against any database that is not
`localhost`. The second check is the one that matters: the realistic accident is
not declaring production and forgetting, it is running the local profile against
a remote database because the URL was still in your environment.

If you see this, that is the guard working:

```
Refusing to start: the insecure-local profile disables authentication entirely,
and spring.datasource.url (jdbc:postgresql://db.internal:5432/expensecalc) is not
a local database.
```

### Option B — run it secured, the way it deploys

Three settings, none of which have defaults — a default secret is a published
secret, so the app refuses to start without them rather than falling back to
something that works and is worthless.

Generate a password hash. Spring's Argon2 encoder has no command-line entry
point, so this builds the classpath and runs it directly:

```bash
cd backend && ./mvnw -q dependency:build-classpath -Dmdep.outputFile=/tmp/cp.txt && jshell --class-path "$(cat /tmp/cp.txt)" -
```

Then paste this and copy the line it prints:

```java
System.out.println(org.springframework.security.crypto.argon2.Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode("your-password-here"));
```

The output starts `$argon2id$v=19$…`. **Do not add a `{argon2id}` prefix** — that
is `DelegatingPasswordEncoder` syntax, and this application configures a bare
`Argon2PasswordEncoder`, which cannot parse it.

Then run with the three values set:

```bash
cd backend && APP_AUTH_USERNAME=you APP_AUTH_PASSWORD_HASH='<the hash>' APP_AUTH_JWT_SECRET='at-least-32-bytes-of-random-text-here' ./mvnw spring-boot:run
```

Sign in to get a token:

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"you","password":"your-password-here","client":"device"}'
```

`client` is required and has no default (issue #57). Use `device` from `curl`
and from iOS or Android: you get the refresh token in the response body. A
browser sends `web` instead and gets it in an `httpOnly` cookie it cannot read,
with no `refreshToken` field in the body at all — see below. Guessing this
server-side is what the field avoids, and both wrong guesses fail silently.

That returns `accessToken`, `refreshToken` and `expiresInSeconds` (900 — fifteen
minutes, because an access token cannot be revoked, so its lifetime *is* the
window a leaked one works in). Put the access token on every other request:

```bash
curl -s http://localhost:8080/api/v1/categories -H "Authorization: Bearer $ACCESS_TOKEN"
```

When it expires, exchange the refresh token — **which invalidates it**, so keep
the new one:

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/refresh -H 'Content-Type: application/json' -d '{"refreshToken":"<the refresh token>"}'
```

### The web client keeps its refresh token in a cookie

Spec §9.2 puts the web refresh token in an `httpOnly; Secure; SameSite=Strict`
cookie. Such a cookie is unreadable and unwritable from JavaScript by
definition, so **only the server can set one** — which is why this was a backend
change and why, before it, a page refresh signed a web user out.

Signing in with `"client":"web"` returns `Set-Cookie` and **omits**
`refreshToken` from the body. Sending it in both places would hand a script the
value the cookie exists to hide, so you get exactly one.

Refreshing then needs two things from the browser: the cookie, and a header.

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/refresh -H 'Content-Type: application/json' -H 'X-Refresh-Source: cookie' -b 'refresh_token=<value>' -d '{}'
```

**`X-Refresh-Source` is the CSRF defence, and its presence is the whole check —
the value is not read.** A cookie is attached by the browser rather than by the
client, so `/auth/refresh` became reachable from any page on the internet the
moment it accepted one. A cross-site form or navigation cannot set a header at
all, and a cross-origin `fetch` that sets one is preflighted, which this API
answers only for the origins `app.cors.allowed-origins` names. `SameSite=Strict`
is set too, but it is a browser behaviour rather than a server check — a second
layer, not the first.

Omitting the header gives `403`, and the token is **not** consumed: a refusal
that rotated it anyway would deliver exactly the outcome the attack wanted.
Sending neither a cookie nor a body token gives `400` rather than `401` — an
expired session and a client that forgot `credentials: 'include'` both leave you
signed out, but only one is fixed by signing in again.

`POST /auth/logout` clears the cookie with a matching `Set-Cookie`.

**On `Secure` and localhost:** Chrome and Firefox treat `http://localhost` as a
secure context and do accept `Secure` cookies there, so local development needs
no exception. Serving the web client from a plain-HTTP LAN address is the case
that breaks — the browser silently stores no cookie. Set
`APP_AUTH_REFRESH_COOKIE_SECURE=false` for that, and only that.

**Cross-origin web dev also needs `app.cors.allowed-origins` set** to wherever
the client is served from. `allow-credentials` is now true by default, but it is
inert while no origin is allowed, and a wildcard origin is rejected outright in
that combination — a deployment currently running `APP_CORS_ALLOWED_ORIGINS=*`
will fail to start until it names its origins.

**Reach the web client on the same host name as the API.** CORS and cookies do
not draw the same boundary: CORS compares *origins*, where the port counts,
while `SameSite` compares *sites*, where it does not and the host name does. So
`http://localhost:8081` and `http://localhost:8080` are two origins but one
site, so the cookie travels between them. `http://127.0.0.1:8081` and
`http://localhost:8080` are two origins *and* two sites, so it does not travel
at all.

The failure is unpleasant because the first half works: CORS passes, sign-in
returns 200, the browser stores the cookie — and then a reload signs you out
with nothing in any log. Use `localhost` on both, which is why the local profile
lists only that origin.

The same applies in production: a web client on one registrable domain and an
API on another will never see the cookie, and **no setting in
`app.auth.refresh-cookie` can rescue that** — it carries `name`, `path` and
`secure`, none of which decides which site the cookie travels to. Only
`SameSite=None` would, and this API deliberately does not offer it.

Subdomains of one registrable domain need no configuration at all: the cookie is
host-only for the API's host, and `api.example.com` is same-site with
`app.example.com`, so it simply works. Serve both from one site.

### If sign-in starts answering `429`

Login is rate limited (issue #52). Argon2id is deliberately expensive to
verify, which is what makes guessing costly — and on the one endpoint that
cannot require authentication, that same cost is a denial-of-service lever.

Two failures are free. After that each further failure earns a lockout that
grows 1s, 4s, 16s, 64s, 256s, capped at five minutes. A successful sign-in
clears it, and so does going longer than `max-lockout` — five minutes at the
default — without a failure, so a few mistypes last week do not cost you a
lockout on today's first mistake. A separate ceiling
allows 60 attempts a minute across all callers. The response carries
`Retry-After` in seconds.

**The limit is checked before the password is compared**, so a locked-out caller
gets `429` even with the right password — that is deliberate, and it is what
stops the refusal being a way to probe which guess was correct. Wait out the
`Retry-After` rather than retrying immediately.

To get out of the way while developing, raise the free attempts:

```bash
APP_AUTH_RATE_LIMIT_FREE_ATTEMPTS=1000 ./mvnw spring-boot:run
```

Behind a reverse proxy, set `server.forward-headers-strategy` so the container
resolves the real client address. The limiter reads `getRemoteAddr()` and never
parses `X-Forwarded-For` itself — trusting that header unconditionally would let
any caller choose their own bucket, which is a bypass rather than a limit.

## Running the app for real

The application needs a PostgreSQL on `localhost:5432`. The quickest one:

```bash
docker run --name expensecalc-db -e POSTGRES_DB=expensecalc -e POSTGRES_USER=expensecalc -e POSTGRES_PASSWORD=expensecalc -p 5432:5432 -d postgres:17
```

Then:

```bash
cd backend && ./mvnw spring-boot:run
```

Flyway creates the schema on first start — there is no migration step to run
yourself. The API is on `http://localhost:8080/api/v1`.

To stop and throw the database away afterwards:

```bash
docker rm -f expensecalc-db
```

## Trying the API

These assume **Option A** above (the `insecure-local` profile). If you are
running secured, add `-H "Authorization: Bearer $ACCESS_TOKEN"` to every one.

Create an expense — note the amount is a **string**, not a number:

```bash
curl -s -X POST http://localhost:8080/api/v1/expenses -H 'Content-Type: application/json' -d '{"amount":"1234.56","currency":"PHP","occurredOn":"2026-01-15","merchant":"Puregold","description":"weekly shop"}'
```

The response comes back classified as `GROCERIES` with a `classifications`
array showing `RULE_ENGINE` decided it. Nobody told it that — the rules are in
code (`ClassificationRules.java`).

Record a refund by sending a negative amount:

```bash
curl -s -X POST http://localhost:8080/api/v1/expenses -H 'Content-Type: application/json' -d '{"amount":"-500.00","currency":"PHP","occurredOn":"2026-01-20","merchant":"Puregold","description":"returned items"}'
```

List with filters, sorting and paging:

```bash
curl -s 'http://localhost:8080/api/v1/expenses?category=GROCERIES&from=2026-01-01&to=2026-02-01&sort=amountMinor,desc&size=10'
```

See the refund netted against the spending — the total is 734.56, not 1734.56:

```bash
curl -s 'http://localhost:8080/api/v1/reports/by-category?from=2026-01-01&to=2026-02-01'
```

Spend over time, and a period comparison:

```bash
curl -s 'http://localhost:8080/api/v1/reports/over-time?from=2026-01-01&to=2026-04-01&bucket=month'
```

```bash
curl -s 'http://localhost:8080/api/v1/reports/compare?from=2026-03-01&to=2026-04-01'
```

The taxonomy, which the client is meant to read rather than hardcode:

```bash
curl -s http://localhost:8080/api/v1/categories
```

## Things that will look like bugs and are not

**A total can be negative.** More refunds than spending in a period nets below
zero, and the report says so rather than clamping at zero. `INCOME` is included
in the headline total, so a month with a salary in it reports negative — that is
net cash flow, and it is argued in `CategoryBreakdown`'s javadoc.

**`minAmount=0` excludes refunds.** Bounds compare against the signed amount, so
a minimum of zero means "at least zero pesos", not "at least zero in magnitude".

**Dates are half-open.** `to=2026-02-01` means *up to but not including* the
1st, so January and February cannot both count the same day.

**An unrecognised merchant is `UNCLASSIFIED`, not a guess.** That is a real
state, not a failure — a wrong confident guess corrupts every report after it,
and an unclassified row is visible and fixable.

## When something goes wrong

**Tests fail with a Docker or Testcontainers error.** The daemon is not running.
`./mvnw -DskipTests package` compiles without it, and CI runs the rest.

**The app fails to start with a connection error.** Nothing is listening on
5432, or the credentials differ from the `docker run` above. They are read from
`DB_URL`, `DB_USERNAME` and `DB_PASSWORD` if you would rather set those.

**The app fails to start complaining about schema validation.** The database has
an older schema than the code. Simplest fix locally is to drop the container and
let Flyway rebuild it: `docker rm -f expensecalc-db` and start again.

**Every request returns 401.** You are running secured without a token, or the
token expired — they last fifteen minutes. Either sign in again, refresh, or use
the `insecure-local` profile.

**The app refuses to start, saying `app.auth.jwt-secret is not set`.** You are
running secured (Option B) without the three settings. Either set them or use
the `insecure-local` profile.

**Tests pass locally but fail in CI, or the reverse.** CI runs JDK 21; you may
be on something newer. Hibernate's bytecode generation is JDK-sensitive, so a
difference is possible in both directions. **CI is the parity check** — trust it
when they disagree.
