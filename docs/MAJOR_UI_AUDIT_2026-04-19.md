# Major UI Audit — 2026-04-19

**Modus:** Read-only Audit (8 parallele Explore-Subagents). Keine Edits, keine RPC-Calls, keine Migrationen.
**Scope:** Client Web, Agency, Model, Admin, Guest/Shared, Packages, Kalender, Chat, Mobile + Desktop.
**Regelwerke:** `.cursorrules` §27 + §28, `.cursor/rules/system-invariants.mdc`, `.cursor/rules/admin-security.mdc`, `.cursor/rules/option-requests-chat-hardening.mdc`, `.cursor/rules/client-web-gallery-guest-shared-audit.mdc`.

---

## Executive Summary

| Severity | Anzahl |
|---|---|
| **Blocker** | **2** |
| **High** | **4** |
| **Medium** | **15** |
| **Polish** | **17** |
| **Gesamt** | **38** |

**Top-Themen:**

1. **Mobile Chat ist nicht vollbild** (Recruiting/Booking + Model Direct/Option-Overlay) — Bottom-Tab-Bar bleibt sichtbar, Composer sitzt nicht am unteren Screenrand. **Verstößt gegen §28.1#1 + §28.7** (Stop-Bedingung).
2. **Header-Compaction ungenutzt** außerhalb Dashboard — großer „INDEX CASTING“-Header wird auf allen Screens (auch Messages/Calendar/Chat-Workspace) mitgetragen.
3. **Kalender-Farb-Drift Monatsraster ↔ Timeline:** Monats-Dots rendern Bookings rot, Woche/Tag rendern dieselbe Datenquelle als Option-Orange/Job-Grün.
4. **Inflight-Guard fehlt für `addOptionRequest` / `createAgencyOnlyOptionRequest`** — Doppelklick kann doppelte Requests erzeugen.
5. **Mess-Anzeige `null`/`undefined cm` in `ProjectDetailView` (galleryFocus)** — fehlende Werte erscheinen sichtbar als „undefined cm“ statt „—“.
6. **Bulk-Completeness-Banner zählt nur `models.portfolio_images` (Mirror)** statt `model_photos` (Persistenz-Wahrheit) — kann zu Drift mit der Critical-Completeness-Logik führen.

---

## Stop-Bedingungen Sweep (§28.7)

| Stop-Bedingung | Status | Achse | Belege |
|---|---|---|---|
| Chat-Composer sitzt im geöffneten Chat unten / Bottom-Tab-Bar nicht im Chat-Workspace sichtbar | ❌ **Verletzt** | A1 | UI-A1-1 (BookingChatView), UI-A1-2 (ModelProfileScreen Direct/Option Overlay) |
| Smart-Attention-Pills brechen vertikal um | ❌ **Verletzt** | A1 | UI-A1-4 (NegotiationChipsRow `flexWrap: 'wrap'`) |
| Kalender: Lifecycle-Duplikate (Option + Job, Note als zweites Event) | ✓ Sauber (Datenpipeline dedupliziert via `dedupeUnifiedRowsByOptionRequest` / `preferJobBookingOverOptionRows`) | A2 | — |
| Month / Week / Day gleichzeitig gerendert | ✓ Sauber (`B2BUnifiedCalendarBody` rendert exklusiv) | A2 | — |
| Scrollen in Kalender-/Chat-Details blockiert / nested scroll trap ohne Not | ⚠️ Risiko | A2 | UI-A2-2 (CalendarDayTimeline nested ScrollView) |
| Mobile nutzt die Breite nicht sinnvoll (künstliche Seitenränder) | ⚠️ Polish | A1 | UI-A1-6 (`shellPaddingH = spacing.md` auf Mobile) |
| Invite/Claim landet im falschen Workspace | ✓ Sauber (INVITE-BEFORE-BOOTSTRAP korrekt; `is_active=false`-Gate dokumentiert) | A6 | UI-A6-3 (Activation-Gate ist Produktentscheid) |
| Model mit Account wird noch als „No model account“ behandelt | ✓ Sauber (`?? false` durchgängig, kein `?? true`-Treffer) | A3 | — |
| Bilder: `resolveStorageUrl failed` / `Object not found` trotz Produkt-Sichtbarkeit | ✓ Sauber (StorageImage-Pipeline durchgängig in Discovery/Gallery) | A4/A5 | — |
| Recruiting: global gedacht, aber nicht global sichtbar | ⏭️ Nicht direkt geprüft (außerhalb dieses UI-Audit-Scopes) | — | MANUAL_REVIEW_REQUIRED |

**Blockierende Stop-Bedingungen:** 2 (Chat-Workspace + Pills-Wrap).

---

## Achse 1 — Mobile Chat-Workspaces & Header-Compaction

### UI-A1-1
- **Severity:** Blocker
- **Regel:** §28.1#1 (Mobile Chat-Vollbild + Composer unten)
- **Fundstellen:** [src/views/BookingChatView.tsx](../src/views/BookingChatView.tsx) (Props `presentation`/`insetAboveBottomNav` ~54–67; Inset-Render ~564–571), [src/views/AgencyControllerView.tsx](../src/views/AgencyControllerView.tsx) (Aufruf mit `presentation="insetAboveBottomNav"` + `bottomInset` ~1270–1277), [src/screens/ModelProfileScreen.tsx](../src/screens/ModelProfileScreen.tsx) (~2561–2568)
- **Beobachtung:** Recruiting-/Booking-Chat wird bewusst **über** der Bottom-Navigation platziert (`bottom: bottomInset`); Tab-Leiste bleibt sichtbar, Composer sitzt nicht am unteren Screenrand.
- **Empfohlener Fix:** Für Mobile Vollbild-Modus wie andere Chat-Workspaces — `agencyChatFullscreen` / modelseitig Tab-Leiste ausblenden, oder `presentation="modal"` + Safe-Area; Agency-`BookingChatView` an bestehendes Fullscreen-Flag koppeln.
- **Risiko:** Nur UI/Shell. Regression-Sweep: Recruiting-Chat öffnen/schließen, iOS/Android Keyboard, Web-Inset.

### UI-A1-2
- **Severity:** Blocker
- **Regel:** §28.1#1 + §28.1#2 (Vollbild-Workspace)
- **Fundstellen:** [src/screens/ModelProfileScreen.tsx](../src/screens/ModelProfileScreen.tsx) — Agency-Direct-Chat (`openDirectConvId` ~2572–2626 mit `bottom: bottomTabInset`), Option-Negotiation-Overlay (`selectedOptionThread` ~2654–2678 Mobile), `st.bottomTabBar` (~2629–2651) bleibt darunter sichtbar
- **Beobachtung:** Overlays enden oberhalb der Tab-Bar; **Model-Bottom-Tabs bleiben im Chat-Workspace sichtbar** — widerspricht „Tab-Bar im geöffneten Chat nicht sichtbar / Composer am Rand".
- **Empfohlener Fix:** Bei geöffnetem Direct-/Option-Thread auf Mobile Tab-Bar conditional ausblenden (oder `height: 0` + `pointerEvents: 'none'`); Overlay auf `bottom: 0` mit Safe-Area; Composer-Padding analog `ClientWebApp`/`ChatLayoutFix` mit `bottomTabInset === 0`.
- **Risiko:** Nur Frontend. Regression: Model-Home, Tab-Wechsel, Deep-Link `selectedOptionThread`.

### UI-A1-3
- **Severity:** High
- **Regel:** §28.1#3 (Header-Compaction außerhalb Dashboard)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (`styles.topBar` / `INDEX CASTING` ~2563–2579, gilt für alle Tabs inkl. Messages), [src/views/AgencyControllerView.tsx](../src/views/AgencyControllerView.tsx) (`s.topShell` / `INDEX CASTING` ~809–810), [src/screens/ModelProfileScreen.tsx](../src/screens/ModelProfileScreen.tsx) (`st.topShell` ~1195–1196)
- **Beobachtung:** Großer Marken-Header wird auf allen Screens (auch Messages/Calendar/Chat) mitgetragen; widerspricht Kompakt-Regel.
- **Empfohlener Fix:** Außerhalb Dashboard kompakte Zeile (nur Logout/Help/Icon); bei `clientChatFullscreen` / mobile Chat zusätzlich Top-Brand reduzieren oder ausblenden.
- **Risiko:** Nur UI. Regression: alle Rollen-Workspaces, Web mobile.

### UI-A1-4
- **Severity:** Medium
- **Regel:** §28.1#4 (horizontale Pills)
- **Fundstellen:** [src/components/optionNegotiation/NegotiationChipsRow.tsx](../src/components/optionNegotiation/NegotiationChipsRow.tsx) (`styles.row` mit `flexWrap: 'wrap'` ~86–91); eingebunden u. a. in [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (~6561–6571) und [src/views/AgencyControllerView.tsx](../src/views/AgencyControllerView.tsx) (~7045–7055)
- **Beobachtung:** Workflow- + Attention-Chips können vertikal umbrechen statt in einer horizontal scrollbaren Zeile.
- **Empfohlener Fix:** Zeile in horizontalem `ScrollView` mit `flexWrap: 'nowrap'`; lange Attention-Texte truncaten.
- **Risiko:** Nur Layout. Regression: lange Lokalisierungen, kleine Viewports.

### UI-A1-5
- **Severity:** Medium
- **Regel:** §28.1#4 (View-Mode-/Filter-Pills)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (`ClientCalendarView` Typ-Filter `flexDirection: 'row', flexWrap: 'wrap'` ~4709–4716)
- **Beobachtung:** Kalender-Typfilter brechen auf mehrere Zeilen um.
- **Empfohlener Fix:** Horizontaler `ScrollView` für Typ-Pills (wie Client-Messages-Tab-Pills ~6152–6159).
- **Risiko:** Nur UI.

### UI-A1-6
- **Severity:** Medium
- **Regel:** §28.1#6 (Volle Breite Mobile-Default)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (`shellPaddingH = clientIsMobile ? spacing.md` ~495; `paddingHorizontal: shellPaddingH` am `appShell` ~2559), [src/components/ChatLayoutFix.tsx](../src/components/ChatLayoutFix.tsx) (`edgePadding` Default `spacing.sm` Mobile ~34–35)
- **Beobachtung:** Zusätzliche horizontale Innenabstände auf Mobile — bewusst, aber enger als „volle Nutzfläche".
- **Empfohlener Fix:** Mobile Chat-Shell `paddingHorizontal: 0` oder `spacing.xs`; nur Bubbles mit horizontalem Inset.
- **Risiko:** Lesbarkeit / Touch-Ziele.

### UI-A1-7
- **Severity:** Medium
- **Regel:** §28.1#5 (Bottom-Tab-Bar vollständig)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) Workspace-Menü (Modal, Einträge nur `dashboard | discover | calendar | team | profile` ~3591–3609) vs. vollständige `CLIENT_PRIMARY_BOTTOM_TABS` (u. a. `messages`, `projects`, `agencies` ~314–323)
- **Beobachtung:** Alternativer Workspace-Menü-Einstieg bietet nicht alle kanonischen Tabs (es fehlen u. a. Messages, Projects, Agencies). Untere Leiste bleibt vollständig.
- **Empfohlener Fix:** Menü um fehlende Tabs ergänzen oder klar als „Schnellwahl" labeln.
- **Risiko:** UX, kein Backend.

### UI-A1-8
- **Severity:** Polish
- **Regel:** §28.1#3 (keine doppelten Titelzeilen)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (Kalender-Tab: zusätzliche `Calendar`-Überschrift in `ClientCalendarView` ~4667–4669)
- **Beobachtung:** Doppel-Titelführung mit Bottom-Tab-Label.
- **Empfohlener Fix:** Inneren Titel entfernen, Bottom-Tab-Label genügt.
- **Risiko:** Nur UI.

---

## Achse 2 — Kalender-Konsistenz

### UI-A2-1
- **Severity:** High
- **Regel:** §28.2#11 (Kalender-Farb-Konsistenz Grid ↔ Liste ↔ Woche/Tag)
- **Fundstellen:** [src/utils/agencyCalendarUnified.ts](../src/utils/agencyCalendarUnified.ts) (~595–605), [src/utils/calendarUnifiedTimeline.ts](../src/utils/calendarUnifiedTimeline.ts) (~86–98), [src/utils/calendarProjectionLabel.ts](../src/utils/calendarProjectionLabel.ts) (`getBookingEntryProjectionBadge`)
- **Beobachtung:** `buildEventsByDateFromUnifiedRows` setzt für **alle** `kind === 'booking'`-Zeilen die Punktfarbe auf `colors.buttonSkipRed` (Rot). Woche/Tag nutzen `getBookingEntryProjectionBadge` (`CALENDAR_COLORS.option` / `.job` — Orange/Grün). **Monatsraster und Timeline widersprechen sich** für dieselbe Datenquelle.
- **Empfohlener Fix:** Monats-Dots auf dieselbe Farblogik wie Timeline (gemeinsamer Helper `colorForUnifiedBookingRow(row)` oder `getBookingEntryProjectionBadge`).
- **Risiko:** Nur Frontend. Visuelles Regression-Sweep über Agency- und Client-Kalender Monats- vs. Woche/Tag.

### UI-A2-2
- **Severity:** Medium
- **Regel:** §28.2#10 (Scrollpflicht, keine nested scroll traps)
- **Fundstellen:** [src/components/CalendarDayTimeline.tsx](../src/components/CalendarDayTimeline.tsx) (~86–90 vertikales `ScrollView` mit `nestedScrollEnabled`); Eltern: [src/views/AgencyControllerView.tsx](../src/views/AgencyControllerView.tsx) (`ScreenScrollView` + `B2BUnifiedCalendarBody`), [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx), [src/screens/ModelProfileScreen.tsx](../src/screens/ModelProfileScreen.tsx) (~1802–1877)
- **Beobachtung:** Tagesansicht ist vertikales `ScrollView` innerhalb eines page-level Scroll-Containers. Bewusst kommentiert, aber kann auf Web/Mobile zu „wer scrollt?"-Konflikten führen.
- **Empfohlener Fix:** Wo möglich Tages-Body ohne inneres Scroll (flex + minHeight) oder nur eine Scroll-Ebene; Plattform-Tests dokumentieren.
- **Risiko:** Nur UI/UX. Regression: Agency / Client Web / Model.

### UI-A2-3
- **Severity:** Medium
- **Regel:** §28.2#11 (Cancelled=hidden vs. Terminal-Badge)
- **Fundstellen:** [src/utils/calendarProjectionLabel.ts](../src/utils/calendarProjectionLabel.ts) (`getCalendarProjectionBadge` ~79–81), [src/utils/agencyCalendarUnified.ts](../src/utils/agencyCalendarUnified.ts) (`filterUnifiedAgencyCalendarRows` — kein Filter auf `option.status === 'rejected'`)
- **Beobachtung:** Abgelehnte Optionen erhalten sichtbares „rejected"-Badge (grau) statt komplette Ausblendung. Datenseitig ist der Filter abhängig vom Fetch/Join.
- **Empfohlener Fix:** Produktentscheid: rejected aus unified Liste filtern oder Audit-Formulierung „grey terminal" verwenden.
- **Risiko:** Frontend + ggf. Datenpipeline. Regression mit Reject/Delete-Flows.

### UI-A2-4
- **Severity:** Polish
- **Regel:** §28.2#11 (Farbkanon Job/Option)
- **Fundstellen:** [src/utils/calendarColors.ts](../src/utils/calendarColors.ts) (`CALENDAR_COLORS.job` = Grün, `option` = Orange), [src/utils/calendarProjectionLabel.ts](../src/utils/calendarProjectionLabel.ts) (Verhandlung Blau, Job-finalize braun, bestätigter Job grün)
- **Beobachtung:** Mehrere nebeneinander gültige Semantiken (Entry-Typ-Farben vs. Attention-Projection). Widerspricht einer einfachen „Job=braun, Option=blau"-Checkliste ohne Substate-Unterscheidung.
- **Empfohlener Fix:** Audit-Matrix / Storybook-Tabelle: welcher State welche Farbe trägt; ggf. `CALENDAR_COLORS` an Badge-Semantik angleichen.
- **Risiko:** Doku/UX, breiter visueller Sweep.

### UI-A2-5
- **Severity:** Polish
- **Regel:** §28.2#7 (Defense-in-Depth Dedupe am Grid)
- **Fundstellen:** [src/utils/calendarProjectionLabel.ts](../src/utils/calendarProjectionLabel.ts) (`dedupeCalendarGridEventsByOptionRequest` ~231–249, nur in Tests genutzt); Produktion baut `eventsByDate` über `buildEventsByDateFromUnifiedRows(filteredUnified)`
- **Beobachtung:** Grid-Dedupe-Hilfsfunktion ist nicht in der Live-Pipeline eingebunden (Vertrauen auf Unified-Row-Logik).
- **Empfohlener Fix:** Optional in Live-Pipeline einbinden oder als „legacy" markieren / entfernen.
- **Risiko:** Gering, wenn `preferJobBookingOverOptionRows` + `dedupeUnifiedRowsByOptionRequest` stabil.

### UI-A2-6
- **Severity:** Polish
- **Regel:** Wartbarkeit (Stichprobe nicht direkt §28.2)
- **Fundstellen:** [src/components/UnifiedCalendarAgenda.tsx](../src/components/UnifiedCalendarAgenda.tsx) (kein Import in Produktionsdateien)
- **Beobachtung:** Komponente mit Notiz-Vorschau aus `booking_details` ist faktisch unbenutzt; B2B nutzt `B2BUnifiedCalendarBody` + `MonthCalendarView` / Week / Day.
- **Empfohlener Fix:** Einbinden oder archivieren.
- **Risiko:** Keins.

---

## Achse 3 — Negotiation Threads & Smart Attention

### UI-A3-1
- **Severity:** Medium
- **Regel:** system-invariants.mdc#L (Inflight-Guard)
- **Fundstellen:** [src/store/optionRequests.ts](../src/store/optionRequests.ts) (~1313–1354 `createAgencyOnlyOptionRequest`; ~219–531 `addOptionRequest` mit async `insertOptionRequest`/`insertAgencyOptionRequest`)
- **Beobachtung:** Alle in Invariante L gelisteten **Preis-/Status-Mutationen** sind durch `beginCriticalOptionAction`/`endCriticalOptionAction` geschützt — **`createAgencyOnlyOptionRequest` und der async Teil von `addOptionRequest`** (neue `option_requests`-Zeile) **nicht**. Doppelklicks können parallel laufen → doppelte Requests / doppelte System-Messages.
- **Empfohlener Fix:** Pro sinnvollem Scope (z. B. pro `modelId`+Zeitfenster oder globales „option create inflight") Inflight-Guard analog zu existierenden kritischen Aktionen; UI-seitig Button-Disable bis `onThreadReady` bzw. Insert beendet.
- **Risiko:** Nur Store/UX. Backend-idempotente DB-Seite optional zusätzlich.

### UI-A3-2
- **Severity:** Polish
- **Regel:** §28.3 / Konsistenz Optimistic vs. RPC
- **Fundstellen:** [src/store/optionRequests.ts](../src/store/optionRequests.ts) (~578–617 lokal `finalStatus: 'option_pending'` im Cache), [src/services/optionRequestsSupabase.ts](../src/services/optionRequestsSupabase.ts) (~2072–2088 UPDATE nur `model_approval` + `status`)
- **Beobachtung:** Beim Model-Reject setzt der Store lokal u. a. `finalStatus: 'option_pending'`; der Service sendet kein `final_status` (Trigger übernimmt). Korrekt für Achsen-/Trigger-Kette, kurzzeitiger Cache-Drift möglich.
- **Empfohlener Fix:** Optional nach RPC nur Refresh ohne lokales `finalStatus`-Setzen.
- **Risiko:** Nein.

**Saubere Bereiche bestätigt:** Invariante K (Achsen-Trennung), Invariante R (Agency-only kein Preis-UI: `priceLocked = isAgencyOnlyRequest || priceCommerciallySettledForUi(signals)`), Invariante T (`attentionSignalsFromOptionRequestLike` setzt `isAgencyOnly` durchgängig in geprüften Prod-Files), `model_account_linked ?? true` ist 0 Treffer in `src/`, doppelte `NegotiationThreadFooter`-Instanzen werden via `showDesktopNegotiationRail` korrekt unterdrückt.

---

## Achse 4 — Client Web Gallery, Guest, Shared, Packages, PDF

### UI-A4-1
- **Severity:** High
- **Regel:** client-web-gallery-guest-shared-audit.mdc §5 (keine `null`/`undefined`-Lesetexte; `—` bei fehlenden Werten)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (~7441–7444 `ProjectDetailView` `presentation === 'galleryFocus'`)
- **Beobachtung:** Meta-Zeile setzt `data.measurements.height` direkt in einen String (`… {height} cm · …`). Fehlen Zahlen, erscheinen u. a. **`undefined cm`** / leere Fragmente statt **`—`**.
- **Empfohlener Fix:** Wie im Package-Grid: `value != null ? \`${value} cm\` : '—'` pro Messung; für Chest `chest ?? bust` beibehalten.
- **Risiko:** Nur Frontend.

### UI-A4-2
- **Severity:** Medium
- **Regel:** §5 (`!= null` statt truthy)
- **Fundstellen:** [src/views/GuestView.tsx](../src/views/GuestView.tsx) (~718–719, ~925–926)
- **Beobachtung:** `galleryModel.waist ?` / `m.hips ?` blendet bei `0` die Anzeige aus (falsch-leer).
- **Empfohlener Fix:** `!= null`-Checks und sonst `—`.
- **Risiko:** Nur Frontend.

### UI-A4-3
- **Severity:** Medium
- **Regel:** §11 / §4b (sichtbare Strings aus `uiCopy`)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (~7625–7640 `ProjectDetailView` Standard-Layout)
- **Beobachtung:** Hart kodierte Texte `Calendar`, `Request option`, `Request option for a specific date.` ohne `uiCopy`-Keys.
- **Empfohlener Fix:** Keys in `uiCopy` anlegen und ersetzen.
- **Risiko:** Nein.

### UI-A4-4
- **Severity:** Polish
- **Regel:** §5 (Konsistenz „—"-Darstellung)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (~7566–7590)
- **Beobachtung:** Messwerte als Rohzahl unter Label; fehlende Werte wirken wie „leeres Feld" statt einheitlichem `—`.
- **Empfohlener Fix:** Anzeige wie in `PackageGalleryView`/`formatMeasurement` angleichen.
- **Risiko:** Nein.

### UI-A4-5
- **Severity:** Polish
- **Regel:** §9 (`legsInseam` mit `!= null`)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (~3986–3988)
- **Beobachtung:** `m.legsInseam ?` ist truthy-basiert; `0` würde Inseam-Zeile unterdrücken.
- **Empfohlener Fix:** `m.legsInseam != null ? …`
- **Risiko:** Nein.

### UI-A4-6
- **Severity:** Polish
- **Regel:** §12.3 / §12.4 (Footer-Text aus `uiCopy.pdfExport.footerText`)
- **Fundstellen:** [src/utils/pdfExport.ts](../src/utils/pdfExport.ts) (~17, ~110–114, ~189–194); [src/constants/uiCopy.ts](../src/constants/uiCopy.ts) (`footerText` ~2246+)
- **Beobachtung:** `FOOTER_TEXT` und `No images available` im Generator hardcodiert (Drift zu `uiCopy`).
- **Empfohlener Fix:** `uiCopy` importieren oder Texte als Parameter übergeben.
- **Risiko:** Nur Frontend (Bundle-Aufteilung beachten).

### UI-A4-7
- **Severity:** Polish
- **Regel:** §7a (CTA-Reihenfolge Chat / Option / Add)
- **Fundstellen:** [src/web/ClientWebApp.tsx](../src/web/ClientWebApp.tsx) (~7450–7482 `galleryFocus`-Layout)
- **Beobachtung:** Option und Add stehen in der ersten Zeile, Chat darunter separat — abweichend von der kanonischen Reihenfolge.
- **Empfohlener Fix:** Bei Bedarf an §7a angleichen oder Regel als „alle sichtbar" dokumentieren.
- **Risiko:** Nein.

### UI-A4-8
- **Severity:** Polish
- **Regel:** §7a.3 (`showAuthGate(action)` Intent-Signal)
- **Fundstellen:** [src/views/SharedSelectionView.tsx](../src/views/SharedSelectionView.tsx) (~136–142, ~426–448)
- **Beobachtung:** Alle drei Buttons rufen `showAuthGate()` ohne `action` — kein Intent-Signal für Analytics/post-login.
- **Empfohlener Fix:** Optional `showAuthGate('chat' | 'option' | 'add')`.
- **Risiko:** Nein.

### UI-A4-9
- **Severity:** Polish
- **Regel:** §12.1 / §4b
- **Fundstellen:** [src/components/PdfExportModal.tsx](../src/components/PdfExportModal.tsx) (~137 hardcodiert `X img`)
- **Beobachtung:** Hardcodierter String.
- **Empfohlener Fix:** Nach `uiCopy` verschieben.
- **Risiko:** Nein.

**Saubere Bereiche bestätigt:** §1–§4 (Routing, Daten, StorageImage), §4.1 (Watermark-Verbot — keine Treffer), §4.2 (`aspectRatio`-Wrapper-Höhen korrekt verdrahtet), §6 (Guest OTP `check_email` mit Resend + Back via `uiCopy.guestFlow`), §7 (Shared Footer-CTA, kein Discovery-Fallback), §7a (CTAs sichtbar in 4 Surfaces), §7a.4 (`GuestLinkInfo` enthält `agency_id`/`agency_name`), §7b (Post-Signup via `initialPackageId`), §8 (`ActiveOptionsView` `onOpenThread` korrekt), §12 (PDF dynamic import `jspdf`).

---

## Achse 5 — Bilder, Storage, Polaroid-Isolation

### UI-A5-1
- **Severity:** High
- **Regel:** §27.1 (`model_photos` als Persistenz-Wahrheit) + §28.5#18–19
- **Fundstellen:** [src/views/AgencyControllerView.tsx](../src/views/AgencyControllerView.tsx) (~5182–5185)
- **Beobachtung:** Org-weiter „incomplete models"-Banner zählt nur `(m.portfolio_images ?? []).length === 0` (Mirror), **nicht** sichtbare `model_photos`. Bei Mirror-Drift weicht Anzeige von kanonischer Completeness-Logik (`hasVisibleClientPortfolio` / `checkModelCompleteness`) ab.
- **Empfohlener Fix:** Dieselbe Quelle wie für Critical-Completeness (Batch-Flag aus `model_photos` client-sichtbar oder konservativer Heuristik-Join).
- **Risiko:** Optional Backend (RPC-Bündelung).

### UI-A5-2
- **Severity:** Medium
- **Regel:** §27.1 (Polaroids nur in Paket-/Guest-Kontext)
- **Fundstellen:** [src/components/OrgMessengerInline.tsx](../src/components/OrgMessengerInline.tsx) (~302–324)
- **Beobachtung:** Vorschaubilder für `message_type === 'package'` laden immer `portfolio_images?.[0]`. Bei **Polaroid-Paket** kann Vorschau leer sein oder nicht zum Paketinhalt passen.
- **Empfohlener Fix:** Paket-Metadaten (`package_type`/Guest-Link-Typ) auslesen und wie `getPackageDisplayImages` die richtige Quelle wählen.
- **Risiko:** Nur falls Metadaten in `messages` fehlen → Payload erweitern.

### UI-A5-3
- **Severity:** Medium
- **Regel:** §27.1 (Polaroids strict isoliert außerhalb Paket/Guest)
- **Fundstellen:** [src/components/AgencyShareUI.tsx](../src/components/AgencyShareUI.tsx) (~548–571)
- **Beobachtung:** `cover = model.portfolioImages[0] ?? model.polaroids[0]` — bei fehlendem Portfolio wird Polaroid als Karten-Cover genutzt (agency-intern, aber Polaroid-Sicht außerhalb Paket/Guest).
- **Empfohlener Fix:** Produktentscheid: nur Portfolio-Cover oder explizit „Polaroid preview" labeln; ggf. nur in Polaroid-Paket-Flow zeigen.
- **Risiko:** Nein.

### UI-A5-4
- **Severity:** Polish
- **Regel:** §27.1 (Semantik `model_photos` vs. Feld-Label)
- **Fundstellen:** [src/utils/modelCompleteness.ts](../src/utils/modelCompleteness.ts) (~64–68)
- **Beobachtung:** Critical-Issue nutzt korrekt `ctx.hasVisiblePhoto`, aber `field: 'portfolio_images'` — irreführend für Audits/Debug.
- **Empfohlener Fix:** `field: 'visible_portfolio_photo'` / `model_photos_visible`.
- **Risiko:** Nein.

### UI-A5-5
- **Severity:** Polish
- **Regel:** §27.8 / §28.5#18 (Storage-sichere Darstellung)
- **Fundstellen:** [src/screens/ModelProfileScreen.tsx](../src/screens/ModelProfileScreen.tsx) (~2705–2710)
- **Beobachtung:** Agency-Logo im Option-Chat-Header als rohes `<Image source={{ uri: optionChatAgency.logo_url }}>` — ohne `StorageImage`-Pipeline.
- **Empfohlener Fix:** Wenn Logos im gleichen Bucket landen können → `StorageImage` oder garantiert öffentliche HTTPS-URLs enforcen.
- **Risiko:** Nur falls Logo-Speicher-Modell Storage-Schema enthält.

### UI-A5-6
- **Severity:** Polish
- **Regel:** §27.1 / §28.5 (einheitliche Auflösungs-Pipeline)
- **Fundstellen:** [src/components/ModelMediaSettingsPanel.tsx](../src/components/ModelMediaSettingsPanel.tsx) (~651–656 vs. ~835–839)
- **Beobachtung:** Manage-Zeilen nutzen `<Image uri={photo.displayUrl}>` nach `resolveStorageUrl`; Grid nutzt `StorageImage`. Funktional ok, aber zwei Render-Pfade → leichter Drift bei zukünftigen URI-Formen.
- **Empfohlener Fix:** Überall `StorageImage` mit kanonischer URI.
- **Risiko:** Nein.

**Saubere Bereiche bestätigt:** Client-Discovery (`mapDiscoveryModelToSummary` nur Portfolio, keine Polaroids), Discover-Hero/Detail/Lightbox via `StorageImage` + `normalizeDocumentspicturesModelImageRef`, Guest-Pakete via `getPackageDisplayImages`, Agency-Roster-Galerie via Normalisierung + `StorageImage`.

---

## Achse 6 — Invite/Claim Workspace-Landing

### UI-A6-1
- **Severity:** Medium
- **Regel:** §4b (zentrale `uiCopy`)
- **Fundstellen:** [src/screens/PendingActivationScreen.tsx](../src/screens/PendingActivationScreen.tsx) (Z. 43–81)
- **Beobachtung:** Sämtliche sichtbaren Strings hart codiert (Titel, Fließtexte, Button-Labels, `mailto`-Body) statt `uiCopy`.
- **Empfohlener Fix:** Texte nach `uiCopy.pendingActivation.*` verschieben.
- **Risiko:** Nein.

### UI-A6-2
- **Severity:** Polish
- **Regel:** §4b
- **Fundstellen:** [App.tsx](../App.tsx) (Org-Deaktivierungs-Gate ~774–778, Button `"Sign Out"` hardcoded)
- **Beobachtung:** Hardcoded EN-Text statt `uiCopy`.
- **Empfohlener Fix:** Auf vorhandenen Logout/Common-Key umstellen.
- **Risiko:** Nein.

### UI-A6-3
- **Severity:** Medium
- **Regel:** §28.4#16 („direkt im korrekten Workspace")
- **Fundstellen:** [App.tsx](../App.tsx) (~1114–1122 `!profile.is_active && (client|agent)` → `PendingActivationScreen`)
- **Beobachtung:** Eingeladene Booker/Employees mit `is_active === false` sehen nicht sofort Dashboard, sondern Aktivierungs-Screen. Routing rollentechnisch korrekt, aber Workspace bis zur Freigabe blockiert.
- **Empfohlener Fix:** Copy/Expectation klären (z. B. Hinweis „Your organization owner must activate…"); ggf. separates Messaging für Invitees vs. Self-Service-Owner.
- **Risiko:** Kann Backend/Produkt brauchen (`is_active`-Semantik), nicht nur UI.

### UI-A6-4
- **Severity:** Polish
- **Regel:** §4b
- **Fundstellen:** [src/constants/uiCopy.ts](../src/constants/uiCopy.ts) (`app.inviteClaimSuccessFallback` ~716); Verwendung in [App.tsx](../App.tsx) (~377–395, ~421–422)
- **Beobachtung:** Fallback-Text „Welcome — your workspace access is ready." wirkt wie voller Erfolg, wird aber bei **Fehler in Text-Auflösung** gesetzt (RPC kann bereits gelaufen sein).
- **Empfohlener Fix:** Neutralerer Fallback („We connected your account. Some details could not be loaded.").
- **Risiko:** Nein.

### UI-A6-5
- **Severity:** Polish
- **Regel:** §27.6 (kein irreführendes „Owner" in Invite)
- **Fundstellen:** [src/services/inviteClaimSuccessUi.ts](../src/services/inviteClaimSuccessUi.ts) (~94–96), [src/constants/uiCopy.ts](../src/constants/uiCopy.ts) (`combinedRoleOwner`)
- **Beobachtung:** Im kombinierten Invite+Model-Claim-Banner wird `organization_members.role === 'owner'` als „Owner" gerendert. Booker/Employee-Einladungen sollten `owner` nicht setzen, aber Randfall denkbar.
- **Empfohlener Fix:** Banner für echte Invite-Pfade auf booker/employee/default beschränken oder Copy neutralisieren.
- **Risiko:** Eher Datenmodell-Klarheit.

**Saubere Bereiche bestätigt:** INVITE-BEFORE-BOOTSTRAP korrekt umgesetzt (`AuthContext.bootstrapThenLoadProfile` ~505–558: `finalizePendingInviteOrClaim` zuerst, `inviteAcceptedInBootstrap` setzt, `ensurePlainSignupB2bOwnerBootstrap` übersprungen). Token-Persistence (`ic_pending_invite_token`, `ic_pending_model_claim_token`). Success-Banner nur nach RPC-Ok via `emitInviteClaimSuccess`. `InviteAcceptanceScreen` zeigt `inviteNotSelfServiceHint` + Rollenlabel, Auth-Screen kein Rollen-Picker im Invite-Kontext. Keine „Owner"-Suggestion in normaler Invite-Copy.

---

## Achse 7 — UI-Copy / English-only / `uiCopy`-Compliance

### UI-A7-1
- **Severity:** High
- **Regel:** §4b (zentrale Copy)
- **Fundstellen:** [src/screens/ModelProfileScreen.tsx](../src/screens/ModelProfileScreen.tsx) (~370–375, ~971–974, ~988–990, ~1106)
- **Beobachtung:** Mehrere englische Alert-Texte direkt im Code: „Live GPS location set to: …", „Could not confirm availability…", „Could not decline the request…", Alert-Titel `'Calendar'` neben `uiCopy.alerts.calendarNotSaved`.
- **Empfohlener Fix:** Neue Keys unter `uiCopy.alerts` / `uiCopy.model`; Titel „Calendar" durch bestehenden/neuen Key ersetzen.
- **Risiko:** Nein.

### UI-A7-2
- **Severity:** Medium
- **Regel:** §4b
- **Fundstellen:** [src/screens/ClientOrgProfileScreen.tsx](../src/screens/ClientOrgProfileScreen.tsx) („Gallery", „Edit Profile", „Public Profile" usw.), [src/screens/AgencyDashboardScreen.tsx](../src/screens/AgencyDashboardScreen.tsx) („Agency workspace", „Traction", „Recruiting" usw.)
- **Beobachtung:** Viele literale englische Strings in `<Text>` ohne `uiCopy` — konsistent englisch, aber nicht zentralisiert.
- **Empfohlener Fix:** Schrittweise Keys in `uiCopy.clientOrgProfile.*` / `agencyDashboard.*`.
- **Risiko:** Nein.

### UI-A7-3
- **Severity:** Medium
- **Regel:** §27.2 (Chest-only UI; Legacy-Key nicht als Nutzerlabel)
- **Fundstellen:** [src/views/AdminDashboard.tsx](../src/views/AdminDashboard.tsx) (~1953–1957)
- **Beobachtung:** `Object.entries(modelData).map(([key, val]) => …)` rendert Roh-Spaltennamen (`key: value`). Enthält die Zeile `bust`, erscheint das Wort **sichtbar** im Admin-UI (Legacy-Key-Leak). Kein `textTransform: 'uppercase'` → kein „BUST"-Leak.
- **Empfohlener Fix:** Explizite Feldliste mit Anzeige-Labels aus `uiCopy` (Chest statt `bust`) oder Mapping `bust → chest (legacy)`.
- **Risiko:** Nein.

### UI-A7-4
- **Severity:** Polish
- **Regel:** agency-only §6 (bewusst abgrenzen)
- **Fundstellen:** [src/navigation/RootNavigator.tsx](../src/navigation/RootNavigator.tsx) (Tab `name="Agency"`), [src/screens/AuthScreen.tsx](../src/screens/AuthScreen.tsx), [src/screens/PendingActivationScreen.tsx](../src/screens/PendingActivationScreen.tsx) (`'Agency' : 'Client'` als Kontotyp)
- **Beobachtung:** Rollen-/Navigations-Labels, KEINE Ersatzdarstellung für `agency_organization_name` / `client_organization_name`. In Kalender/Option-Views korrekt mit `sanitizeOrgName` + `unknownAgency`/`unknownClient`.
- **Empfohlener Fix:** Optional `uiCopy` für Tab/Auth-Strings; für §6 kein Muss.
- **Risiko:** Nein.

### UI-A7-5
- **Severity:** Polish
- **Regel:** §4b
- **Fundstellen:** [src/views/AdminDashboard.tsx](../src/views/AdminDashboard.tsx) (~1976 `'Saving...' : 'Save Changes'`, ~1944 `'Yes' : 'No'`, ~1981)
- **Beobachtung:** Admin-UI mischt `uiCopy` mit literalen Strings.
- **Empfohlener Fix:** Auf `uiCopy.common.save`, `saving`, `yes`, `no` umstellen.
- **Risiko:** Nein.

**Saubere Bereiche bestätigt:** Keine deutschen UI-Strings (nur Kommentare), 0 Treffer für `'Bust'`/`"Bust"` als sichtbares Label, Notifications nutzen `uiCopy.notifications.*`, Org-Namen-Auflösung in Option/Kalender via `agency_organization_name` + Fallbacks.

---

## Achse 8 — Admin Dashboard / Billing / Owner-only

### UI-A8-1
- **Severity:** Medium
- **Regel:** admin-security.mdc Regel 10 (Web-Zuverlässigkeit) / `.cursorrules` §4b
- **Fundstellen:** [src/screens/PaywallScreen.tsx](../src/screens/PaywallScreen.tsx) (~192–204), [src/components/OwnerBillingStatusCard.tsx](../src/components/OwnerBillingStatusCard.tsx) (~167–178)
- **Beobachtung:** Bei fehlgeschlagenem Checkout `Alert.alert` — Web empfiehlt `showAppAlert` (`window.alert`) via [src/utils/crossPlatformAlert.ts](../src/utils/crossPlatformAlert.ts) (~6–12).
- **Empfohlener Fix:** Fehlerpfade von `createCheckoutSession` auf `showAppAlert` (oder `crossPlatformAlert`).
- **Risiko:** Nein.

### UI-A8-2
- **Severity:** Medium
- **Regel:** admin-security.mdc Regel 10 (destruktive Bestätigung Web)
- **Fundstellen:** [src/views/AdminDashboard.tsx](../src/views/AdminDashboard.tsx) (~440–453 `handleToggleOrgActive` → direkt `adminSetOrgActive`, kein Confirm)
- **Beobachtung:** Org Activate/Deactivate ohne vorherige Bestätigung. Andere Admin-Schritte nutzen `showConfirmAlert`.
- **Empfohlener Fix:** Vor Toggle `showConfirmAlert` mit klarer Copy.
- **Risiko:** Nein.

### UI-A8-3
- **Severity:** Polish
- **Regel:** Konsistenz Admin-Destructive-Pattern
- **Fundstellen:** [src/views/AdminDashboard.tsx](../src/views/AdminDashboard.tsx) (~530–540 `handleResetSwipeCount`)
- **Beobachtung:** Tages-Swipe-Zähler wird ohne Confirm zurückgesetzt.
- **Empfohlener Fix:** Optional `showConfirmAlert`.
- **Risiko:** Nein.

**Saubere Bereiche bestätigt:** Regel 9 (`admin_convert_org_type` über `adminConvertOrgType`-Wrapper, kein DISABLE TRIGGER in TS), Regel 10 (Ghost-Badge nur `org.type === 'client'`, `member_count <= 1`, Name-Match), `admin_*` RPCs nur in `adminSupabase.ts`, Owner-only Checkout (PaywallScreen Plan-Karten + OwnerBillingStatusCard + BillingDetailsForm), Paywall-Gate (`ClientPaywallGuard`/`AgencyPaywallGuard` warten auf `loaded`), Fail-closed `getMyOrgAccessStatus` (bei Fehler `allowed: false`), `OrgProfileModal` mit `orgMemberRole={null}` für Gegenpartei.

---

## Severity-Gesamtübersicht (sortiert)

### Blocker (2)
1. **UI-A1-1** — Recruiting/Booking-Chat Mobile: Tab-Bar bleibt sichtbar, Composer nicht am Rand
2. **UI-A1-2** — Model Direct-Chat / Option-Overlay Mobile: Tab-Bar weiter sichtbar

### High (4)
3. **UI-A1-3** — Großer „INDEX CASTING"-Header außerhalb Dashboard (Client Web, Agency, Model)
4. **UI-A2-1** — Monats-Dot rot vs. Woche/Tag Orange/Grün für identische Booking-Rows
5. **UI-A4-1** — `ProjectDetailView` galleryFocus zeigt `undefined cm` bei fehlenden Werten
6. **UI-A5-1** — Agency Banner „incomplete models" zählt Mirror statt `model_photos`
7. **UI-A7-1** — `ModelProfileScreen` mehrere hardcoded Alert-Texte / Titel `'Calendar'`

### Medium (15)
- UI-A1-4 / UI-A1-5 (Pills `flexWrap: 'wrap'` in Negotiation + Calendar Filter)
- UI-A1-6 (Mobile Shell-Padding zu groß)
- UI-A1-7 (Workspace-Menü unvollständig)
- UI-A2-2 (Nested ScrollView in CalendarDayTimeline)
- UI-A2-3 (rejected Optionen nicht ausgeblendet)
- UI-A3-1 (Kein Inflight-Guard für `addOptionRequest`/`createAgencyOnlyOptionRequest`)
- UI-A4-2 (`waist`/`hips` truthy statt `!= null`)
- UI-A4-3 (Hardcoded `Calendar`/`Request option` in `ProjectDetailView`)
- UI-A5-2 (Package-Vorschau ignoriert `package_type` für Polaroid-Pakete)
- UI-A5-3 (`AgencyShareUI` Polaroid-Cover-Fallback außerhalb Paket/Guest)
- UI-A6-1 (`PendingActivationScreen` komplette Hardcodes)
- UI-A6-3 (`is_active=false`-Gate für Invitees: Produktklarheit fehlt)
- UI-A7-2 (verstreute Literal-Strings in Org-Profil/Dashboard-Screens)
- UI-A7-3 (Admin `Object.entries`-Dump leakt Legacy-Key `bust`)
- UI-A8-1 (`Alert.alert` statt `showAppAlert` für Web-Checkout-Fehler)
- UI-A8-2 (Org Activate/Deactivate ohne Confirm)

### Polish (17)
- UI-A1-8 (Doppel-Title `Calendar`)
- UI-A2-4 / UI-A2-5 / UI-A2-6 (Farb-Doku, Dedupe-Helper unbenutzt, `UnifiedCalendarAgenda` ungenutzt)
- UI-A3-2 (Cache-Drift bei Model-Reject)
- UI-A4-4 / UI-A4-5 / UI-A4-6 / UI-A4-7 / UI-A4-8 / UI-A4-9 (Mess-Konsistenz, PDF-Footer-Drift, CTA-Reihenfolge, Auth-Gate Intent, `X img` Hardcode)
- UI-A5-4 / UI-A5-5 / UI-A5-6 (Field-Label-Klarheit, Logo-StorageImage, Render-Pfad-Vereinheitlichung)
- UI-A6-2 / UI-A6-4 / UI-A6-5 (Org-Deaktiv-Gate Sign-Out-Button, Fallback-Copy, Combined-Owner-Banner)
- UI-A7-4 / UI-A7-5 (Nav/Auth-Tab-Strings, Admin Save/Yes/No-Literale)
- UI-A8-3 (Swipe-Reset ohne Confirm)

---

## Empfohlene nächste Schritte (separater Fix-Plan)

1. **Sofort-Blocker (UI-A1-1, UI-A1-2):** Chat-Workspaces auf Mobile vollbild rendern. Pattern aus `clientChatFullscreen` auf `BookingChatView`/Model-Direct/Model-Option übertragen. Eigener Plan, da rollenübergreifend.
2. **High-Sweep (UI-A1-3, UI-A2-1, UI-A4-1, UI-A5-1, UI-A7-1):** kombinierter UI-Polish-PR. Header-Compaction + Kalender-Farb-Helper + `formatMeasurement('—')` + Banner-Source-Switch + `uiCopy.model.alerts.*`.
3. **Inflight-Guard (UI-A3-1):** Schmaler Service-Patch in `optionRequests.ts` für `addOptionRequest`/`createAgencyOnlyOptionRequest` analog L-Pattern.
4. **`uiCopy`-Migration (UI-A6-1, UI-A7-2, UI-A7-3, UI-A7-5):** Bündel-PR „strings to uiCopy" für `PendingActivationScreen`, `ClientOrgProfileScreen`, `AgencyDashboardScreen`, Admin Save/Yes/No, Admin Object-Dump → typed Field-Map.
5. **Confirm-Web-Hardening (UI-A8-1, UI-A8-2, UI-A8-3):** Suche-und-Ersetze auf `showAppAlert`/`showConfirmAlert` für Admin/Billing destruktive Pfade.

**Backend-/Migrationen:** Keine erforderlich (alle Findings UI-/Frontend-Layer). UI-A6-3 (`is_active=false`-Gate) eventuell Produkt-Diskussion.

**Regression-Sweep:** Bei Header-Compaction + Mobile-Chat-Fix → vollständiger §2d-Sweep aus `auto-review.mdc` (Discover, Package, Project, Messenger, Kalender, Smart Attention) auf 4 Rollen × 2 Form-Faktoren.

---

## Audit-Metadaten

- **Datum:** 2026-04-19
- **Auditoren:** 8 parallele Explore-Subagents (Achse 1–8)
- **Total geprüfte Dateien:** ~80 (Stichprobe; ein Vollscan über `src/**/*.tsx` würde weitere Polish-Findings produzieren — siehe Achse 7 Hinweis)
- **Modus:** Read-only, keine Code-Änderungen
- **Output:** dieser Report
