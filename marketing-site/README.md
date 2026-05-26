# Index Casting — isolated marketing / landing site (`web.index-casting.com`)

This folder is intentionally **not** part of the Expo product bundle. It ships as a standalone Vite + React static site with its own dependencies, lockfile, and (recommended) **separate Vercel project**.

## Why this exists

- **`index-casting.com` / `www.index-casting.com`**: keep pointing at the existing Expo web export + current `vercel.json` at repo root (auth, invites, deep links, product SEO — unchanged).
- **`web.index-casting.com`**: Host only this build for marketing / informational pages.

## Local development

```bash
cd marketing-site
npm install   # uses marketing-site/package-lock.json only
npm run dev   # http://localhost:5173
npm run typecheck
npm run lint
npm run build
npm run preview
```

The main app at repo root is unaffected (separate `node_modules`).

## Build isolation (repo root)

Root `tsconfig.json` **excludes** `marketing-site/` so `npm run typecheck` in the product does not typecheck this subproject.

Root `eslint` / `jest` only target `src/` and `lib/` — this folder is outside those roots.

**Do not** merge `marketing-site` scripts into root `package.json` unless you consciously adopt a monorepo tool; the default setup keeps risk at zero.

## Vercel deploy (recommended architecture)

1. Create a **new** Vercel project (do **not** reuse the apex app project).
2. Connect the same GitHub repo.
3. **Root Directory**: `marketing-site`.
4. Framework Preset: **Other** (static) — Vercel reads `marketing-site/vercel.json`.
5. **Do not** add env vars copied from production auth unless strictly needed (this scaffold uses none).

This leaves the existing project’s **`/vercel.json`** (build → `npm run build` at repo root, output `dist` for Expo export) untouched when you configure the subdomain project with Root Directory `marketing-site`.

## DNS (manual — repo changes do not affect DNS)

In the DNS zone for `index-casting.com`, add a record for **`web`** following Vercel’s domain onboarding (typically a **CNAME** to `cname.vercel-dns.com` or the target Vercel displays after you attach `web.index-casting.com`).

Confirm the effective record with Vercel + your registrar; do **not** repoint apex or `www` for this rollout.

## SEO assets (landing domain only)

- `public/robots.txt`
- `public/sitemap.xml`
- Meta + OpenGraph placeholders in `index.html`

**Product visuals:** Cropped UI regions from the pitch deck live under `public/images/product/` (WebP). Regenerate with `python3 scripts/extract-pitch-visuals.py` after replacing the source PDF path in that script.

**Social preview:** `index.html` references `https://web.index-casting.com/images/product/hero-stack.webp` for Open Graph / Twitter.

Canonical is `https://web.index-casting.com/` in `index.html`.

### Relationship to `/trust` etc.

CTAs in `src/App.tsx` link to **`https://www.index-casting.com/...`** (product host) so OAuth / session flows remain on unchanged domains.

## `website-builder-setup` (risk note)

[`tenfoldmarc/website-builder-setup`](https://github.com/tenfoldmarc/website-builder-setup) is a **Claude Code skill**. Its flow can run `npm install framer-motion` **in the current working directory** — doing this at the **Expo repo root** risks polluting Expo/RN tooling.

Use any stack from that skill **only inside `marketing-site/`** (`cd marketing-site` first).

## Smoke checklist before go-live

- [ ] Apex app still builds from repo root (`npm run build`).
- [ ] Landing project builds (`cd marketing-site && npm run build`).
- [ ] `web.index-casting.com` serves this SPA; apex still serves the Expo web app.
- [ ] Supabase Redirect URLs untouched unless you knowingly add authenticated flows here.
