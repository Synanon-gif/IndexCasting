# Option/Casting Status UX Report

## 1) Executive Summary
- Die Statussprache wurde auf Anzeigeebene vereinheitlicht, ohne Business-Logik oder DB-Statuswerte zu ändern.
- Einheitliche Kernbegriffe sind jetzt in den betroffenen Oberflächen konsistenter: `In negotiation`, `Confirmed`, `Rejected`, `Job confirmed`, `Pending model approval`, `Action required`.
- Alle Änderungen bleiben UX-only: Copy, Mapping, Badge-/Pill-Texte.

## 2) Vorher/Nachher der Statussprache
- Vorher:
  - Model Inbox zeigte `Draft/Sent/Confirmed/Rejected` via `statusHelpers`.
  - Messages/Threads zeigten `In negotiation/Confirmed/Rejected`.
  - Zusätzliche Status-/Approval-Texte waren teils hardcoded und uneinheitlich (`Model ✓`, `Model OK`, `Approved by Model ✓`, `No model app`, `Confirmed (pending job)`).
- Nachher:
  - `statusHelpers` nutzt für `in_negotiation` jetzt `In negotiation` (statt `Sent`).
  - Approval-/Final-Status-Texte wurden zentral in `uiCopy.dashboard` konsolidiert und in den betroffenen Views aus `uiCopy` bezogen.
  - Thread-Kontextlabels (`Option`/`Casting`) und Final-Status (`Confirmed`/`Job confirmed`/`Pending`) sind konsistent benannt.

## 3) Harmonisiert
- Einheitliches Verhandlungslabel statt Synonym-Mix:
  - `Sent` -> `In negotiation` in relevanten Option-Listen/Badges.
- Einheitliche Model-Approval-Sprache:
  - `Model ✓`, `Model OK`, `Approved by Model ✓`, `Model ⏳`, `Model ✗` -> zentrale Labels aus `uiCopy`.
- Einheitliche Final-Status-Sprache:
  - `Job confirmed`, `Confirmed`, `Pending` zentralisiert.
- Konsistente Kontextsprache:
  - `Option`/`Casting` aus zentralen `uiCopy`-Keys.

## 4) Bewusst unterschiedlich geblieben
- `status` (Verhandlung), `model_approval` (Model-Freigabe) und `final_status` (Lifecycle-Finale) bleiben getrennte fachliche Ebenen.
- `Draft` in der Model-Inbox bleibt als Display-Abstraktion erhalten, um bestehende UI-Semantik nicht zu brechen.
- Farblogik/Badgestruktur wurde nicht fachlich umgebaut, nur sprachlich vereinheitlicht.

## 5) Warum keine Business-Logik geändert wurde
- Keine Änderung an DB-Feldern oder deren Auswertung:
  - `status`, `final_status`, `model_approval` unverändert.
- Keine Änderungen an Stores, Mutations, RPC-Aufrufen, Triggern, RLS oder Query-Branches.
- Nur Anzeige-Mapping und Copy-Herkunft (Hardcodes -> `uiCopy`) angepasst.

## 6) Warum Auth/Admin/Login unberührt blieb
- Keine Änderungen in:
  - `App.tsx`
  - `src/context/AuthContext.tsx`
  - Login-/Admin-/Paywall-Entscheidungspfaden.
- Keine Änderung an Routing, Guards oder Rollenlogik.

## 7) Nächste kleine sinnvolle Schritte
- Optional: kleinen reinen Unit-Test für Status-Display-Mapping ergänzen (nur helper/copy).
- Optional: verbleibende vereinzelte nicht-zentrale Statusstrings in randnahen Components ebenfalls auf `uiCopy` ziehen.
- Optional: UX-Review mit kurzen Screenshot-Checks je Surface (Model Inbox, Thread List, Thread Header).
