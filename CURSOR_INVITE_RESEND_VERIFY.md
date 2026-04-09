# Invite Re-send Verify Checklist

## Preconditions
- Sign in as Agency Owner for Booker + Model claim checks.
- Sign in as Client Owner for Employee checks.
- Ensure at least one pending invite exists per flow.

## 1) Booker invite resend
- Create a Booker invite once.
- Open Agency team pending invitations.
- Click **Resend invite** on the pending row.
- Expected:
  - Button shows loading state briefly.
  - Success alert appears: "Invite sent again".
  - Existing invite token/link remains unchanged.

## 2) Employee invite resend
- Create an Employee invite once.
- Open Client team pending invitations.
- Click **Resend invite** on the pending row.
- Expected:
  - Button shows loading state briefly.
  - Success alert appears: "Invite sent again".
  - Existing invite token/link remains unchanged.

## 3) Model claim resend (existing token only)
- Ensure model is in pending-link state with email.
- Click **Resend invite** in model roster row.
- Expected:
  - System reuses active token from `model_claim_tokens`.
  - No new token is generated.
  - On failure, manual claim link fallback is shown with same token.

## 4) Failure behavior
- Simulate send failure (e.g. provider disabled / wrong delivery setup).
- Trigger resend on any flow.
- Expected:
  - Error alert uses mapped failure reason.
  - Fallback link is shown for org invites/model claim where token is available.
  - Optional hint asks recipient to check spam/junk folder.
