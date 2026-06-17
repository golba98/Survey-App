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
ALLOWED_ORIGINS=http://localhost:8787,http://127.0.0.1:8787
EOF
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
- `ALLOWED_ORIGINS` (optional)

Set them with:

```bash
npx wrangler secret put EXPORT_TOKEN
npx wrangler secret put IP_HASH_SECRET
npx wrangler secret put ALLOWED_ORIGINS
```

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

Example URLs:

```text
/export?format=json&token=YOUR_TOKEN
/export?format=csv&token=YOUR_TOKEN
```

Query parameters:

- `token`: required
- `format`: `json` or `csv`, default `json`
- `start`: optional `YYYY-MM-DD`
- `end`: optional `YYYY-MM-DD`

The export only includes survey response fields and excludes internal duplicate-prevention data.

## Local Test Checklist

Run:

```bash
npm install
npm run dev
```

Then verify:

- Open the local Worker URL
- Submit a valid response and confirm the frontend posts to `/submit`
- Confirm successful submission redirects to `/success.html`
- Confirm `/export?format=json&token=YOUR_LOCAL_TOKEN` returns JSON
- Confirm `/export?format=csv&token=YOUR_LOCAL_TOKEN` returns CSV
- Confirm an invalid export token returns `401`
- Confirm duplicate submission protection blocks the second submission
- Confirm repeated attempts quickly trigger throttling without storing raw IP addresses

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
   - optional `ALLOWED_ORIGINS`
6. Open `Settings → Bindings` and confirm:
   - `DB → 25-survey-app-db`
7. Retry the deployment from the latest Git build in the Cloudflare dashboard
