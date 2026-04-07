# CI audit gate and drift baseline

GitHub Actions (`.github/workflows/ci.yml`) runs `npm run audit:coverage` with:

- `AUDIT_FAIL_ON_DRIFT=1` — fails if new forbidden `supabase.from(` sites appear or tracked **critical-path** files change hash vs `docs/AUDIT_DRIFT_BASELINE.json`.
- `AUDIT_CI_ENFORCE=1` — fails if:
  - `docs/AUDIT_DRIFT_BASELINE.json` is missing (`no_baseline`),
  - any production (non-`__tests__`) `void …catch(` remains (excluding lines containing `Linking.openURL`, which are ignored by the scanner),
  - any **`supabase.storage.from(…).upload(`** chain exists outside the allowlist in `scripts/audit-coverage.mjs` (`STORAGE_UPLOAD_ALLOWLIST`, aligned with `.cursor/rules/upload-consent-matrix.mdc`). Signed URLs, `list`, and `remove` are not gated by this rule.

Optional strict mode (not enabled in CI by default): `AUDIT_FAIL_ON_ANY_FORBIDDEN=1` fails while **any** forbidden `supabase.from(` site exists (zero-tolerance).

## Updating the baseline after intentional changes

When you deliberately change critical paths or the set of forbidden `supabase.from` lines (e.g. after moving UI code to services):

```bash
# After typecheck, lint, and tests are green locally:
AUDIT_WRITE_BASELINE=1 npm run audit:coverage
```

Then commit the updated `docs/AUDIT_DRIFT_BASELINE.json` in the same PR as the code change. **Security review** is expected when that file changes (see pull request template).

## Local runs

- Report only (default): `npm run audit:coverage`
- Match CI enforcement locally: `AUDIT_FAIL_ON_DRIFT=1 AUDIT_CI_ENFORCE=1 npm run audit:coverage`

Outputs are written under `docs/` (dated manifest JSON/MD, `SYSTEM_AUDIT_REPORT_*.md`, plus `AUDIT_DEPENDENCY_GRAPH.json` / `AUDIT_EXPORT_MAP.json`).
