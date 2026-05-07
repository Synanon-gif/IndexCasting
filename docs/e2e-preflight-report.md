# E2E preflight report

- **Generated:** 2026-05-07T14:43:38.701Z
- **baseUrlClass:** hosted
- **e2eBaseHost (host only):** www.index-casting.com

## Environment (presence only — no secret values)

- **.env.e2e present:** true
- **password vars configured:** true
- **password vars aligned:** true
- **seed manifest present:** true
- **parity line:** none

## Reachability & auth chrome

- GET / → HTTP 200 (acceptable)
- Auth email field visible after prepareAuth: true

## Login probe by role

### Agency owner (B2B)
- **ok:** true
- **errorCode:** —
- **suspectedCause:** —
- **notes:** workspace hints: Dashboard, Logout

### Client owner (B2B)
- **ok:** true
- **errorCode:** —
- **suspectedCause:** —
- **notes:** workspace hints: Dashboard, Logout

### Linked model
- **ok:** true
- **errorCode:** —
- **suspectedCause:** —
- **notes:** workspace hints: Logout

## Recommendation

- B2B preflight **passed** — safe to run `e2e:b2b` / `e2e:p0` (write gates still off unless you enable them).

### Suspected cause legend

| Value | Meaning |
|-------|---------|
| wrong_password | Missing/mismatched `PLAYWRIGHT_TEST_PASSWORD` / `E2E_SEED_USER_PASSWORD` |
| user_missing_in_supabase | User for role likely absent on target project (use seed or check emails) |
| seed_db_mismatch | `POSSIBLE ENV PARITY MISMATCH` or STUCK_SIGNUP with manifest/env host skew |
| legal_gate_stuck | Terms/legal acceptance not dismissible |
| signup_mode_stuck | `E2E_AUTH_STUCK_SIGNUP` without parity line |
| selector_drift | Timeouts / shell not found — harness may need map updates |
| shell_timeout | `E2E_AUTH_SHELL_TIMEOUT` |
| unknown | See notes |

