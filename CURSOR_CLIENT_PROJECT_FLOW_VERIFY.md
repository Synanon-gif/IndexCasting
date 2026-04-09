# CURSOR_CLIENT_PROJECT_FLOW_VERIFY

Manuelle / QA-Matrix (nach Deploy).

| # | Fall | Erwartung |
|---|------|-----------|
| 1 | Owner sieht Org-Projects nach Reload | Liste = DB `client_projects` für `organization_id` |
| 2 | Employee, neues Gerät / leeres localStorage | Dieselben Projekte + Model-IDs wie Owner (Hydration) |
| 3 | Neues Projekt | UUID aus DB; Erfolgs-Feedback nur bei Erfolg |
| 4 | Add zu existierendem Projekt (Discover) | RPC ok; nach Reload Model in Liste |
| 5 | Add aus Package | Gleicher Picker/RPC; Package-Modus bleibt isoliert |
| 6 | Create & Add ohne vorheriges Projekt | Kein Ghost-ID; Model in neuem Projekt |
| 7 | Remove Model (Overview) | Nur ein Confirm; DB-Zeile weg; UI ≤ DB nach reconcile |
| 8 | Remove bei offenem Shared-Project-Discover | Kein Crash; Index/Empty-State sinnvoll |
| 9 | Reload | Projektinhalte = DB |
| 10 | Counts in Projektliste | `models.length` = Anzahl `client_project_models` (sichtbare Models) |
| 11 | Package vs internes Shared vs `?shared=1` | Keine Vermischung der `baseModels`-Quellen |
| 12 | Fehlerpfade Create/Add | Kein „Success“ ohne RPC-Erfolg |

Hinweis: Models ohne Client-Sichtbarkeit (RLS/Paywall) erscheinen nicht in der Hydration — Zählung kann niedriger sein als reine `model_id`-Liste in `client_project_models`; das ist erwartbar.
