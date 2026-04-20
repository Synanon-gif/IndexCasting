/**
 * PackageImportPane — Agency-facing UI für den MediaSlide Package Import (Phase 2).
 *
 * Zustände (State Machine):
 *   idle → analyzing → previewing → committing → done
 *
 * Designprinzipien:
 *  - Ehrliche Statusanzeige: Fortschritt, Anzahl Models, Anzahl Bilder, Warnungen.
 *  - Phase 2: Bilder werden beim Commit kontrolliert heruntergeladen, validiert
 *    und in unseren Storage persistiert (`model_photos` + Mirror-Rebuild). Das
 *    Model bleibt damit unabhängig vom externen Provider, sobald der Import
 *    durch ist. Der Commit-Schritt dauert dadurch deutlich länger als die
 *    reine Modell-Anlage; die UI zeigt pro Bild Fortschritt, partielle
 *    Fehlertypen und persistierte Bildanzahl pro Model.
 *  - Vor dem Commit kann die Agency Models einzeln deselektieren.
 *  - Cancel-Button (AbortController) während Analyse + Commit. Cancel wirkt
 *    zwischen Bildern bzw. zwischen Models — kein Mid-Image-Rollback.
 *  - Pure Komponente: KEINE direkten DB-Zugriffe; orchestriert über `commitPreview`,
 *    das `importModelAndMerge` und anschließend `persistImagesForPackageImport`
 *    aufruft (RLS / Org-Scoping / GDPR-Audit bleiben erhalten).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getProviderForUrl } from '../services/providerRegistry';
import {
  PACKAGE_IMPORT_LIMITS,
  isParserDriftError,
  type AnalyzeProgress,
  type CommitOutcome,
  type CommitProgress,
  type CommitSummary,
  type DriftResult,
  type PackageProvider,
  type PreviewModel,
} from '../services/packageImportTypes';
import { commitPreview, toPreviewModels } from '../services/packageImporter';

type Props = {
  agencyId: string;
  /** Wird aufgerufen, wenn min. 1 Model angelegt/aktualisiert wurde. */
  onModelsChanged?: () => void;
};

type Phase =
  | 'idle'
  | 'analyzing'
  | 'previewing'
  | 'committing'
  | 'done'
  | 'drift_blocked'
  | 'drift_override_confirm';

export const PackageImportPane: React.FC<Props> = ({ agencyId, onModelsChanged }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(null);
  const [previews, setPreviews] = useState<PreviewModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forceMeasurements, setForceMeasurements] = useState(false);

  const [commitProgress, setCommitProgress] = useState<CommitProgress | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);

  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [overrideText, setOverrideText] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const totalReady = useMemo(() => previews.filter((p) => p.status === 'ready').length, [previews]);
  const totalSkipped = previews.length - totalReady;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setError(null);
    setAnalyzeProgress(null);
    setPreviews([]);
    setSelected(new Set());
    setCommitProgress(null);
    setSummary(null);
    setDrift(null);
    setOverrideText('');
  }, []);

  const runAnalyze = useCallback(
    async (provider: PackageProvider, allowDriftBypass: boolean) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setPhase('analyzing');
      setAnalyzeProgress({ phase: 'fetch_list', modelsTotal: 0, modelsDone: 0 });

      try {
        const payloads = await provider.analyze({
          url: url.trim(),
          signal: ctrl.signal,
          onProgress: (p) => setAnalyzeProgress(p),
          onDrift: (d) => setDrift(d),
          allowDriftBypass,
        });
        if (payloads.length > PACKAGE_IMPORT_LIMITS.MAX_MODELS_PER_RUN) {
          throw new Error(
            `Package enthält ${payloads.length} Models (Limit ${PACKAGE_IMPORT_LIMITS.MAX_MODELS_PER_RUN}).`,
          );
        }
        const built = toPreviewModels(payloads);
        setPreviews(built);
        setSelected(new Set(built.filter((p) => p.status === 'ready').map((p) => p.externalId)));
        setPhase('previewing');
      } catch (e) {
        if ((e as Error).message === 'aborted') {
          reset();
          return;
        }
        if (isParserDriftError(e)) {
          console.warn('[package-import drift]', JSON.stringify(e.drift));
          setDrift(e.drift);
          setPhase('drift_blocked');
          return;
        }
        setError(humaniseError((e as Error).message));
        setPhase('idle');
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [url, reset],
  );

  const handleAnalyze = useCallback(async () => {
    setError(null);
    setDrift(null);
    if (!url.trim()) {
      setError('Bitte gib einen Package-Link ein (MediaSlide oder Netwalk).');
      return;
    }
    if (!agencyId) {
      setError('Keine Agency-Zuordnung gefunden.');
      return;
    }

    const provider = getProviderForUrl(url.trim());
    if (!provider) {
      setError(humaniseError('provider_not_supported'));
      return;
    }

    await runAnalyze(provider, false);
  }, [url, agencyId, runAnalyze]);

  const handleOverrideRequest = useCallback(() => {
    setOverrideText('');
    setPhase('drift_override_confirm');
  }, []);

  const handleOverrideCancel = useCallback(() => {
    setOverrideText('');
    setPhase('drift_blocked');
  }, []);

  const handleOverrideConfirm = useCallback(async () => {
    if (overrideText.trim().toUpperCase() !== 'OVERRIDE') return;
    const provider = getProviderForUrl(url.trim());
    if (!provider) {
      setError(humaniseError('provider_not_supported'));
      setPhase('idle');
      return;
    }
    // Drift-Override: Re-Analyse mit allowDriftBypass=true. Drift-Banner bleibt
    // sichtbar (drift state wird nicht gelöscht). ABER: der Importer wendet
    // weiterhin alle Pflichtfeld-Checks an (`missing_external_id`, `missing_name`,
    // `missing_height`, `no_images`, `forceSkipReason`). Damit bleibt die DB
    // selbst im Override-Pfad sicher.
    setOverrideText('');
    await runAnalyze(provider, true);
  }, [overrideText, url, runAnalyze]);

  const handleCommit = useCallback(async () => {
    if (phase !== 'previewing') return;
    const toCommit = previews.filter((p) => p.status === 'ready' && selected.has(p.externalId));
    if (toCommit.length === 0) {
      setError('Bitte mindestens ein Model auswählen.');
      return;
    }
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('committing');
    setCommitProgress({ total: toCommit.length, done: 0 });

    try {
      const result = await commitPreview({
        selected: toCommit,
        agencyId,
        options: {
          forceUpdateMeasurements: forceMeasurements,
          // Phase 2: physische Bild-Persistenz aktiv. UI-Default → true.
          // Tests können das via direktem Service-Aufruf umgehen.
          persistImages: true,
        },
        signal: ctrl.signal,
        onProgress: (p) => setCommitProgress(p),
      });
      setSummary(result);
      setPhase('done');
      if (result.createdCount + result.mergedCount > 0) {
        onModelsChanged?.();
      }
    } catch (e) {
      setError(humaniseError((e as Error).message));
      setPhase('previewing');
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [phase, previews, selected, agencyId, forceMeasurements, onModelsChanged]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const toggleSelected = useCallback((externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MediaSlide Package importieren</Text>
      <Text style={styles.description}>
        Füge einen MediaSlide-Package-Link ein. Wir lesen Models, Maße und Bild-URLs aus und zeigen
        sie dir vor dem Anlegen zur Bestätigung.
      </Text>
      <Text style={styles.hint}>
        Hinweis (Phase 2 aktiv): Bilder werden beim Import kontrolliert in unseren Storage kopiert
        (HEIC→JPEG, EXIF entfernt, MIME/Magic-Bytes geprüft). Das importierte Model bleibt damit
        unabhängig vom Package — auch wenn der Link später deaktiviert wird. Der Commit dauert
        dadurch länger; partielle Bild-Fehler werden pro Model gemeldet. Cap pro Model: max.{' '}
        {PACKAGE_IMPORT_LIMITS.MAX_PORTFOLIO_IMAGES_PER_MODEL} Portfolio +{' '}
        {PACKAGE_IMPORT_LIMITS.MAX_POLAROIDS_PER_MODEL} Polaroids.
      </Text>

      {phase === 'idle' && (
        <>
          <TextInput
            style={styles.input}
            placeholder="https://{tenant}.mediaslide.com/package/view/…"
            placeholderTextColor={colors.textSecondary}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!!agencyId}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, (!url.trim() || !agencyId) && styles.btnDisabled]}
            onPress={handleAnalyze}
            disabled={!url.trim() || !agencyId}
          >
            <Text style={styles.primaryBtnLabel}>Package analysieren</Text>
          </TouchableOpacity>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </>
      )}

      {phase === 'analyzing' && (
        <View style={styles.progressBox}>
          <ActivityIndicator size="small" color={colors.accentGreen} />
          <Text style={styles.progressText}>{renderAnalyzeLabel(analyzeProgress)}</Text>
          <Text style={styles.subtleNote}>
            Bei vielen Models kann das mehrere Minuten dauern (1 HTTP pro Album).
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel}>
            <Text style={styles.secondaryBtnLabel}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'drift_blocked' && drift && (
        <View style={{ marginTop: spacing.md }}>
          <DriftBanner drift={drift} severity="hard_block" />
          <Text style={styles.warnText}>
            Aus Sicherheitsgründen wurde der Import blockiert. Es kann sein, dass{' '}
            {drift.providerId === 'mediaslide' ? 'MediaSlide' : drift.providerId} sein Layout
            geändert hat. Du kannst manuell überschreiben — der Importer schützt die DB weiterhin
            durch Pflichtfeld-Checks (Höhe, Bilder, externalId).
          </Text>
          <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset}>
              <Text style={styles.secondaryBtnLabel}>Abbrechen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.buttonSkipRed }]}
              onPress={handleOverrideRequest}
            >
              <Text style={[styles.secondaryBtnLabel, { color: colors.buttonSkipRed }]}>
                Override anfordern…
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === 'drift_override_confirm' && drift && (
        <View style={{ marginTop: spacing.md }}>
          <DriftBanner drift={drift} severity="hard_block" />
          <Text style={styles.warnText}>
            Du übersteuerst eine harte Drift-Warnung. Tippe das Wort{' '}
            <Text style={{ fontWeight: '700' }}>OVERRIDE</Text> ein, um trotzdem zu analysieren. Der
            Drift bleibt für diesen Lauf protokolliert.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="OVERRIDE"
            placeholderTextColor={colors.textSecondary}
            value={overrideText}
            onChangeText={setOverrideText}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={[styles.row, { marginTop: spacing.sm, gap: spacing.sm }]}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleOverrideCancel}>
              <Text style={styles.secondaryBtnLabel}>Zurück</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { backgroundColor: colors.buttonSkipRed },
                overrideText.trim().toUpperCase() !== 'OVERRIDE' && styles.btnDisabled,
              ]}
              onPress={handleOverrideConfirm}
              disabled={overrideText.trim().toUpperCase() !== 'OVERRIDE'}
            >
              <Text style={styles.primaryBtnLabel}>Override bestätigen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === 'previewing' && (
        <View style={{ marginTop: spacing.md }}>
          {drift && drift.severity !== 'ok' && (
            <DriftBanner drift={drift} severity={drift.severity} />
          )}
          <Text style={styles.subtitle}>
            Erkannt: {previews.length} Model(s) — bereit: {totalReady}
            {totalSkipped > 0 ? `, übersprungen: ${totalSkipped}` : ''}
          </Text>
          {previews.length > PACKAGE_IMPORT_LIMITS.SOFT_MODELS_PER_RUN && (
            <Text style={styles.warnText}>
              Großer Import ({previews.length} Models). Der Vorgang läuft sequentiell und kann
              mehrere Minuten dauern.
            </Text>
          )}
          {previews.map((p) => (
            <PreviewRow
              key={p.externalId}
              preview={p}
              selected={selected.has(p.externalId)}
              onToggle={() => toggleSelected(p.externalId)}
            />
          ))}

          <TouchableOpacity
            style={[styles.row, { marginTop: spacing.md }]}
            onPress={() => setForceMeasurements((v) => !v)}
          >
            <View style={[styles.checkbox, forceMeasurements && styles.checkboxOn]}>
              {forceMeasurements && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              Bestehende Maße bei bekannten Models überschreiben (sonst werden nur Lücken gefüllt)
            </Text>
          </TouchableOpacity>

          <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }, selected.size === 0 && styles.btnDisabled]}
              onPress={handleCommit}
              disabled={selected.size === 0}
            >
              <Text style={styles.primaryBtnLabel}>{selected.size} Model(s) importieren</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset}>
              <Text style={styles.secondaryBtnLabel}>Verwerfen</Text>
            </TouchableOpacity>
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      )}

      {phase === 'committing' && (
        <View style={styles.progressBox}>
          <ActivityIndicator size="small" color={colors.accentGreen} />
          <Text style={styles.progressText}>
            Importiere {commitProgress?.done ?? 0}/{commitProgress?.total ?? 0}
            {commitProgress?.currentLabel ? ` – ${commitProgress.currentLabel}` : ''}
          </Text>
          <Text style={styles.subtleNote}>
            Bilder werden geladen, validiert und in den Storage kopiert. Das kann pro Model mehrere
            Sekunden dauern.
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel}>
            <Text style={styles.secondaryBtnLabel}>Nach aktuellem Model stoppen</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'done' && summary && (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.subtitle}>Import abgeschlossen</Text>
          <SummaryLine label="Neu angelegt" value={summary.createdCount} ok />
          <SummaryLine label="Aktualisiert" value={summary.mergedCount} ok />
          {summary.warningCount > 0 && (
            <SummaryLine label="Warnungen" value={summary.warningCount} />
          )}
          {summary.skippedCount > 0 && (
            <SummaryLine label="Übersprungen" value={summary.skippedCount} />
          )}
          {summary.errorCount > 0 && <SummaryLine label="Fehler" value={summary.errorCount} bad />}
          {(() => {
            // Summenzeile für Bild-Persistenz (Phase 2): macht den
            // tatsächlichen Mirror-Erfolg auf einen Blick sichtbar.
            const persisted = summary.outcomes.reduce(
              (acc, o) => acc + (o.imagesPersisted ?? 0),
              0,
            );
            const attempted = summary.outcomes.reduce(
              (acc, o) => acc + (o.imagesAttempted ?? 0),
              0,
            );
            if (attempted === 0) return null;
            return (
              <SummaryLine
                label="Bilder persistiert"
                value={persisted}
                ok={persisted === attempted}
                bad={persisted === 0}
              />
            );
          })()}
          <View style={{ marginTop: spacing.sm }}>
            {summary.outcomes
              .filter(
                (o) => o.status === 'error' || o.status === 'warning' || o.status === 'skipped',
              )
              .map((o) => (
                <OutcomeRow key={`${o.externalId}-${o.status}`} outcome={o} />
              ))}
          </View>
          <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
            <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
              <Text style={styles.primaryBtnLabel}>Neuer Import</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const DriftBanner: React.FC<{
  drift: DriftResult;
  severity: 'hard_block' | 'soft_warn' | 'ok';
}> = ({ drift, severity }) => {
  const isHard = severity === 'hard_block';
  const accent = isHard ? colors.buttonSkipRed : colors.textSecondary;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: accent,
        borderRadius: 6,
        padding: spacing.sm,
        marginBottom: spacing.sm,
      }}
    >
      <Text style={[styles.subtitle, { color: accent, marginBottom: spacing.xs }]}>
        {isHard ? 'Drift-Hard-Block' : 'Drift-Warnung'} · {drift.providerId} · {drift.parserVersion}
      </Text>
      <Text style={styles.previewMeta}>Quelle: {drift.maskedUrl}</Text>
      <Text style={styles.previewMeta}>
        Anker-Coverage: {(drift.anchorCoverage * 100).toFixed(0)}% · Extraction:{' '}
        {(drift.extractionRatio * 100).toFixed(0)}% · Books-OK:{' '}
        {(drift.bookOkRatio * 100).toFixed(0)}%
      </Text>
      <Text style={styles.previewMeta}>
        Karten erkannt: {drift.cardsDetected} · extrahiert: {drift.cardsExtracted}
      </Text>
      {drift.missingAnchors.length > 0 && (
        <Text style={styles.previewWarn}>Fehlende Anker: {drift.missingAnchors.join(', ')}</Text>
      )}
      {drift.reasonCodes.length > 0 && (
        <Text style={styles.previewWarn}>Codes: {drift.reasonCodes.join(', ')}</Text>
      )}
    </View>
  );
};

const PreviewRow: React.FC<{
  preview: PreviewModel;
  selected: boolean;
  onToggle: () => void;
}> = ({ preview, selected, onToggle }) => {
  const isReady = preview.status === 'ready';
  return (
    <TouchableOpacity
      onPress={isReady ? onToggle : undefined}
      activeOpacity={isReady ? 0.6 : 1}
      style={[styles.previewRow, !isReady && styles.previewRowDisabled]}
    >
      <View style={[styles.checkbox, selected && isReady && styles.checkboxOn]}>
        {selected && isReady && <Text style={styles.checkboxMark}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.previewName}>
          {preview.name || '(ohne Namen)'}{' '}
          <Text style={styles.previewMeta}>· #{preview.externalId}</Text>
        </Text>
        {isReady ? (
          <Text style={styles.previewMeta}>
            {preview.measurements.height ? `${preview.measurements.height} cm · ` : ''}
            {preview.portfolio_image_urls.length} Portfolio
            {preview.discardedPortfolio > 0 ? ` (+${preview.discardedPortfolio} verworfen)` : ''}
            {' · '}
            {preview.polaroid_image_urls.length} Polaroids
            {preview.discardedPolaroids > 0 ? ` (+${preview.discardedPolaroids} verworfen)` : ''}
          </Text>
        ) : (
          <Text style={styles.previewWarn}>Übersprungen: {preview.skipReason ?? 'unbekannt'}</Text>
        )}
        {preview.warnings.length > 0 && (
          <Text style={styles.previewWarn}>{preview.warnings.join(' · ')}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const OutcomeRow: React.FC<{ outcome: CommitOutcome }> = ({ outcome }) => {
  const color = outcome.status === 'error' ? colors.buttonSkipRed : colors.textSecondary;
  // Bild-Persistenz-Stats sichtbar machen, sodass die Agency unmittelbar
  // sieht, wie viele Bilder pro Model wirklich in unseren Storage gewandert
  // sind und welche Fehler-Codes aufgetreten sind. Failure-Codes werden
  // gekürzt, um die Outcome-Liste lesbar zu halten.
  const hasImageInfo = (outcome.imagesAttempted ?? 0) > 0;
  const failureSnippets = (outcome.imageFailureReasons ?? []).slice(0, 3);
  const moreFailures =
    (outcome.imageFailureReasons?.length ?? 0) > failureSnippets.length
      ? ` (+${(outcome.imageFailureReasons?.length ?? 0) - failureSnippets.length})`
      : '';
  return (
    <View style={{ marginBottom: 2 }}>
      <Text style={[styles.previewMeta, { color }]}>
        [{outcome.status}] {outcome.name} (#{outcome.externalId})
        {outcome.reason ? ` – ${outcome.reason}` : ''}
      </Text>
      {hasImageInfo && (
        <Text style={styles.previewMeta}>
          Bilder: {outcome.imagesPersisted ?? 0}/{outcome.imagesAttempted ?? 0}
          {failureSnippets.length > 0
            ? ` · Fehler: ${failureSnippets.join(', ')}${moreFailures}`
            : ''}
        </Text>
      )}
    </View>
  );
};

const SummaryLine: React.FC<{
  label: string;
  value: number;
  ok?: boolean;
  bad?: boolean;
}> = ({ label, value, ok, bad }) => (
  <Text
    style={[
      styles.previewMeta,
      ok && { color: colors.accentGreen },
      bad && { color: colors.buttonSkipRed },
    ]}
  >
    {label}: {value}
  </Text>
);

function renderAnalyzeLabel(p: AnalyzeProgress | null): string {
  if (!p) return 'Starte Analyse…';
  if (p.phase === 'fetch_list') return 'Lade Package-Liste…';
  if (p.phase === 'parse') return `Parse ${p.modelsTotal} Model(s)…`;
  return `Lade Books ${p.modelsDone}/${p.modelsTotal}${p.currentLabel ? ` – ${p.currentLabel}` : ''}`;
}

function humaniseError(code: string): string {
  switch (code) {
    case 'package_url_invalid':
      return 'Der Link entspricht nicht dem MediaSlide-Package-Format.';
    case 'package_unreachable':
      return 'Package-Server ist nicht erreichbar. Bitte später erneut versuchen.';
    case 'package_timeout':
      return 'Zeitüberschreitung beim Laden des Packages.';
    case 'package_no_models':
      return 'Im Package wurden keine Models gefunden.';
    case 'parser_drift_detected':
      return 'Das Package-Layout weicht vom erwarteten Format ab. Import wurde aus Sicherheitsgründen blockiert.';
    case 'provider_not_supported':
      return 'Diese URL gehört zu keinem unterstützten Provider (MediaSlide / Netwalk).';
    case 'netwalk_provider_not_implemented':
      return 'Netwalk-Import ist noch nicht freigeschaltet (Phase 2).';
    default:
      if (code.startsWith('package_http_error:')) {
        return `MediaSlide antwortet mit HTTP ${code.split(':')[1]}.`;
      }
      return code;
  }
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  title: {
    ...typography.heading,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  description: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  hint: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    fontStyle: 'italic',
  },
  subtitle: {
    ...typography.heading,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.accentGreen,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    alignItems: 'center',
  },
  primaryBtnLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  secondaryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryBtnLabel: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  errorText: {
    ...typography.body,
    fontSize: 12,
    color: colors.buttonSkipRed,
    marginTop: spacing.sm,
  },
  warnText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    fontStyle: 'italic',
  },
  progressBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtleNote: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  previewRowDisabled: {
    opacity: 0.5,
  },
  previewName: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  previewMeta: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
  },
  previewWarn: {
    ...typography.body,
    fontSize: 11,
    color: colors.buttonSkipRed,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: {
    backgroundColor: colors.accentGreen,
    borderColor: colors.accentGreen,
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  checkboxLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
    flex: 1,
  },
});
