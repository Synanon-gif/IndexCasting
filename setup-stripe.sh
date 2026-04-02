#!/usr/bin/env bash
# =============================================================================
# IndexCasting – Stripe & Supabase Setup Script
#
# Führt alle notwendigen Schritte aus, um das Stripe-Paywall-System zu aktivieren:
#   1. Supabase Secrets setzen (alle Stripe Price IDs bereits vorausgefüllt)
#   2. Edge Functions deployen
#
# Voraussetzung: Supabase CLI installiert (brew install supabase/tap/supabase)
# Ausführen: chmod +x setup-stripe.sh && ./setup-stripe.sh
# =============================================================================

set -e

# ── Farben ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "========================================"
echo "  IndexCasting – Stripe Setup"
echo "========================================"
echo ""

# ── Supabase CLI prüfen ──────────────────────────────────────────────────────
if ! command -v supabase &> /dev/null; then
  error "Supabase CLI nicht gefunden. Installiere es mit: brew install supabase/tap/supabase"
fi
success "Supabase CLI gefunden: $(supabase --version 2>&1 | head -1)"

# ── Projekt-Konfiguration (bereits bekannt) ──────────────────────────────────
PROJECT_REF="ispkfdqzjrfrilosoklu"
SUPABASE_URL="https://ispkfdqzjrfrilosoklu.supabase.co"

# Stripe Price IDs (automatisch aus Stripe abgerufen – bereits korrekt)
STRIPE_PRICE_AGENCY_BASIC="price_1THVhTIRoAfaI5JWijxt5g33"
STRIPE_PRICE_AGENCY_PRO="price_1THVipIRoAfaI5JWhzlko8NA"
STRIPE_PRICE_AGENCY_ENTERPRISE="price_1THVjhIRoAfaI5JWKy8lURkO"
STRIPE_PRICE_CLIENT="price_1THVvxIRoAfaI5JWdCmiqiYA"
APP_URL="https://indexcasting.com"

echo ""
info "Projekt: $PROJECT_REF ($SUPABASE_URL)"
echo ""

# ── Supabase Login ───────────────────────────────────────────────────────────
echo "SCHRITT 1: Supabase Login"
echo "--------------------------"
echo "Du brauchst ein Supabase Personal Access Token:"
echo "  → https://supabase.com/dashboard/account/tokens"
echo ""
read -rsp "Supabase Access Token (sbp_...): " SUPABASE_ACCESS_TOKEN
echo ""

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  error "Kein Token eingegeben. Abbruch."
fi

supabase login --token "$SUPABASE_ACCESS_TOKEN"
success "Supabase Login erfolgreich"

# ── Stripe Secret Key ────────────────────────────────────────────────────────
echo ""
echo "SCHRITT 2: Stripe Secret Key"
echo "-----------------------------"
echo "Dein Stripe Secret Key (Test: sk_test_..., Live: sk_live_...):"
echo "  → https://dashboard.stripe.com/acct_1THVYCIRoAfaI5JW/apikeys"
echo ""
read -rsp "Stripe Secret Key: " STRIPE_SECRET_KEY
echo ""

if [ -z "$STRIPE_SECRET_KEY" ]; then
  error "Kein Stripe Secret Key eingegeben. Abbruch."
fi

# ── Stripe Webhook Secret ────────────────────────────────────────────────────
echo ""
echo "SCHRITT 3: Stripe Webhook Secret"
echo "----------------------------------"
echo "Webhook Secret (whsec_...) aus dem Stripe Dashboard."
echo "Falls du den Webhook noch nicht erstellt hast:"
echo ""
echo "  1. Gehe zu: https://dashboard.stripe.com/test/webhooks"
echo "  2. Klicke 'Add endpoint'"
echo "  3. URL: ${SUPABASE_URL}/functions/v1/stripe-webhook"
echo "  4. Events auswählen:"
echo "     - checkout.session.completed"
echo "     - customer.subscription.updated"
echo "     - customer.subscription.deleted"
echo "     - invoice.paid"
echo "  5. Klicke 'Add endpoint'"
echo "  6. Kopiere das 'Signing secret' (whsec_...)"
echo ""
read -rsp "Stripe Webhook Secret (whsec_...): " STRIPE_WEBHOOK_SECRET
echo ""

if [ -z "$STRIPE_WEBHOOK_SECRET" ]; then
  warn "Kein Webhook Secret eingegeben – STRIPE_WEBHOOK_SECRET wird nicht gesetzt."
  warn "Die stripe-webhook Function wird ohne Signatur-Verifikation nicht funktionieren."
fi

# ── Supabase Anon Key ────────────────────────────────────────────────────────
# Aus .env.local lesen falls vorhanden
ENV_LOCAL_ANON_KEY=$(grep "EXPO_PUBLIC_SUPABASE_ANON_KEY=" .env.local 2>/dev/null | cut -d'=' -f2)
SUPABASE_ANON_KEY="${ENV_LOCAL_ANON_KEY:-}"

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo ""
  echo "SCHRITT 3b: Supabase Anon Key"
  echo "-------------------------------"
  read -rsp "Supabase Anon Key (eyJ...): " SUPABASE_ANON_KEY
  echo ""
fi

# ── Secrets in Supabase setzen ───────────────────────────────────────────────
echo ""
echo "SCHRITT 4: Secrets in Supabase setzen"
echo "---------------------------------------"

cd "$(dirname "$0")"

supabase secrets set \
  --project-ref "$PROJECT_REF" \
  STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  STRIPE_PRICE_AGENCY_BASIC="$STRIPE_PRICE_AGENCY_BASIC" \
  STRIPE_PRICE_AGENCY_PRO="$STRIPE_PRICE_AGENCY_PRO" \
  STRIPE_PRICE_AGENCY_ENTERPRISE="$STRIPE_PRICE_AGENCY_ENTERPRISE" \
  STRIPE_PRICE_CLIENT="$STRIPE_PRICE_CLIENT" \
  APP_URL="$APP_URL" \
  SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"

if [ -n "$STRIPE_WEBHOOK_SECRET" ]; then
  supabase secrets set \
    --project-ref "$PROJECT_REF" \
    STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET"
fi

success "Alle Secrets gesetzt"

# ── Edge Functions deployen ──────────────────────────────────────────────────
echo ""
echo "SCHRITT 5: Edge Functions deployen"
echo "------------------------------------"

supabase functions deploy create-checkout-session \
  --project-ref "$PROJECT_REF"
success "create-checkout-session deployed"

supabase functions deploy stripe-webhook \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt
success "stripe-webhook deployed (no-verify-jwt)"

# ── Zusammenfassung ──────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo -e "${GREEN}  Setup abgeschlossen!${NC}"
echo "========================================"
echo ""
echo "Nächste Schritte (manuell in Supabase SQL Editor):"
echo ""
echo "  1. supabase/migration_paywall_billing.sql ausführen"
echo "  2. supabase/migration_client_paywall.sql ausführen"
echo ""
echo "SQL Editor: https://supabase.com/dashboard/project/$PROJECT_REF/sql/new"
echo ""
echo "Gesetzter Webhook-Endpoint:"
echo "  ${SUPABASE_URL}/functions/v1/stripe-webhook"
echo ""
