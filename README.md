# expense-calc

An expense calculator: classify expenses, sort and filter them, and produce
analytical reports with charts. Java Spring Boot backend, Expo / React Native
Web frontend targeting iOS, Android, and desktop web from one codebase.

The application is the smaller half of the point. This repo is a working
reference for **agentic workflows** — the GitHub Actions agents below are part
of the deliverable, and most of what is documented here was learned by running
them into things.

- [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) — what to build
- [`CLAUDE.md`](CLAUDE.md) — how to build it, and the conventions agents must follow

## The two agents

| | `claude.yml` | `claude-code-review.yml` |
| --- | --- | --- |
| **Trigger** | You mention `@claude` | A PR opens or leaves draft |
| **Purpose** | Does the work — writes code, opens PRs | Reviews a PR and comments |
| **Runs shell?** | Four git verbs only | `./mvnw` only |
| **Cost control** | `if:` guard on the mention | One review per PR |

### Reviews happen once per PR

The reviewer used to run on every push. One PR cost four rounds of roughly six
minutes of Opus each, and reviews draw on the same subscription quota as
interactive use — so the later rounds, which mostly re-verified the earlier
rounds' fixes, were taking quota from whoever was at a terminal.

**To get another round, comment `@claude` on the PR.** Whether a push deserves
one is a judgement only the author has; a typo fix does not.

### The reviewer runs the tests

It can run `cd backend && ./mvnw -B -q verify`, and is asked to reproduce a bug
before reporting it and to run a fix before suggesting one.

This is not a nicety. While it could only read code, its diagnoses were
consistently right and its *remedies* were wrong about a third of the time —
suggesting that `grocery` plus an `s` covers `groceries`, or that folding a
curly apostrophe makes `McDonalds` match `McDonald's`. Applied blind, those
ship bugs. Once it could execute, the wrong-remedy rate went to zero in the
round that followed.

### The cost model, plainly

Every run bills against a Claude Pro/Max subscription through the
`CLAUDE_CODE_OAUTH_TOKEN` secret. So:

- **`claude.yml` is guarded by an `if:`.** Without it, *every comment in the
  repo* starts a billed agent. Note the guard matches the literal string
  `@claude` anywhere in a comment body — including one that merely mentions it
  while explaining how to request a review. That is easy to do by accident.
- **`claude-code-review.yml` skips drafts** and ignores `.github/**`, which it
  could never review anyway (see below).
- **Both pin `--model claude-opus-5`.** Dropping the pin is the documented
  first remedy if runs start failing with `is_error:true`.

`ANTHROPIC_API_KEY` is **not** the credential these use. platform.claude.com
billing is prepaid and separate from a claude.ai subscription, so an API key on
an unfunded account fails with "credit balance is too low".

## Two things that will confuse you

**A workflow cannot review the PR that changes it.** The action requires the
workflow file to be byte-identical to the copy on the default branch and skips
itself otherwise. A PR editing its own workflow gets a 13-second no-op, and a
branch that lags behind `main` loses its reviewer entirely rather than keeping
the old one — so merge `main` in after changing either workflow.

**`@claude` on a PR needs the PR's code checked out.** None of the mention
events is a `pull_request` event, so `actions/checkout` defaults to the default
branch and the agent lands in a tree with none of the PR's files. `claude.yml`
resolves the ref before checkout; only an open, same-repo PR gets its head
branch.

## Skills and subagents

**Skills** (`.claude/skills/`) load on demand when the work matches their
description. [`expense-classification`](.claude/skills/expense-classification/SKILL.md)
carries the category taxonomy and the rules classification code must implement
— it is why the rules live in code rather than prompt text, and why the same
expense always lands in the same category.

**Subagents** (`.claude/agents/`) are specialists invoked for a slice of work.
[`money-safety-auditor`](.claude/agents/money-safety-auditor.md) is read-only
and checks the one thing this codebase cannot get wrong: no `float` or `double`
in any money path, `BigDecimal` compared with `compareTo` rather than `equals`.

## Running it

```bash
cd backend && ./mvnw verify              # compile + test (tests need Docker)
cd backend && ./mvnw -DskipTests package # compile only, no Docker required
```

Tests start a real Postgres through Testcontainers, so a Docker daemon is
required for the full suite. CI on JDK 21 is the parity check —
[`CLAUDE.md`](CLAUDE.md) has the detail, including why a local pass on a newer
JDK is only advisory.

To set the agents up on your own fork: install the
[Claude GitHub app](https://github.com/apps/claude), then generate a token with
`claude setup-token` and store it with
`gh secret set CLAUDE_CODE_OAUTH_TOKEN`.

## Status

Backend classification is implemented. The query, reporting, and frontend
phases are open — see [`docs/SPECIFICATION.md` §11](docs/SPECIFICATION.md) for
the delivery plan and the issue list.
