# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Anonymous South African cost-of-living survey. One Cloudflare Worker (`survey-app`) serves static assets from `public/`, handles `/submit`, `/export`, `/config`, and persists responses to D1 (`25-survey-app-db`, binding `DB`). Production host is `surveyapp.ink`.

## Commands

```bash
npm install
npm run db:apply:local        # create local D1 tables from schema.sql
npm run dev                   # wrangler dev (needs .dev.vars, see below)

npm test                      # unit + Workers integration
npm run test:unit             # node --test over src/**/*.test.js
npm run test:worker           # vitest (Workers pool, real D1)

npm run db:apply              # apply migrations/ to REMOTE D1
npm run deploy                # wrangler deploy
npx wrangler deploy --dry-run # build check without deploying
```

Single test:

```bash
node --test src/submit.test.js
node --test --test-name-pattern "rejects unknown fields" src/submit.test.js
npx vitest run -t "throttle"
```

Local `.dev.vars` (gitignored; see `.dev.vars.example`) must set `EXPORT_TOKEN`, `IP_HASH_SECRET`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_EXPECTED_HOSTNAME=localhost` — the `wrangler.jsonc` `vars` default that hostname to `surveyapp.ink`, so submissions fail Turnstile verification locally without the override. Production secrets live only in Cloudflare (`npx wrangler secret put …`).

## Two test suites, two databases

- `src/*.test.js` run under `node --test` with hand-built fake `env` objects. No bindings, no D1, no Miniflare.
- `test/*.test.js` run under Vitest with `@cloudflare/vitest-pool-workers` against a real isolated D1. `vitest.config.js` reads `migrations/` into a `TEST_MIGRATIONS` binding; the suite calls `applyD1Migrations` in `beforeAll` and truncates tables in `beforeEach`.

This means the integration suite exercises the **migration** path while `npm run db:apply:local` builds the local dev DB from **`schema.sql`**. Those two must be kept equivalent by hand — a new column added to only one of them will pass tests and break dev (or vice versa).

## Request flow

`src/index.js` is the router and runs before assets (`run_worker_first: true`). It 308-redirects non-local HTTP to HTTPS, dispatches the three API paths, 404s unknown non-GET/HEAD, and wraps everything else from `env.ASSETS.fetch` in `withStaticHeaders`.

`src/security.js` owns every response: base hardening headers, separate API vs static CSP (static allows `challenges.cloudflare.com` for Turnstile), HSTS on HTTPS, `rejectCrossOrigin` (same-origin only), and the generic `serverError`/`serviceUnavailable` shapes.

`src/submit.js` (`POST /submit`) enforces, in order: method → same-origin → required bindings/secrets → streamed 16 KB body limit and JSON parse → `normalizePayload` → requester IP → Turnstile siteverify → HMAC throttle → D1 insert. Turnstile is checked for `success`, `hostname`, and `action`; a 5s timeout or non-OK response returns 503 "unavailable" rather than a validation failure. Throttling is 3 submissions per network per hour, implemented as a single D1 `batch` with an `ON CONFLICT … RETURNING attempt_count` upsert so concurrent isolates share state; rows older than 24h are swept on each call.

`src/export.js` (`GET /export`) requires `Authorization: Bearer <EXPORT_TOKEN>`, explicitly rejects `?token=`, compares SHA-256 digests with `timingSafeEqual`, validates `format=json|csv` and ISO `start`/`end`, then streams results in 500-row pages. CSV values are quoted and formula-leading values (`= + - @`) are prefixed with `'`.

`public/script.js` renders the Turnstile widget lazily on submit (`execution: 'execute'`, `appearance: 'interaction-only'`), bootstraps the site key from `/config`, posts JSON, sets a `localStorage` flag, and redirects to `/success.html`. Browser validation is UX only; the Worker is authoritative.

## Privacy invariants

Do not reintroduce respondent-linked identifiers. `survey_responses` holds answers, an optional comment, and a timestamp — nothing else. Migration `0001` deliberately dropped the original `ip_hash`/`user_agent` columns and the duplicate-guard index; the IP-derived value now exists only as an HMAC-SHA-256 throttle key in `submission_throttle`, never joined to answers.

Logging is `console.*` with a JSON `{ event }` object and at most an error *type*. Never log answers, comments, tokens, IPs, hashes, or user agents.

`/export` is the only read path and returns `EXPORT_COLUMNS` only — no throttle data.

## Changing the survey questions

Every answer allowlist is duplicated in four places and they must be changed together, or valid submissions will fail a D1 CHECK constraint:

1. `src/submit.js` — `VALID_OPTIONS`, `ACCEPTED_FIELDS`, `normalizePayload`, and the INSERT column list
2. `schema.sql` — CHECK constraints (local/dev DBs)
3. a **new** file in `migrations/` — never edit an applied migration (remote DBs)
4. `scripts/seed-synthetic-responses.mjs` — `OPTIONS` and the row builder

Then update `public/index.html` markup, `REQUIRED_RADIO_GROUPS` / `collectFormData` in `public/script.js`, `EXPORT_COLUMNS` in `src/export.js`, and both test suites.

Apply schema changes before deploying code that depends on them, and take a remote export plus a row count before `npm run db:apply` (see README).

## Synthetic data

`npm run seed:synthetic:dry-run` prints SQL to stdout and writes nothing. `npm run seed:synthetic` writes to the **remote** database via `wrangler d1 execute` — it is demo/development data, not a production smoke test, and must not be mixed with real respondents. `evidence/` is gitignored export output, not live state.

## Link previews

`public/index.html` holds the Open Graph / Twitter card tags. Crawlers do not resolve relative URLs, so `og:image`, `og:url`, and the canonical link must stay absolute `https://surveyapp.ink/…`.

The card art is `public/assets/social/og-image.svg`; the committed `og-image.png` beside it is the rendered artifact crawlers actually read (SVG is not accepted for `og:image`). Regenerate after any SVG edit:

```bash
rsvg-convert -w 1200 -h 630 -b '#171717' -f png \
  -o public/assets/social/og-image.png public/assets/social/og-image.svg
```

`withStaticHeaders` in `src/security.js` downgrades `Cross-Origin-Resource-Policy` to `cross-origin` for `image/*` responses only — the site-wide `same-origin` value blocks clients that hotlink the preview image. Facebook and LinkedIn cache previews hard; re-scrape in their debug tools after deploying tag or image changes.

## Note

`ALLOWED_ORIGINS` appears in `.dev.vars.example` but is not read anywhere in `src/` — `rejectCrossOrigin` permits same-origin only. Do not assume it works.
