#!/usr/bin/env bash
# Erzeugt eine einzelne .txt mit nahezu allen Projekt-Textdateien für LLM-Upload.
# Ausgeschlossen: Secrets, node_modules, Build-Artefakte, Binärmedien, package-lock.json (sehr groß).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="${1:-$ROOT/PROJECT_CONTEXT_FOR_CHATGPT.txt}"
TMP="$(mktemp)"

{
  echo "================================================================================"
  echo "INDEXCASTING — VOLLSTÄNDIGER PROJEKT-KONTEXT (automatisch generiert)"
  echo "Generiert: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "WARNUNG: Keine .env-Inhalte — lokale Secrets separat pflegen."
  echo "HINWEIS: package-lock.json ist weggelassen (zu groß). Bei Bedarf manuell anhängen."
  echo "================================================================================"
  echo ""

  # Wichtige Root-Dateien zuerst
  for f in .cursorrules README.md README.txt package.json tsconfig.json vercel.json \
           app.json app.config.js app.config.ts index.html jest.config.cjs \
           capacitor.config.ts eslint.config.js eslint.config.mjs .prettierrc .prettierignore; do
    [[ -f "$ROOT/$f" ]] || continue
    echo ""
    echo "================================================================================"
    echo "FILE: $f"
    echo "================================================================================"
    cat "$ROOT/$f"
    echo ""
  done

  # Rest: sortiert, mit Ausschlüssen
  find "$ROOT" -type f \( \
    -name '*.ts' -o -name '*.tsx' -o -name '*.sql' -o -name '*.md' -o -name '*.mdc' \
    -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' -o -name '*.html' \
    -o -name '*.toml' -o -name '*.cjs' -o -name '*.sh' -o -name '*.txt' \
    -o -name '*.css' -o -name '*.mjs' \
    -o -name '.cursorrules' -o -name '.gitignore' -o -name 'Dockerfile' \
    -o -name 'Makefile' -o -name 'Procfile' -o -name '.nvmrc' \
  \) 2>/dev/null \
    | grep -v node_modules \
    | grep -v '/.git/' \
    | grep -v "$ROOT/dist/" \
    | grep -v "$ROOT/web-build/" \
    | grep -v "$ROOT/.expo/" \
    | grep -v "$ROOT/test-results/" \
    | grep -v "$ROOT/playwright-report/" \
    | grep -v "$ROOT/blob-report/" \
    | grep -v '/ios/' \
    | grep -v '/android/' \
    | grep -v 'package-lock.json' \
    | grep -v '/PROJECT_CONTEXT_FOR_CHATGPT.txt$' \
    | grep -v '\.env' \
    | grep -v '\.pem$' \
    | grep -v '\.p12$' \
    | grep -v '\.key$' \
    | grep -v '\.jks$' \
    | grep -v '\.png$' \
    | grep -v '\.jpg$' \
    | grep -v '\.jpeg$' \
    | grep -v '\.gif$' \
    | grep -v '\.webp$' \
    | grep -v '\.ico$' \
    | grep -v '\.woff' \
    | grep -v '\.ttf$' \
    | grep -v '\.mp4$' \
    | grep -v '\.pdf$' \
    | sort -u \
    | while IFS= read -r path; do
        rel="${path#$ROOT/}"
        # Root-Dateien schon oben
        case "$rel" in
          .cursorrules|.gitignore|README.md|README.txt|package.json|tsconfig.json|vercel.json|app.json|app.config.js|app.config.ts|index.html|jest.config.cjs|capacitor.config.ts|eslint.config.js|eslint.config.mjs|.prettierrc|.prettierignore) continue ;;
        esac
        echo ""
        echo "================================================================================"
        echo "FILE: $rel"
        echo "================================================================================"
        cat "$path" || echo "<<< FEHLER beim Lesen >>>"
        echo ""
      done

} > "$TMP"

mv "$TMP" "$OUT"
BYTES=$(wc -c < "$OUT" | tr -d ' ')
LINES=$(wc -l < "$OUT" | tr -d ' ')
echo "OK: $OUT"
echo "    Zeilen: $LINES  Bytes: $BYTES"
