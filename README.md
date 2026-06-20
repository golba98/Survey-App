# survey-app

“Putting the South African Economy Into Perspective” is a Cloudflare Worker + static assets + D1 survey app for collecting anonymous grouped responses about cost of living and economic pressure in South Africa.

## Project Description

- Frontend: plain HTML, CSS, and JavaScript in `public/`
- Backend: Cloudflare Worker in `src/`
- Database: Cloudflare D1 bound as `DB`
- Privacy: no names, phone numbers, emails, exact addresses, or ID numbers are collected
- Duplicate prevention: uses a salted IP hash only; raw IP addresses are never stored

## File Structure

```text
25-survey-app/
├── public/
│   ├── index.html
│   ├── success.html
│   ├── styles.css
│   └── script.js
├── src/
│   ├── export.js
│   ├── index.js
│   ├── security.js
│   └── submit.js
├── schema.sql
├── wrangler.toml
├── package.json
└── README.md
```

- `public/index.html`: main survey form
- `public/success.html`: thank-you page after a successful submit
- `public/styles.css`: shared styling
- `public/script.js`: browser-side validation and form submission to `/submit`
- `src/index.js`: Worker entrypoint and request router
- `src/submit.js`: accepts `POST /submit`
- `src/export.js`: serves `GET /export`
- `src/security.js`: shared API/static headers, CORS, and error helpers
- `schema.sql`: D1 schema and indexes
- `wrangler.toml`: Worker, assets, and D1 configuration

## Survey Content

The app keeps these survey fields:

1. Age range
2. Status
3. Main monthly pressure
4. Cost of living increased
5. What have you cut back on
6. Work worry rating
7. Income/allowance keeps up rating
8. Monthly transport cost band
9. Monthly food/grocery cost band
10. Optional comment

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the D1 database

```bash
npm run db:create
```

The Worker is configured to use:

- Project name: `survey-app`
- D1 database name: `25-survey-app-db`
- D1 binding: `DB`
- D1 database ID: `eeca209b-e57d-45d7-a29c-ec2ef24e57dc`

### 4. Set local secrets

Create a `.dev.vars` file that is not committed:

```bash
cat > .dev.vars <<'EOF'
EXPORT_TOKEN=replace-with-a-local-export-token
IP_HASH_SECRET=replace-with-a-local-ip-hash-secret
TURNSTILE_SITE_KEY=replace-with-a-local-turnstile-site-key
TURNSTILE_SECRET_KEY=replace-with-a-local-turnstile-secret-key
ALLOWED_ORIGINS=http://localhost:8787,http://127.0.0.1:8787
EOF
```

Required secrets:

- `EXPORT_TOKEN`: required to access `/export`
- `IP_HASH_SECRET`: used to salt the stored IP hash for duplicate prevention and rate limiting
- `TURNSTILE_SECRET_KEY`: verifies Cloudflare Turnstile responses server-side

Required public variable:

- `TURNSTILE_SITE_KEY`: public Turnstile site key returned by `GET /config` for the browser widget

Optional variable:

- `ALLOWED_ORIGINS` (optional): comma-separated browser origins if you need to allow cross-origin requests beyond same-origin and local development

### 5. Apply the schema

```bash
npm run db:apply
```

### 6. Run locally

```bash
npm run dev
```

The app runs locally through `wrangler dev` with the Worker entrypoint and static assets.

## Worker Deployment

This app deploys as a Cloudflare Worker Git deployment with static assets and a D1 binding. It is not a Cloudflare Pages project.

Deploy manually with:

```bash
npm run deploy
```

That runs:

```bash
npx wrangler deploy
```

## Cloudflare Dashboard Build Settings

Use these exact settings in Cloudflare:

- Project type: Worker Git deployment
- Project name: `survey-app`
- Build command: empty
- Deploy command: `npx wrangler deploy`
- Non-production/version command: `npx wrangler versions upload`
- Path: `/`
- API token: `survey-app build token`

### Variables and secrets

Add these secrets:

- `EXPORT_TOKEN`
- `IP_HASH_SECRET`
- `TURNSTILE_SECRET_KEY`

Set them with:

```bash
npx wrangler secret put EXPORT_TOKEN
npx wrangler secret put IP_HASH_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Set this public variable:

- `TURNSTILE_SITE_KEY`: public Turnstile site key returned by `GET /config`

`TURNSTILE_SITE_KEY` is safe for browsers to see, but do not put it directly in `public/`.

Optional plain variable:

- `ALLOWED_ORIGINS`: comma-separated browser origins if you need cross-origin requests beyond same-origin and local development

### D1 binding

- Binding name: `DB`
- Database: `25-survey-app-db`

Apply the schema with:

```bash
npm run db:apply
```

If the D1 binding is missing in the dashboard, add it here:

`Workers & Pages → survey-app → Settings → Bindings → D1 database binding`

## Required Secrets

Do not hardcode secrets in source files.

- `EXPORT_TOKEN`
  - Used by `/export`
  - Send it only in the `Authorization: Bearer ...` header
- `IP_HASH_SECRET`
  - Used to salt the duplicate-prevention and rate-limit IP hash
  - Must be set in every environment where submissions are accepted
- `TURNSTILE_SECRET_KEY`
  - Used by `/submit` to verify Cloudflare Turnstile tokens server-side
  - Must never be sent to the browser

## Required Public Variables

- `TURNSTILE_SITE_KEY`
  - Public Turnstile site key for the browser widget
  - Served by the Worker from `GET /config`

## Optional Variables

- `ALLOWED_ORIGINS`
  - Optional allowlist for browser CORS
  - Format: comma-separated origins such as `https://example.com,https://admin.example.com`

## Security and Privacy

- No names, phone numbers, emails, exact addresses, or ID numbers are collected
- Raw IP addresses are never stored; only a salted hash is kept for duplicate and spam protection
- `/export` requires the `EXPORT_TOKEN` secret and does not expose data publicly
- `/export` rejects query-string tokens and requires a bearer token header
- `/submit` verifies Turnstile server-side before saving a response
- `/submit` rate limits by salted IP hash only; raw IP addresses are never stored
- D1 queries use prepared statements only
- Survey data should only be reported in grouped, anonymous form
- Comments are stored as plain text and are never rendered as HTML

## Export Endpoint Usage

Route:

```text
GET /export
```

Use an Authorization header. Do not put `EXPORT_TOKEN` in a query string.

```bash
curl -H "Authorization: Bearer $EXPORT_TOKEN" \
  "http://localhost:8787/export?format=json"

mkdir -p exports
curl -H "Authorization: Bearer $EXPORT_TOKEN" \
  "http://localhost:8787/export?format=csv" \
  -o exports/survey-export.csv
```

Query parameters:

- `format`: `json` or `csv`, default `json`
- `start`: optional `YYYY-MM-DD`
- `end`: optional `YYYY-MM-DD`

The export only includes survey response fields and excludes internal duplicate-prevention data. CSV cells are escaped for spreadsheet use, including prefixing formula-leading values such as `=`, `+`, `-`, and `@`.

## Testing `/submit` Locally

Turnstile requires a valid browser-issued token for normal submits. For manual browser testing:

1. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in `.dev.vars`.
2. Run `npm run db:apply:local`.
3. Run `npm run dev`.
4. Open `http://localhost:8787`, complete the Turnstile widget, and submit the form.

For API-level invalid payload checks:

```bash
curl -i -X POST "http://localhost:8787/submit" \
  -H "Content-Type: application/json" \
  --data '{"bad":"field"}'
```

That should return `400` with a generic error.

## Local Test Checklist

Run:

```bash
npm install
npm run dev
```

Then verify:

- Valid survey submit works and redirects to `/success.html`
- Invalid survey field is rejected with `400`
- Missing Turnstile token is rejected
- Repeated submissions from the same requester get `429`
- `/export` without an `Authorization` header returns `401`
- `/export` with the wrong bearer token returns `401`
- `/export` with `Authorization: Bearer $EXPORT_TOKEN` returns JSON or CSV data
- Query-string token access, such as `/export?token=...`, returns `401`
- No secrets appear in `public/`, browser devtools, built assets, or committed files
- Raw IP addresses are not stored in D1; only salted hashes are stored

## Cloudflare Retry Steps

1. Go to `Workers & Pages → survey-app`
2. Open `Settings`
3. Open `Builds & deployments`
4. Confirm:
   - Build command is empty
   - Deploy command is `npx wrangler deploy`
   - Non-production/version command is `npx wrangler versions upload`
   - Path is `/`
5. Open `Settings → Variables and Secrets` and confirm:
   - `EXPORT_TOKEN`
   - `IP_HASH_SECRET`
   - `TURNSTILE_SECRET_KEY`
   - `TURNSTILE_SITE_KEY`
   - optional `ALLOWED_ORIGINS`
6. Open `Settings → Bindings` and confirm:
   - `DB → 25-survey-app-db`
7. Retry the deployment from the latest Git build in the Cloudflare dashboard
