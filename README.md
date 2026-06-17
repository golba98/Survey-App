# survey-app

“Putting the South African Economy Into Perspective” is a Cloudflare Pages + Functions + D1 survey app for collecting anonymous grouped responses about cost of living and economic pressure in South Africa.

## Project Description

- Frontend: plain HTML, CSS, and JavaScript in `public/`
- Backend: Cloudflare Pages Functions in `functions/`
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
├── functions/
│   ├── submit.js
│   └── export.js
├── schema.sql
├── wrangler.toml
├── package.json
├── .gitignore
└── README.md
```

- `public/index.html`: main survey form
- `public/success.html`: thank-you page after a successful submit
- `public/styles.css`: shared styling
- `public/script.js`: browser-side validation and form submission
- `functions/submit.js`: accepts `POST /submit`
- `functions/export.js`: serves `GET /export`
- `schema.sql`: D1 schema and indexes
- `wrangler.toml`: Cloudflare Pages and D1 configuration

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

Copy the real database ID from the command output and replace `YOUR_D1_DATABASE_ID_HERE` in `wrangler.toml`.

### 4. Set required secrets

```bash
npx wrangler pages secret put EXPORT_TOKEN
npx wrangler pages secret put IP_HASH_SECRET
```

Required secrets:

- `EXPORT_TOKEN`: required to access `/export`
- `IP_HASH_SECRET`: used to salt the stored IP hash for duplicate prevention
- `ALLOWED_ORIGINS` (optional): comma-separated browser origins if you need to allow cross-origin requests beyond same-origin and local development

### 5. Apply the schema

```bash
npm run db:apply
```

### 6. Run locally

```bash
npm run dev
```

The app will run locally with Pages Functions and D1 bindings through Wrangler.

## D1 Database Creation

The included script creates a database named `25-survey-app-db`:

```bash
npm run db:create
```

If you use a different D1 name manually, keep the binding name `DB` and update scripts or commands accordingly.

## Schema Application

Apply the database schema after creating the database and setting the real database ID:

```bash
npm run db:apply
```

This creates the `survey_responses` table and indexes used for timestamp filtering and duplicate prevention.

If you already created a D1 database with the older schema, the simplest path is to create a fresh D1 database and apply the updated `schema.sql` before using the hardened handlers.

## Cloudflare Pages Deployment

Deploy the project with:

```bash
npm run deploy
```

That command publishes the `public/` directory and the `functions/` directory together as a Pages project named `25-survey-app`.

If you deploy through the Cloudflare dashboard instead:

- Build command: none
- Output directory: `public`
- Ensure the repo also includes the `functions/` directory
- Add the same secrets in the Pages project settings
- Add the same D1 binding named `DB`

## Required Secrets

Do not hardcode secrets in source files.

- `EXPORT_TOKEN`
  - Used by `/export`
  - Pass it as the `token` query parameter
- `IP_HASH_SECRET`
  - Used to salt the duplicate-prevention IP hash
  - Must be set in every environment where submissions are accepted
- `ALLOWED_ORIGINS`
  - Optional allowlist for browser CORS
  - Format: comma-separated origins such as `https://example.com,https://admin.example.com`

## Security and Privacy

- No names, phone numbers, emails, exact addresses, or ID numbers are collected
- Raw IP addresses are never stored; only a salted hash is kept for duplicate and spam protection
- `/export` requires the `EXPORT_TOKEN` secret and does not expose data publicly
- D1 queries use prepared statements only
- Survey data should only be reported in grouped, anonymous form
- Comments are stored as plain text and are never rendered as HTML

## Export Endpoint Usage

Route:

```text
GET /export
```

Query parameters:

- `token`: required
- `format`: `json` or `csv`, default `json`
- `start`: optional `YYYY-MM-DD`
- `end`: optional `YYYY-MM-DD`

The export only includes survey response fields and excludes internal duplicate-prevention data.

## CSV/JSON Export Examples

JSON:

```bash
curl "https://your-project.pages.dev/export?token=YOUR_EXPORT_TOKEN"
```

CSV:

```bash
curl "https://your-project.pages.dev/export?format=csv&token=YOUR_EXPORT_TOKEN"
```

Date-filtered CSV:

```bash
curl "https://your-project.pages.dev/export?format=csv&start=2026-01-01&end=2026-12-31&token=YOUR_EXPORT_TOKEN"
```

## Basic Testing Checklist

- Open `/` and confirm the survey loads correctly
- Confirm `styles.css` and `script.js` load from the same directory as `index.html`
- Submit a valid response and confirm the frontend posts to `/submit`
- Confirm successful submission redirects to `/success.html`
- Leave required fields blank and confirm validation blocks submission
- Submit invalid rating values and confirm the server rejects them
- Submit unknown answer option values and confirm the server rejects them
- Submit a comment longer than 500 characters and confirm the server rejects it
- Submit unexpected extra JSON fields and confirm the server rejects them
- Submit repeated attempts quickly and confirm the throttle responds without breaking normal use
- Submit twice from the same browser and confirm duplicate protection blocks the second submission
- Confirm `/export` rejects requests without a valid `token`
- Confirm `/export` rejects requests with a wrong token
- Confirm `/export?format=json&token=...` returns JSON
- Confirm `/export?format=csv&token=...` returns CSV
- Confirm the D1 binding name is `DB` everywhere
- Confirm no raw IP is stored in D1

## Manual Setup Still Required

- Replace the placeholder D1 database ID in `wrangler.toml`
- Create the `EXPORT_TOKEN` secret
- Create the `IP_HASH_SECRET` secret
- Log in to Cloudflare before running database or deploy commands

## Local Security Setup

For local development, create a `.dev.vars` file that is not committed:

```bash
cat > .dev.vars <<'EOF'
EXPORT_TOKEN=replace-with-a-local-export-token
IP_HASH_SECRET=replace-with-a-local-ip-hash-secret
ALLOWED_ORIGINS=http://localhost:8788,http://127.0.0.1:8788
EOF
```

Set production secrets with:

```bash
npx wrangler pages secret put EXPORT_TOKEN
npx wrangler pages secret put IP_HASH_SECRET
```

Run locally with:

```bash
npm run dev
```

Manual local security tests:

```bash
curl -i "http://localhost:8788/export"
curl -i "http://localhost:8788/export?token=wrong-token"
curl -i "http://localhost:8788/export?token=replace-with-a-local-export-token"
```
```
