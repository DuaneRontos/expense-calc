# Running expense-calc on your machine

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
while `SameSite` compares *sites*, where it does not and the host name does.
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
docker start expensecalc-db 2>/dev/null || \
  docker run --name expensecalc-db \
    -e POSTGRES_DB=expensecalc -e POSTGRES_USER=expensecalc -e POSTGRES_PASSWORD=expensecalc \
    -p 5432:5432 -d postgres:17
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

## End to end in IntelliJ IDEA and Docker Desktop

Everything above is the command line. This is the same thing from the two
applications, start to finish — **database, backend, frontend** — and it is the
path to use if you want to click Run rather than keep three terminals.

Run configurations for all of it are committed in `.run/`, so IntelliJ picks
them up when you open the project. They appear in the run dropdown beside the
green arrow.

**What is verified here, and what is not.** The command-line path in this
section was run end to end on macOS with JDK 24 and Node 22: database up,
backend started, Expo bundled, signed in as `dev`, and the three report
endpoints answered 200 to the browser with the CORS headers attached. The
`.run/` files are IntelliJ's own serialization — copied from a working
configuration rather than written by hand — but *pressing the green arrow* is
still unverified, so treat the command beside each one as the ground truth if
they ever disagree.

### 0. Open it once

**File → Open**, choose the repository root (not `backend/`). IntelliJ finds
`backend/pom.xml` and imports the Maven project on its own; give it a minute to
resolve dependencies the first time.

Two settings worth checking before you run anything:

| Where | What |
| --- | --- |
| **Settings → Build → Build Tools → Maven → Importing → JDK for importer** | JDK 21 or newer. A newer one is fine — the build targets 21 bytecode whatever compiles it, so there is nothing to install to match. |
| **Settings → Languages & Frameworks → Node.js** | Node 22, and `frontend/node_modules` on the "Coding assistance" list once it exists. |

### 1. Start the database

The application wants a PostgreSQL on `localhost:5432` with a database, user and
password all called `expensecalc` — that is what `application.yml` defaults to,
so matching those three names means no configuration.

**From Docker Desktop:** there is no `docker-compose.yml` in this repository, so
the GUI path is *Images → search `postgres` → Pull `17` → Run*, then open
**Optional settings** and fill in:

| Field | Value |
| --- | --- |
| Container name | `expensecalc-db` |
| Host port | `5432` |
| `POSTGRES_DB` | `expensecalc` |
| `POSTGRES_USER` | `expensecalc` |
| `POSTGRES_PASSWORD` | `expensecalc` |

**Or one command**, which is less clicking and identical in effect:

```bash
docker start expensecalc-db 2>/dev/null || \
  docker run --name expensecalc-db \
    -e POSTGRES_DB=expensecalc -e POSTGRES_USER=expensecalc -e POSTGRES_PASSWORD=expensecalc \
    -p 5432:5432 -d postgres:17
```

**`docker start` first, and that ordering is the whole point.** `docker run`
creates a container, so it works exactly once — the second time it fails with

```
docker: Error response from daemon: Conflict. The container name
"/expensecalc-db" is already in use by container "cb3a38f1f628…". You have to
remove (or rename) that container to be able to reuse that name.
```

which is not a database problem and reads like one. A stopped container is the
normal state after a reboot or a `docker stop`, so the *second* run of this
runbook is the common case rather than the exception. `docker start` on an
already-running container is a no-op that exits 0, so the line above is safe to
paste whatever state you are in. In Docker Desktop the equivalent is pressing
▶ on the existing `expensecalc-db` row rather than creating another container.

Either way it then shows up under **Services → Docker → Containers** inside
IntelliJ, where you can read its logs without leaving the IDE.

**Check it is actually accepting connections** before starting the backend —
the container reports "running" a second or two before Postgres is ready:

```bash
docker exec expensecalc-db pg_isready -U expensecalc
```

`accepting connections` is what you want. Flyway creates the schema on first
boot, so there is no migration step of your own to run.

### 2. Start the backend

**If you already made your own `Backend (insecure-local)`, delete it first.**
The shared configurations in `.run/` use the same two names, so you end up with
two identically-named entries in the dropdown and no way to tell which one the
green arrow is about to run. Yours lives in `.idea/workspace.xml`, which is
gitignored personal state; the `.run/` copies are the project's. **Run → Edit
Configurations**, remove the duplicates from the top-level list, and the shared
ones remain.

Both are **Spring Boot** run configurations rather than Maven ones, which
matters more than it sounds. `mvnw spring-boot:run` forks a second JVM, so
breakpoints never bind, the stop button orphans the child process, and the
Endpoints and Beans tool windows stay empty. The Spring Boot type runs the main
class in-process and all three work. It needs the Spring plugin, so it is
Ultimate-only — on Community, use the command line below.

Pick **`Backend (insecure-local)`** from the run dropdown and press the green
arrow. That is the profile you want unless you are specifically testing auth:
every request works with no token, and it allows the Expo dev server's origin
through CORS so the web client can reach it.

The equivalent command, if you would rather:

```bash
cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=insecure-local
```

Wait for `Started ExpenseCalcBackendApplication`. The API is then on
`http://localhost:8080/api/v1`.

**`Backend (secured)`** is the same thing without the profile — use it when you
want the deployed behaviour, and read *Option B* above first. It needs three
environment variables set or `SecurityStartupGuard` refuses to boot:
`APP_AUTH_USERNAME`, `APP_AUTH_PASSWORD_HASH` and `APP_AUTH_JWT_SECRET`. Put
them in the run configuration's **Environment variables** field, or use the
command in Option B, which passes them inline.

To confirm it is up without leaving the IDE, open **Endpoints** (the tool window
Spring adds) or just:

```bash
curl -s http://localhost:8080/api/v1/categories | head -c 200
```

### 3. Start the frontend

First time only:

```bash
cd frontend && npm ci
```

Then pick **`Frontend (web)`** from the run dropdown, or:

```bash
cd frontend && npm run web
```

Expo serves on **`http://localhost:8081`**, which is the origin the
`insecure-local` profile allows through CORS — so if you change that port, the
browser will start refusing the API calls and the failure will look like the
backend is down when it is not.

The client finds the API on its own: `http://localhost:8080` on web and iOS,
and **`http://10.0.2.2:8080` on an Android emulator**, because `localhost`
inside that emulator is the emulator. Override with `EXPO_PUBLIC_API_URL` if you
are running the backend somewhere else — it is the only env prefix Expo inlines
into the bundle.

### 4. Sign in

Under `insecure-local` the credentials are **`dev` / `dev`**. They are published
in this repository and worthless by design; the profile refuses to start against
anything that is not a local database.

### The whole thing, in four terminal commands

If you would rather skip the IDE entirely. **Three of these need their own
terminal tab, and every `cd` is relative to the repository root** — so start
each tab with `cd ~/IdeaProjects/expense-calc` (or wherever you cloned it).

Pasting all four into one terminal does not work, and fails in a way that
blames the wrong thing: command 2 never returns, because a dev server running
in the foreground *is* the success case. Ctrl-C to get the prompt back kills the
backend, and you are now inside `backend/`, so the next line dies on
`cd: no such file or directory: frontend`. Nothing is wrong with the frontend.

```bash
docker start expensecalc-db 2>/dev/null || \
  docker run --name expensecalc-db \
    -e POSTGRES_DB=expensecalc -e POSTGRES_USER=expensecalc -e POSTGRES_PASSWORD=expensecalc \
    -p 5432:5432 -d postgres:17
```

```bash
cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=insecure-local
```

```bash
cd frontend && npm ci
```

```bash
cd frontend && npm run web
```

Commands **2 and 4 stay in the foreground and never return** — that is them
working. Command 3 is first-run only. Then open `http://localhost:8081`.

### Running the tests from the IDE

**`Backend (verify)`** runs `./mvnw -B verify` — the whole suite including the
dozen Testcontainers tests that start their own throwaway PostgreSQL. **Docker
Desktop has to be running** for those; they do not use the container from step 1
and will not touch it.

`Frontend (test)` runs jest. The other three frontend checks are
`npm run lint`, `npm run typecheck` and `npm run export:check` — the last one
bundles for iOS, Android and web and is the only check that proves the JS
compiles for a device.

### When the IDE and the command line disagree

**Surefire forks the test JVM on whatever JDK is running the build**, so tests
run on your IntelliJ JDK while CI runs them on 21. Hibernate's bytecode
generation is JDK-sensitive, so a failure that appears in one and not the other
is possible in both directions. **CI on JDK 21 is the parity check**; a local
pass on a newer JDK is advisory. Trust CI when they disagree.

## Trying the API

These assume **Option A** above (the `insecure-local` profile). If you are
running secured, add `-H "Authorization: Bearer $ACCESS_TOKEN"` to every one.

**Or import the Postman collection**, which is the same walkthrough with
assertions attached: [`backend/expensecalc.postman_collection.json`](../backend/expensecalc.postman_collection.json).
Nineteen requests across six folders, run top to bottom — ids chain between
them, so nothing needs pasting, and `05 Cleanup` deletes what it created.
Under `insecure-local` skip the `00 Auth` folder entirely; under a secured
backend run it first, having set the `username` and `password` variables to
whatever `APP_AUTH_USERNAME` was.

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

**`docker run` says the container name is already in use.** You have run this
before. The container exists and is merely stopped — `docker start
expensecalc-db` rather than creating a second one. The commands in this file
already lead with that.

**The run configurations are not in the dropdown.** They are read from `.run/`
at project load, so a branch switch that adds them needs **File → Reload All
from Disk**, or a Maven reimport. If instead you see *two* entries with the same
name, one of them is your own in `.idea/workspace.xml` — see step 2.

**`Backend (secured)` boots but sign-in always fails.** The
`APP_AUTH_PASSWORD_HASH` in the run configuration is a placeholder rather than a
real hash. `Argon2PasswordEncoder` cannot parse `$argon2id$` on its own, and the
guard only checks the variable is set, so this surfaces at sign-in rather than
at startup. Generate one with the command in Option B.

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
