# Survey App

“Putting the South African Economy Into Perspective” is a Cloudflare Worker, static site, and D1 survey for grouped analysis of South African cost-of-living experiences.

## Architecture

- `public/`: accessible HTML, CSS, and browser-side validation
- `src/`: Worker routing, security headers, Turnstile verification, submission, and protected export
- `schema.sql`: canonical schema for new local databases
- `migrations/`: ordered D1 production migrations
- `wrangler.jsonc`: Worker, assets, public configuration, observability, and the existing `DB` binding

The application keeps the existing Cloudflare identities:

- Worker: `survey-app`
- D1 database: `25-survey-app-db`
- D1 binding: `DB`

## Privacy and security

Survey responses contain only the selected answers, optional comment, and submission timestamp. The application does not attach IP addresses, IP-derived values, or browser user-agent strings to response rows or exports.

For abuse prevention, `/submit`:

- validates strict field allowlists and a 16 KB request limit;
- verifies a single-use Turnstile token, hostname, and action server-side;
- derives an HMAC-SHA-256 network key using `IP_HASH_SECRET`;
- stores that key only in `submission_throttle`, separately from answers;
- allows three verified submissions per network per hour and removes throttle rows after 24 hours.

The browser runs the managed Turnstile widget only when the user submits. Its `interaction-only` appearance remains hidden unless Cloudflare requires a challenge.

`/export` requires `Authorization: Bearer <EXPORT_TOKEN>`, rejects query-string tokens, compares credentials in constant time, streams results in bounded pages, and protects CSV cells from spreadsheet formula execution.

## Local setup

Install dependencies and initialize local D1:

```bash
npm install
npm run db:apply:local
```

Create an ignored `.dev.vars` file:

```dotenv
EXPORT_TOKEN=replace-with-a-long-random-token
IP_HASH_SECRET=replace-with-a-long-random-secret
TURNSTILE_SECRET_KEY=replace-with-a-turnstile-test-secret
TURNSTILE_SITE_KEY=replace-with-a-turnstile-test-site-key
TURNSTILE_EXPECTED_HOSTNAME=localhost
```

The public production `TURNSTILE_SITE_KEY`, action `survey_submit`, and hostname `surveyapp.ink` are versioned in `wrangler.jsonc`; the matching secret remains in Cloudflare only.

Run the app:

```bash
npm run dev
```

## Database changes

Apply pending migrations remotely only after taking a private export and checking the row count:

```bash
npx wrangler d1 export 25-survey-app-db --remote --output /path/outside/repo/survey-backup.sql
npx wrangler d1 execute 25-survey-app-db --remote --command "SELECT count(*) AS count FROM survey_responses;"
npm run db:apply
```

The migration preserves survey answers while removing the historical `ip_hash`, `user_agent`, and duplicate-fingerprint index.

Synthetic data can be generated without writing anything:

```bash
npm run seed:synthetic:dry-run
```

`npm run seed:synthetic` writes synthetic answers to the remote database and must never be used as a production launch smoke test.

## Tests and validation

```bash
npm test
npm audit
npx wrangler deploy --dry-run
git diff --check
```

`npm test` runs both Node unit tests and Workers-runtime integration tests against an isolated real D1 database. Coverage includes validation, request size, origin checks, Turnstile hostname/action enforcement, D1 persistence without fingerprints, concurrent throttling, export authorization, streaming, and CSV safety.

## Deployment

Set production secrets without putting their values in files or shell history:

```bash
npx wrangler secret put EXPORT_TOKEN
npx wrangler secret put IP_HASH_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Deploy the exact reviewed commit:

```bash
npm run db:apply
npm run deploy
```

Production launch is complete only after:

1. `https://surveyapp.ink/config` returns the expected public site key and `survey_submit` action.
2. HTTP redirects permanently to HTTPS and HTTPS responses include HSTS/CSP headers.
3. A real browser submission is found in D1 with every expected answer.
4. That uniquely marked smoke row is deleted and the database count returns to its baseline.
5. Authorized JSON/CSV export works and does not include throttle data.
6. Production logs contain event names only, with no answers, tokens, addresses, hashes, or user-agents.

If rollback is required before public traffic begins, restore the private D1 export and roll back the Worker version together. After real responses begin arriving, prefer a forward fix so new responses are not lost.
