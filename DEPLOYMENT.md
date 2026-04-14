# Deployment Guide — Career Catalyst

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (starts with `sk-ant-`). Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys). |

## Local Development

```bash
# 1. Install
npm install

# 2. Create .env with your API key
cp .env.example .env
# Edit .env and paste your key

# 3. Run dev server (frontend only — API route needs Vercel CLI)
npm run dev

# 4. For full-stack local preview with the API route:
npx vercel dev
```

The `vercel dev` command runs both the Vite dev server and the `/api/claude` serverless function locally. The plain `npm run dev` runs only the frontend — API calls will fail without the serverless route.

## Deploy to Vercel

### Option A — Git (recommended)

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new), import your repo.
3. Vercel auto-detects Vite. Settings should be:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Framework Preset:** Vite
4. Add environment variable: `ANTHROPIC_API_KEY` = your key.
5. Deploy.

### Option B — CLI

```bash
npm i -g vercel
vercel --prod
# Follow prompts. Add ANTHROPIC_API_KEY in Vercel dashboard → Settings → Environment Variables.
```

## Architecture

```
career-catalyst-vercel/
├── api/
│   └── claude.js          # Vercel serverless function — proxies to Anthropic
├── src/
│   ├── App.jsx            # Full React app
│   └── main.jsx           # React mount
├── index.html             # Entry HTML
├── vercel.json            # Vercel routing config
├── package.json
├── vite.config.js
├── .env.example
└── DEPLOYMENT.md          # This file
```

**Frontend** (`src/App.jsx`) calls `POST /api/claude` with `{ model, max_tokens, system, messages }`.

**Backend** (`api/claude.js`) injects `ANTHROPIC_API_KEY` and `anthropic-version` headers, forwards to `https://api.anthropic.com/v1/messages`, and returns the response as-is. No API key is ever exposed to the browser.

## Share Links

Share links use `localStorage` and only work on the same device/browser. The link format is `https://your-site.vercel.app/#cc_xxxxx`. The share UI makes this explicit: "Link copied (same device)".

For cross-device sharing, a database-backed share system (e.g. Vercel KV or Supabase) would be needed — not included in this version.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "API route not found" | `/api/claude` not deployed | Run `vercel dev` locally, or check Vercel deployment includes the `api/` folder |
| "Server not configured" | Missing `ANTHROPIC_API_KEY` | Add it in Vercel dashboard → Settings → Environment Variables → Redeploy |
| "Too many requests" | Anthropic rate limit | Wait 60s and retry. App auto-falls back from Sonnet to Haiku |
| "AI quota exceeded" | Anthropic billing/plan limit | Check your Anthropic dashboard usage |
