# Technische und organisatorische Maßnahmen gemäß Art. 32 DSGVO

Stand: 26. Mai 2026

Verantwortlicher / Anbieter: Ruben Helge, Einzelunternehmen, Betreiber der Plattform „Index Casting“

## 1. Zweck dieses Dokuments

Dieses Dokument beschreibt die technischen und organisatorischen Maßnahmen, die zum Schutz personenbezogener Daten im Rahmen des Betriebs der Plattform „Index Casting“ eingesetzt werden. Die Maßnahmen dienen insbesondere der Sicherstellung von Vertraulichkeit, Integrität, Verfügbarkeit und Belastbarkeit der Systeme sowie der Fähigkeit, personenbezogene Daten bei einem technischen oder physischen Zwischenfall wiederherzustellen.

Die Plattform verarbeitet insbesondere Daten von Agenturen, deren Mitarbeitenden, Unternehmenskunden, Models, Bewerbern, Kommunikationspartnern und Gastlink-Nutzern. Je nach Nutzung verarbeitet Index Casting Daten als eigener Verantwortlicher und teilweise als Auftragsverarbeiter für Agenturen oder Unternehmenskunden.

## 2. Zutrittskontrolle

Index Casting betreibt die Plattform cloudbasiert. Eigene Serverräume werden nicht betrieben. Der physische Zutritt zu Rechenzentren liegt bei den eingesetzten Infrastruktur- und Hosting-Dienstleistern.

Maßnahmen:

- Einsatz professioneller Cloud-/Hosting-Dienstleister.
- Physischer Rechenzentrumszugang nur durch berechtigte Personen des jeweiligen Dienstleisters.
- Keine lokale Speicherung produktiver Daten auf frei zugänglichen Geräten.
- Zugriff auf lokale Entwicklungsgeräte nur durch berechtigte Personen.
- Geräteschutz durch Betriebssystem-Login, Passwort bzw. biometrische Sperre, soweit verfügbar.

## 3. Zugangskontrolle

Ziel ist es, unbefugten Zugang zu Systemen, Benutzerkonten und Administrationsbereichen zu verhindern.

Maßnahmen:

- Benutzerregistrierung und Login über Supabase Auth.
- Passwortgeschützte Nutzerkonten.
- Rollenbasierter Zugang für Agency Owner, Booker, Client Owner, Employee, Model, Guest und Admin.
- Admin-Zugriff nur für fest definierte Admin-Identität.
- Trennung zwischen normalen Nutzerkonten und administrativen Funktionen.
- Keine Verwendung von service_role-Schlüsseln im Frontend.
- Zugriff auf produktive Systeme nur durch berechtigte Entwickler/Betreiber.
- Geheimnisse und API-Schlüssel werden nicht im Repository gespeichert.
- Session-Verwaltung über technisch notwendige Cookies bzw. Local Storage.
- Plattformzugang für registrierte Nutzer erst nach erforderlicher Annahme von Nutzungsbedingungen und Datenschutzhinweisen.

## 4. Zugriffskontrolle

Ziel ist es, sicherzustellen, dass berechtigte Nutzer nur auf die Daten zugreifen können, die ihrer Rolle und Organisation zugeordnet sind.

Maßnahmen:

- Multi-Tenant-Architektur mit organisationsbezogener Datenisolation.
- Row Level Security (RLS) in Supabase/Postgres.
- Backendseitige Zugriffskontrollen für organisationsbezogene Daten.
- Rollen- und Rechtekonzept:
  - Agency Owner: Verwaltung der Agentur, Mitglieder, Billing, Organisation.
  - Booker: operative Agenturfunktionen ohne Owner-exklusive Rechte.
  - Client Owner: Verwaltung der Kundenorganisation, Mitglieder, Billing, Organisation.
  - Employee: operative Kundenfunktionen ohne Owner-exklusive Rechte.
  - Model: Zugriff auf eigene bzw. zugeordnete Model-Funktionen.
  - Guest: beschränkter tokenbasierter Zugriff.
  - Admin: separat geschützter Plattform-Admin.
- Zugriff auf private Dateien grundsätzlich über signierte URLs bzw. gesicherte Storage-Regeln.
- Guestlinks sind tokenbasiert, zweckgebunden und widerrufbar bzw. zeitlich beschränkbar.
- Keine bewusste organisationsübergreifende Sichtbarkeit außer ausdrücklich vorgesehene Plattformfunktionen wie B2B-Kommunikation, Model-Pakete oder Guestlinks.

## 5. Weitergabekontrolle

Ziel ist es, unbefugte Offenlegung oder Übermittlung personenbezogener Daten zu verhindern.

Maßnahmen:

- Transportverschlüsselung per HTTPS/TLS.
- Eingeschränkter Zugriff auf Supabase, Stripe und weitere Dienstleisterkonten.
- Einsatz von Auftragsverarbeitungsverträgen mit relevanten Dienstleistern, soweit diese als Auftragsverarbeiter tätig werden.
- Drittlandtransfers nur auf Grundlage geeigneter Garantien, z. B. Standardvertragsklauseln, soweit erforderlich.
- Zahlungsdaten werden primär durch Stripe verarbeitet; Index Casting speichert keine vollständigen Kreditkartendaten.
- Dateien und Bilder werden über gesicherte Storage-Buckets und Zugriffskontrollen bereitgestellt.
- Keine öffentliche Indexierung privater Plattformdaten.

## 6. Eingabekontrolle

Ziel ist es, nachvollziehen zu können, welche relevanten Vorgänge durch Nutzer oder Systeme ausgelöst wurden.

Maßnahmen:

- Speicherung von Nutzer-IDs und Zeitpunkten bei relevanten Datenbankvorgängen.
- Audit-Logging für kritische Vorgänge wie Buchungen, Preisänderungen, Uploads, Admin-Overrides und Mitgliedschaftsänderungen.
- Consent-/Legal-Acceptance-Protokollierung für Annahme von Nutzungsbedingungen, Datenschutzhinweisen und relevanten Einwilligungen.
- Speicherung technischer Logs zur Fehleranalyse, Sicherheit und Missbrauchserkennung.
- Trennung von produktiven Nutzerdaten und Entwicklungs-/Testdaten soweit technisch umgesetzt.

## 7. Auftragskontrolle

Ziel ist es, sicherzustellen, dass personenbezogene Daten, die im Auftrag verarbeitet werden, nur entsprechend dokumentierter Weisungen verarbeitet werden.

Maßnahmen:

- Abschluss eines Auftragsverarbeitungsvertrags mit Agenturen und Unternehmenskunden, soweit Index Casting als Auftragsverarbeiter tätig wird.
- Verarbeitung im Rahmen der vereinbarten Plattformfunktionen und Weisungen.
- Einsatz von Unterauftragsverarbeitern nur auf Grundlage entsprechender Verträge.
- Führen einer Unterauftragsverarbeiterliste.
- Möglichkeit des Widerspruchs gegen neue Unterauftragsverarbeiter nach Maßgabe des AVV.
- Unterstützung bei Betroffenenrechten, Datenschutzverletzungen und Lösch-/Exportanfragen im Rahmen der technischen Möglichkeiten.

## 8. Verfügbarkeitskontrolle

Ziel ist es, personenbezogene Daten gegen zufällige Zerstörung oder Verlust zu schützen und den Plattformbetrieb stabil zu halten.

Maßnahmen:

- Einsatz professioneller Cloud-Infrastruktur.
- Datenbank-Backups durch den Infrastruktur-/Datenbankdienstleister nach dessen technischen Standards.
- Wiederherstellbarkeit im Rahmen der eingesetzten Dienstleisterfunktionen.
- Monitoring und Fehlerdiagnose, soweit eingerichtet.
- Nutzung von **Sentry** (`EXPO_PUBLIC_SENTRY_DSN`) nur zur Fehleranalyse, Stabilität und Sicherheit, nicht für werbliches Tracking — **[TODO: produktiv bestätigen, ob DSN in Production/Preview gesetzt ist]**; in `development` ohnehin deaktiviert.
- Technische Maßnahmen gegen Missbrauch, etwa Rate Limits für relevante Funktionen.
- Regelmäßige Tests, Typechecks und Linting im Entwicklungsprozess.

## 9. Trennungsgebot

Ziel ist es, Daten unterschiedlicher Mandanten, Organisationen und Zwecke getrennt zu verarbeiten.

Maßnahmen:

- Mandantentrennung über Organisationen, Rollen, RLS und backendseitige Prüfungen.
- Trennung von Agency-, Client-, Model-, Guest- und Admin-Kontexten.
- Trennung zwischen Plattformbetrieb, Zahlungsabwicklung, Support, Audit-Logs und Auftragsverarbeitungen.
- Trennung zwischen produktiven Daten und lokalen Entwicklungsdaten.
- Keine Vermischung von Model-Accounts mit Organisation-Memberships; Models werden separat über Model-/Agency-Zuordnungen verwaltet.

## 10. Pseudonymisierung, Verschlüsselung und Datenminimierung

Maßnahmen:

- Transportverschlüsselung per HTTPS/TLS.
- Speicherung sensibler Authentifizierungsinformationen über Supabase Auth.
- Zugriff auf Dateien über kontrollierte Storage-Regeln bzw. signierte URLs.
- Minimierung von im KI-/Support-Kontext eingegebenen personenbezogenen Daten durch Hinweise an Nutzer; optionaler **AI Help Assistant** über **Mistral AI** (Edge Function `ai-assistant`, Secret `MISTRAL_API_KEY`) — nur nach In-App-Einwilligung; **[TODO: produktiv bestätigen, ob API-Key gesetzt und Feature freigegeben ist]**.
- Anonymisierung oder Löschung personenbezogener Daten nach Ablauf definierter Fristen, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
- Kein Speichern vollständiger Zahlungsdaten durch Index Casting.

## 11. Datenschutz durch Technikgestaltung und datenschutzfreundliche Voreinstellungen

Maßnahmen:

- Plattformzugang erst nach Annahme erforderlicher Legal-Dokumente.
- Optionalität von GPS-/Standortfunktionen für Models.
- Standortanzeige nur ungefähr bzw. zweckbezogen, soweit technisch umgesetzt.
- Rollen- und Rechteverwaltung für Organisationen.
- Widerrufbare Guestlinks.
- Consent-/Legal-Acceptance-Protokollierung.
- Lösch- und Anonymisierungsprozesse für Account- und Organisationsdaten.
- Keine Marketing-/Analyse-Cookies ohne gesonderte Einwilligung.

## 12. Umgang mit Datenschutzverletzungen

Maßnahmen:

- Prüfung und Dokumentation von Sicherheitsvorfällen.
- Interne Bewertung nach Art, Umfang und Risiko des Vorfalls.
- Benachrichtigung betroffener Verantwortlicher, soweit Index Casting als Auftragsverarbeiter betroffen ist.
- Meldung an Aufsichtsbehörden bzw. Betroffene, soweit Index Casting hierfür verantwortlich ist und gesetzliche Voraussetzungen vorliegen.
- Technische und organisatorische Nachbereitung zur Verhinderung gleichartiger Vorfälle.

## 13. Unterauftragsverarbeiter / Dienstleister

Aktuell bzw. typischerweise eingesetzte Dienstleister (Code-/Env-Stand im Repository; produktive Secrets siehe TODOs):

- **Supabase:** Authentifizierung, Datenbank, Storage, Realtime, Edge Functions.
- **Stripe:** Zahlungsabwicklung, Rechnungen, Zahlungsstatus.
- **Vercel:** Hosting/Deployment der Web-App (`vercel.json`) — **[TODO: Live-Hosting final bestätigen]**.
- **Resend:** Transaktionaler E-Mail-Versand (`RESEND_API_KEY` in Supabase Secrets).
- **Proton Mail:** Geschäftliches Kontakt-Postfach des Betreibers (nicht als Versand-API im Code).
- **Sentry:** Fehlerdiagnose (`EXPO_PUBLIC_SENTRY_DSN`) — **[TODO: DSN in Production/Preview gesetzt?]**.
- **Mistral AI:** Optionaler AI Help Assistant (`MISTRAL_API_KEY`) — **[TODO: Key gesetzt und Feature live?]**.

Hinweis: Die konkrete Liste ist als gesonderte Unterauftragsverarbeiterliste aktuell zu halten (siehe `/legal/subprocessors`).

## 14. Überprüfung und Aktualisierung

Die TOMs werden regelmäßig und anlassbezogen überprüft, insbesondere bei:

- wesentlichen technischen Änderungen,
- Einführung neuer Dienstleister,
- Einführung neuer Datenkategorien,
- Sicherheitsvorfällen,
- Änderungen rechtlicher Anforderungen.
