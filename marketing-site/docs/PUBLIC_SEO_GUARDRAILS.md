# Public / SEO guardrails (marketing & future public pages)

**Scope:** Future public agency or org pages are **not** part of this static marketing site today. When/if they ship:

- **Index only with explicit consent:** Public agency (or org) profile URLs must be emitted to crawlers **only** when the org has turned on a dedicated **public profile** flag server-side.
- **No private models:** Model rows, applications, DMs, and non-public media must never appear on indexable HTML or in `sitemap.xml`.
- **No tokenized links:** Guest links, shared selections, invites, magic links, or other capability URLs must **not** be linked from sitemaps, hero copy, or structured data.
- **Canonical URLs:** Every indexable public page needs a single canonical URL; avoid duplicate parameter variants in search consoles.
- **Structured data:** Add JSON-LD **only** for non-sensitive public org facts (e.g. name, public description) after legal/product review — not for internal IDs, emails, or rosters.

**This repo’s marketing `public/sitemap.xml`:** intentionally contains **only** the landing URL `https://web.index-casting.com/` — no app deep links, no org slugs.
