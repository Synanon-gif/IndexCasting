# Verzeichnis von Verarbeitungstätigkeiten gemäß Art. 30 DSGVO

Stand: 26. Mai 2026

Verantwortlicher: Ruben Helge, Einzelunternehmen, Hausmat 20, 77723 Gengenbach, Deutschland

E-Mail: ruben@index-casting.com

Website / Plattform: Index Casting

Datenschutzkontakt: Ruben Helge, E-Mail: ruben@index-casting.com

**[Hinweis zur Adressschreibweise:** Derzeit „Hausmat 20“ — bitte vor Veröffentlichung prüfen.]

## Teil A — Verarbeitungstätigkeiten als Verantwortlicher

### 1. Betrieb der Website und Plattform

Zwecke:

- Bereitstellung der Website und Plattform.
- Login, Session-Verwaltung und Nutzerzugang.
- Stabilität, Sicherheit und Missbrauchserkennung.
- Anzeige öffentlicher Informationsseiten und Legal-Dokumente.

Betroffene Personen: Website-Besucher, registrierte Nutzer, Agenturen, Kunden, Models, Gäste über Guestlinks

Datenkategorien: IP-Adresse, Zeitstempel, Browser-/Gerätedaten, Sessiondaten, technische Logdaten, Cookie-/Local-Storage-Daten, Fehlerdiagnosedaten

Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO, soweit zur Vertragserfüllung erforderlich; Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an sicherem und stabilem Betrieb; Art. 6 Abs. 1 lit. c DSGVO, soweit gesetzliche Pflichten bestehen.

Empfänger: Supabase; **Vercel** (Hosting, im Repo konfiguriert — **[TODO: produktiv bestätigen]**); **Sentry** (Fehlerdiagnose, wenn `EXPO_PUBLIC_SENTRY_DSN` gesetzt — **[TODO: produktiv bestätigen]**)

Löschfristen: technische Logs grundsätzlich kurzfristig, typischerweise 7 bis 90 Tage; sicherheitsrelevante Logs länger, soweit erforderlich; Accountbezogene Daten nach Vertragsende gemäß Löschkonzept.

### 2. Nutzerkonten und Vertragsverwaltung

Zwecke: Registrierung und Verwaltung von Nutzerkonten; Durchführung von Nutzungsverträgen; Rollen- und Rechteverwaltung; Plattformzugang für Agency, Client, Model und Admin; Verwaltung von Organisationen und Teammitgliedern.

Betroffene Personen: Agency Owner, Booker, Client Owner, Employees, Models, Admins

Datenkategorien: Name, E-Mail-Adresse, Rolle, Organisation, Login-/Accountdaten, Statusdaten, Legal-Acceptance-Daten, Deaktivierungs-/Löschstatus

Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO; Art. 6 Abs. 1 lit. f DSGVO; Art. 6 Abs. 1 lit. c DSGVO für Nachweispflichten.

Empfänger: Supabase, E-Mail-Dienstleister, Support-/Diagnosedienstleister

Löschfristen: Dauer der Vertragsbeziehung; nach Löschverlangen grundsätzlich Deaktivierung und Löschung/Anonymisierung nach 30 Tagen, soweit keine Aufbewahrungspflichten bestehen; Legal-Nachweise nach gesetzlicher Erforderlichkeit.

### 3. Abonnement, Zahlung und Abrechnung

Zwecke: Verwaltung kostenpflichtiger Pläne; Zahlungsabwicklung; Rechnungserstellung; Zahlungsstatus und Zugriffskontrolle; Betrugs- und Missbrauchsprävention.

Betroffene Personen: Agency Owner, Client Owner (soweit kostenpflichtige Funktionen genutzt werden), Rechnungskontakte

Datenkategorien: Name/Firma, Rechnungsadresse, E-Mail-Adresse, Planinformationen, Zahlungsstatus, Rechnungsbeträge, Transaktionsreferenzen, Stripe-Kunden-ID, Rechnungsnummern

Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO; Art. 6 Abs. 1 lit. c DSGVO; Art. 6 Abs. 1 lit. f DSGVO.

Empfänger: Stripe, Steuerberater/Buchhaltung (soweit eingesetzt), Behörden (soweit gesetzlich erforderlich)

Löschfristen: handels- und steuerrechtliche Aufbewahrung grundsätzlich sechs bis zehn Jahre; Zahlungsdaten bei Stripe nach deren Regelungen.

### 4. Support und Kommunikation

Zwecke: Bearbeitung von Supportanfragen; Kommunikation mit Nutzern; Dokumentation technischer oder vertraglicher Anliegen; Verbesserung der Plattformfunktionen.

Betroffene Personen: registrierte Nutzer, Interessenten, Ansprechpartner bei Agenturen/Kunden, Models

Datenkategorien: Kontaktdaten, Kommunikationsinhalte, technische Informationen, Nutzerrolle, Organisation, Fehlerbeschreibungen, ggf. Screenshots oder Anhänge

Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO; Art. 6 Abs. 1 lit. f DSGVO.

Empfänger: **Resend** (transaktional); **Proton Mail** (Betreiber-Support-Postfach); technische Dienstleister; **Mistral AI** (optionaler AI Help Assistant, sofern `MISTRAL_API_KEY` gesetzt und genutzt — **[TODO: produktiv bestätigen]**)

Löschfristen: solange zur Bearbeitung erforderlich; danach Löschung oder Anonymisierung nach internen Fristen; längere Aufbewahrung bei rechtlichen Ansprüchen möglich.

### 5. Sicherheit, Audit und Missbrauchserkennung

Zwecke: Schutz der Plattform; Erkennung unbefugter Zugriffe; Nachvollziehbarkeit kritischer Vorgänge; Dokumentation von Buchungen, Preisänderungen, Uploads, Admin-Aktionen, Mitgliedschaftsänderungen; Rechtsverteidigung.

Betroffene Personen: alle Nutzergruppen

Datenkategorien: Nutzer-ID, Organisation-ID, Aktion, Zeitstempel, IP-Adresse (soweit verarbeitet), technische Metadaten, alte/neue Werte bei kritischen Änderungen, Sicherheitsereignisse

Rechtsgrundlagen: Art. 6 Abs. 1 lit. f DSGVO; Art. 6 Abs. 1 lit. c DSGVO (soweit gesetzliche Pflichten bestehen).

Empfänger: Supabase, Monitoring-/Diagnosedienstleister, Behörden/Gerichte (soweit erforderlich)

Löschfristen: je nach Zweck kurzfristig bis längerfristig; Audit- und Sicherheitslogs nach interner Retention; Anonymisierung, sobald Personenbezug nicht mehr erforderlich ist.

### 6. Model-Accounts und Model-Profile

Zwecke: Verwaltung von Model-Accounts; Darstellung von Model-Profilen; Teilnahme an Castings, Optionen, Buchungen und Bewerbungen; Kommunikation mit Agenturen; Kalender- und Statusübersicht; Standort-/Verfügbarkeitsfunktionen (soweit aktiviert).

Betroffene Personen: Models, Bewerber-Models

Datenkategorien: Name, Künstlername (falls vorhanden), E-Mail-Adresse, Wohnort/Stadt, optionale Standortdaten, Maße und Profildaten, Bilder/Sedcards/Portfolio-Medien, Nachrichten, Kalenderdaten, Bewerbungsdaten, Agenturzuordnungen, Claim-/Invite-Daten

Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO; Art. 6 Abs. 1 lit. f DSGVO; Art. 6 Abs. 1 lit. a DSGVO (soweit Einwilligungen erforderlich); Art. 9 DSGVO nur soweit besondere Kategorien ausnahmsweise verarbeitet werden und eine geeignete Rechtsgrundlage besteht.

Empfänger: Agenturen, Unternehmenskunden (soweit freigegeben), Supabase, Storage-/Hosting-Dienstleister, ggf. Guestlink-Empfänger im freigegebenen Umfang

Löschfristen: während aktiver Nutzung; nach Kontolöschung gemäß Löschkonzept; Agenturverwaltete Daten können im Verantwortungsbereich der Agentur verbleiben, soweit rechtlich zulässig.

### 7. Guestlinks und externe Ansichten

Zwecke: Zeitlich oder zweckgebundene Freigabe bestimmter Model-Selections, Pakete oder Projektinformationen an externe Empfänger; Nachvollziehbarkeit von Zugriffen; Widerruf und Zugriffskontrolle.

Betroffene Personen: Models, Gastlink-Empfänger, Agenturen/Kunden

Datenkategorien: tokenbasierte Zugriffsdaten, freigegebene Model-/Projektinformationen, Zugriffzeitpunkte, technische Metadaten

Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO; Art. 6 Abs. 1 lit. f DSGVO; ggf. Art. 6 Abs. 1 lit. a DSGVO (soweit Einwilligung erforderlich).

Empfänger: vom Nutzer ausgewählte Gastlink-Empfänger, Hosting-/Infrastruktur-Dienstleister

Löschfristen: Ablauf oder Widerruf des Guestlinks; Zugriffsdaten nach Sicherheits-/Nachweisfrist.

## Teil B — Verarbeitungstätigkeiten als Auftragsverarbeiter

### 8. Plattformdaten im Auftrag von Agenturen

Auftraggeber: jeweilige Agentur

Zwecke: Speicherung und Organisation von Model-Profilen; Verwaltung von Bewerbungen; Verwaltung von Castings, Optionen, Buchungen, Kundenprojekten; Kommunikation mit Kunden und Models; Kalender- und Teamfunktionen; Bereitstellung von Paketen und Guestlinks.

Betroffene Personen: Models, Bewerber, Booker, Kundenansprechpartner, Gastlink-Empfänger, sonstige projektbezogene Personen

Datenkategorien: Model-Stammdaten, Model-Medien, Maße/Profildaten, Bewerbungsdaten, Projekt- und Buchungsdaten, Kommunikationsinhalte, Kalenderdaten, Kundendaten, interne Notizen, Dateien/Anhänge

Kategorien von Empfängern: Supabase, **Vercel** (Hosting — **[TODO: produktiv bestätigen]**), **Resend** (transaktional), **Proton Mail** (Betreiber-Kontakt), **Mistral AI** (optional — **[TODO: produktiv bestätigen]**), vom Auftraggeber freigegebene Kunden/Gäste

Drittlandtransfer: möglich bei Einsatz internationaler Dienstleister; Absicherung durch Standardvertragsklauseln, Angemessenheitsbeschluss oder zusätzliche Maßnahmen, soweit erforderlich.

Löschung: nach Weisung des Auftraggebers; nach Vertragsende gemäß AVV und Löschkonzept; standardmäßig Löschung/Anonymisierung nach 30 Tagen, soweit keine gesetzlichen Pflichten entgegenstehen.

TOMs: siehe TOM-Dokument (`/legal/toms`).

### 9. Plattformdaten im Auftrag von Unternehmenskunden

Auftraggeber: jeweiliger Unternehmenskunde

Zwecke: Verwaltung von Projekten; Erstellung von Casting- und Buchungsanfragen; Kommunikation mit Agenturen; Verwaltung von Selections; Kalenderfunktionen; Nachvollziehbarkeit von Plattformgeschäften.

Betroffene Personen: Mitarbeitende des Kunden, Agenturansprechpartner, Models, externe Projektbeteiligte

Datenkategorien: Projektinformationen, Rollenbeschreibungen, Casting-/Bookingdaten, Preis-/Honorarvorschläge, Kommunikationsinhalte, Kalenderdaten, Teamdaten, Dateien/Anhänge

Kategorien von Empfängern: Supabase, **Vercel** (Hosting — **[TODO: produktiv bestätigen]**), **Resend** (transaktional), beteiligte Agenturen, Stripe bei Plattformgeschäften, **Mistral AI** (optional — **[TODO: produktiv bestätigen]**)

Drittlandtransfer: möglich bei Einsatz internationaler Dienstleister; Absicherung durch geeignete Garantien.

Löschung: nach Weisung des Auftraggebers; nach Vertragsende gemäß AVV und Löschkonzept; gesetzliche Aufbewahrungspflichten bleiben unberührt.

TOMs: siehe TOM-Dokument (`/legal/toms`).

Unterauftragsverarbeiterliste: siehe gesondertes Dokument (`/legal/subprocessors`).
