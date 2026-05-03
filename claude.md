# CLAUDE.md — IndexCasting AI Working Rules

## Project

Active repo:

/Users/Harry/Indexcasting/IndexCasting

This is a production-grade React + Expo web/mobile app with Supabase, Stripe, billing, chat, option requests, calendars, models, agencies, clients, and role-based access.

Do not treat this as a toy project.

---

## Default mode

Default assumption for every task:

UI ONLY. NO BACKEND CHANGES.

If backend/service/database changes seem necessary, stop and ask before editing.

---

## Hard no-touch areas unless explicitly allowed

Never modify without explicit permission:

- supabase/
- supabase/migrations/
- supabase/functions/
- src/services/
- src/store/
- src/context/AuthContext.tsx
- Stripe / billing mutations / paywalls
- auth / roles / permissions
- chat / messaging / realtime
- database schema
- RPC calls
- RLS policies
- Edge Functions
- deployment / hosting config
- package dependencies

---

## Allowed areas for normal UI work

Prefer small changes in:

- src/components/
- src/views/
- src/screens/
- src/web/
- src/constants/uiCopy.ts
- UI-only helper functions

---

## Required workflow

Before editing:

1. Identify the exact rendered screen.
2. Confirm whether it is web or mobile.
3. List files that need inspection.
4. Explain the likely root cause.
5. Propose the minimal fix.
6. Ask before expanding scope.

When editing:

1. Touch as few files as possible.
2. Do not refactor unrelated code.
3. Preserve existing behavior.
4. Do not change data writes.
5. Do not change validation or persistence unless explicitly requested.
6. Do not invent new services.

After editing:

1. List changed files.
2. Explain exact changes.
3. Confirm no forbidden files were touched.
4. Give manual test steps.
5. Do not tell the user to commit until UI was verified.

---

## Plan-first rule

For every non-trivial task, start with analysis/plan only.

Use this structure:

1. Files inspected
2. Exact root cause
3. Safe fix
4. Risks
5. Implementation plan
6. Allowed files

Only implement after user approval.

---

## Billing and invoice safety

Billing is critical.

For billing/manual invoice work:

- Do not change invoice persistence unless explicitly requested.
- Do not change Supabase services unless explicitly requested.
- Do not change Stripe logic.
- Prefer UI/copy fixes first.
- Keep sender/recipient profile systems separate unless an explicit migration plan exists.
- Any data copy/import must use existing service functions only.

---

## Git rules

The team works in parallel via GitHub.

Standard flow:

git pull --rebase origin main
git add .
git commit -m "type(scope): concise description"
git pull --rebase origin main
git push

If conflicts happen, stop and ask.

Use commit messages like:

- fix(billing): clarify manual invoice profile selection
- feat(web): add carousel arrows to discover cards
- fix(ui): mark missing invoice fields
- docs: add claude working rules

Never use vague messages like:

- update
- fix
- changes
- test

---

## Testing rules

For visual UI changes:

1. Test locally in browser first.
2. Then commit and push.
3. Then verify live deployment.

Do not treat unrelated global npm test failures as proof that a small UI change broke something unless failures reference changed files.

---

## Current architecture facts

- Hosted web app uses src/web/ClientWebApp.tsx.
- Mobile/navigation screens may not be rendered in the hosted web app.
- Billing hub has separate automated/org billing profiles and manual invoice profiles.
- Manual invoice sender profiles use manual_billing_agency_profiles.
- Org billing profiles use organization_billing_profiles.
- These two profile systems must not be mixed directly because manual invoices depend on manual profile IDs.