/**
 * PackageImportPane — Agency-facing UI for the MediaSlide / Netwalk Package
 * Import (Phase 2). All copy is English by design — the rest of the agency
 * controller surface is English too, and the package import is a deeply
 * agency-internal flow so we never localise it ad-hoc.
 *
 * State machine:
 *   idle → analyzing → previewing → committing → done
 *
 * Design principles:
 *  - Honest status display: progress, model count, image count, warnings.
 *  - Phase 2: images are downloaded under control, validated, and persisted to
 *    our storage (`model_photos` + mirror rebuild) during commit. The model
 *    is independent of the external provider once the commit is done.
 *  - Territory claim: every imported model MUST be claimed for at least one
 *    territory (ISO-2 country code). Without a `model_agency_territories`
 *    row the model is created but invisible in "My Models" because the roster
 *    read is fail-closed on MAT (see `getModelsForAgencyFromSupabase`).
 *  - Cancel button (AbortController) during analyze + commit. Cancel takes
 *    effect between images / between models — no mid-image rollback.
 *  - Pure component: NO direct DB access; all orchestration via
 *    `commitPreview`, which calls `importModelAndMerge` and then
 *    `persistImagesForPackageImport` (RLS / org scoping / GDPR audit kept).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getProviderForUrl } from '../services/providerRegistry';
import { createSupabasePackageImageFetchImpl } from '../services/packageImageProxyClient';
import {
  PACKAGE_IMPORT_LIMITS,
  isParserDriftError,
  type AnalyzeProgress,
  type CommitOutcome,
  type CommitProgress,
  type CommitSummary,
  type CommitTerritoryClaim,
  type DriftResult,
  type PackageProvider,
  type PreviewModel,
} from '../services/packageImportTypes';
import { commitPreview, toPreviewModels } from '../services/packageImporter';
import { deriveDefaultTerritoryInput, parseTerritoryInput } from './PackageImportPane.utils';

type Props = {
  agencyId: string;
  /** Called when at least one model was created or updated. */
  onModelsChanged?: () => void;
  /**
   * Optional: default territory (free-form country string from `agencies.country`).
   * Used to pre-fill the territory input. We normalise to ISO-2 by uppercase +
   * truncating to 2 chars when the value already looks like an ISO-2 code; for
   * a long country name we leave the input empty and let the user type the
   * code explicitly (no incorrect auto-mapping).
   */
  defaultTerritory?: string | null;
};

type Phase =
  | 'idle'
  | 'analyzing'
  | 'previewing'
  | 'committing'
  | 'done'
  | 'drift_blocked'
  | 'drift_override_confirm';

export const PackageImportPane: React.FC<Props> = ({
  agencyId,
  onModelsChanged,
  defaultTerritory,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(null);
  const [previews, setPreviews] = useState<PreviewModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forceMeasurements, setForceMeasurements] = useState(false);
  const [territoriesInput, setTerritoriesInput] = useState<string>(() =>
    deriveDefaultTerritoryInput(defaultTerritory),
  );

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
  const parsedTerritories = useMemo(
    () => parseTerritoryInput(territoriesInput),
    [territoriesInput],
  );

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
    // Keep territoriesInput between runs — likely the same agency, same default.
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
            `Package contains ${payloads.length} models (limit ${PACKAGE_IMPORT_LIMITS.MAX_MODELS_PER_RUN}).`,
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
      setError('Please enter a package link (MediaSlide or Netwalk).');
      return;
    }
    if (!agencyId) {
      setError('No agency context found.');
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
    // Drift override: re-analyze with allowDriftBypass=true. The drift banner stays
    // visible (we don't clear `drift`). The importer still applies all required-field
    // checks (`missing_external_id`, `missing_name`, `missing_height`, `no_images`,
    // `forceSkipReason`) so the DB is safe even on the override path.
    setOverrideText('');
    await runAnalyze(provider, true);
  }, [overrideText, url, runAnalyze]);

  const handleCommit = useCallback(async () => {
    if (phase !== 'previewing') return;
    const toCommit = previews.filter((p) => p.status === 'ready' && selected.has(p.externalId));
    if (toCommit.length === 0) {
      setError('Please select at least one model.');
      return;
    }
    if (parsedTerritories.length === 0) {
      // Block commit when no territory is provided. Without a territory the
      // model would be created but invisible in "My Models" (roster query is
      // fail-closed on `model_agency_territories`).
      setError('Please enter at least one territory (ISO-2 country code, e.g. "AT" or "AT, DE").');
      return;
    }
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('committing');
    setCommitProgress({ total: toCommit.length, done: 0 });

    try {
      const territoryClaims: CommitTerritoryClaim[] = parsedTerritories.map((cc) => ({
        country_code: cc,
        agency_id: agencyId,
      }));

      const result = await commitPreview({
        selected: toCommit,
        agencyId,
        options: {
          forceUpdateMeasurements: forceMeasurements,
          // Phase 2: physical image persistence active. UI default → true.
          // Tests can bypass this via the direct service call.
          persistImages: true,
          territories: territoryClaims,
        },
        signal: ctrl.signal,
        onProgress: (p) => setCommitProgress(p),
        // On Web, route image downloads through `package-image-proxy` because
        // the MediaSlide GCS bucket sends no CORS header. On Native we keep
        // the direct fetch (no CORS, fewer hops).
        ...(Platform.OS === 'web' ? { imageFetchImpl: createSupabasePackageImageFetchImpl() } : {}),
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
  }, [phase, previews, selected, agencyId, forceMeasurements, onModelsChanged, parsedTerritories]);

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
      <Text style={styles.title}>Import MediaSlide Package</Text>
      <Text style={styles.description}>
        Paste a MediaSlide package link. We read models, measurements and image URLs and show them
        for your confirmation before anything is created.
      </Text>
      <Text style={styles.hint}>
        Note (Phase 2 active): images are copied into our storage during import (HEIC→JPEG, EXIF
        stripped, MIME / magic bytes verified). The imported model stays independent of the package
        — even if the link is later deactivated. The commit takes longer because of this; partial
        image errors are reported per model. Cap per model: max.{' '}
        {PACKAGE_IMPORT_LIMITS.MAX_PORTFOLIO_IMAGES_PER_MODEL} portfolio +{' '}
        {PACKAGE_IMPORT_LIMITS.MAX_POLAROIDS_PER_MODEL} polaroids.
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
            <Text style={styles.primaryBtnLabel}>Analyze package</Text>
          </TouchableOpacity>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </>
      )}

      {phase === 'analyzing' && (
        <View style={styles.progressBox}>
          <ActivityIndicator size="small" color={colors.accentGreen} />
          <Text style={styles.progressText}>{renderAnalyzeLabel(analyzeProgress)}</Text>
          <Text style={styles.subtleNote}>
            With many models this can take several minutes (1 HTTP per album).
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel}>
            <Text style={styles.secondaryBtnLabel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'drift_blocked' && drift && (
        <View style={{ marginTop: spacing.md }}>
          <DriftBanner drift={drift} severity="hard_block" />
          <Text style={styles.warnText}>
            Import was blocked for safety. It looks like{' '}
            {drift.providerId === 'mediaslide' ? 'MediaSlide' : drift.providerId} may have changed
            its layout. You can override manually — the importer still protects the DB through
            required-field checks (height, images, externalId).
          </Text>
          <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset}>
              <Text style={styles.secondaryBtnLabel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.buttonSkipRed }]}
              onPress={handleOverrideRequest}
            >
              <Text style={[styles.secondaryBtnLabel, { color: colors.buttonSkipRed }]}>
                Request override…
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === 'drift_override_confirm' && drift && (
        <View style={{ marginTop: spacing.md }}>
          <DriftBanner drift={drift} severity="hard_block" />
          <Text style={styles.warnText}>
            You are overriding a hard drift warning. Type the word{' '}
            <Text style={{ fontWeight: '700' }}>OVERRIDE</Text> to analyse anyway. The drift remains
            logged for this run.
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
              <Text style={styles.secondaryBtnLabel}>Back</Text>
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
              <Text style={styles.primaryBtnLabel}>Confirm override</Text>
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
            Detected: {previews.length} model(s) — ready: {totalReady}
            {totalSkipped > 0 ? `, skipped: ${totalSkipped}` : ''}
          </Text>
          {previews.length > PACKAGE_IMPORT_LIMITS.SOFT_MODELS_PER_RUN && (
            <Text style={styles.warnText}>
              Large import ({previews.length} models). The run is sequential and can take several
              minutes.
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

          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.fieldLabel}>
              Territory (ISO-2 country codes, comma-separated)
              {parsedTerritories.length > 0 ? ` — ${parsedTerritories.join(', ')}` : ''}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. AT, DE"
              placeholderTextColor={colors.textSecondary}
              value={territoriesInput}
              onChangeText={setTerritoriesInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={styles.subtleNote}>
              Required. Each imported model is claimed for these territories so it appears in "My
              Models". You can edit territories per model later.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.row, { marginTop: spacing.md }]}
            onPress={() => setForceMeasurements((v) => !v)}
          >
            <View style={[styles.checkbox, forceMeasurements && styles.checkboxOn]}>
              {forceMeasurements && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              Overwrite existing measurements on known models (otherwise only fill gaps)
            </Text>
          </TouchableOpacity>

          <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { flex: 1 },
                (selected.size === 0 || parsedTerritories.length === 0) && styles.btnDisabled,
              ]}
              onPress={handleCommit}
              disabled={selected.size === 0 || parsedTerritories.length === 0}
            >
              <Text style={styles.primaryBtnLabel}>Import {selected.size} model(s)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset}>
              <Text style={styles.secondaryBtnLabel}>Discard</Text>
            </TouchableOpacity>
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      )}

      {phase === 'committing' && (
        <View style={styles.progressBox}>
          <ActivityIndicator size="small" color={colors.accentGreen} />
          <Text style={styles.progressText}>
            Importing {commitProgress?.done ?? 0}/{commitProgress?.total ?? 0}
            {commitProgress?.currentLabel ? ` – ${commitProgress.currentLabel}` : ''}
          </Text>
          <Text style={styles.subtleNote}>
            Images are downloaded, validated and copied into storage. This can take several seconds
            per model.
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel}>
            <Text style={styles.secondaryBtnLabel}>Stop after current model</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'done' && summary && (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.subtitle}>Import finished</Text>
          <SummaryLine label="Created" value={summary.createdCount} ok />
          <SummaryLine label="Updated" value={summary.mergedCount} ok />
          {summary.warningCount > 0 && (
            <SummaryLine label="Warnings" value={summary.warningCount} />
          )}
          {summary.skippedCount > 0 && <SummaryLine label="Skipped" value={summary.skippedCount} />}
          {summary.errorCount > 0 && <SummaryLine label="Errors" value={summary.errorCount} bad />}
          {(() => {
            // Image-persistence summary (Phase 2): makes the actual mirror
            // success visible at a glance.
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
                label="Images persisted"
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
              <Text style={styles.primaryBtnLabel}>New import</Text>
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
        {isHard ? 'Drift hard-block' : 'Drift warning'} · {drift.providerId} · {drift.parserVersion}
      </Text>
      <Text style={styles.previewMeta}>Source: {drift.maskedUrl}</Text>
      <Text style={styles.previewMeta}>
        Anchor coverage: {(drift.anchorCoverage * 100).toFixed(0)}% · Extraction:{' '}
        {(drift.extractionRatio * 100).toFixed(0)}% · Books OK:{' '}
        {(drift.bookOkRatio * 100).toFixed(0)}%
      </Text>
      <Text style={styles.previewMeta}>
        Cards detected: {drift.cardsDetected} · extracted: {drift.cardsExtracted}
      </Text>
      {drift.missingAnchors.length > 0 && (
        <Text style={styles.previewWarn}>Missing anchors: {drift.missingAnchors.join(', ')}</Text>
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
          {preview.name || '(no name)'}{' '}
          <Text style={styles.previewMeta}>· #{preview.externalId}</Text>
        </Text>
        {isReady ? (
          <Text style={styles.previewMeta}>
            {preview.measurements.height ? `${preview.measurements.height} cm · ` : ''}
            {preview.portfolio_image_urls.length} portfolio
            {preview.discardedPortfolio > 0 ? ` (+${preview.discardedPortfolio} discarded)` : ''}
            {' · '}
            {preview.polaroid_image_urls.length} polaroids
            {preview.discardedPolaroids > 0 ? ` (+${preview.discardedPolaroids} discarded)` : ''}
          </Text>
        ) : (
          <Text style={styles.previewWarn}>Skipped: {preview.skipReason ?? 'unknown'}</Text>
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
  // Surface image-persistence stats so the agency immediately sees how many
  // images per model actually made it into our storage and which failure
  // codes were hit. Failure codes are truncated to keep the outcome list
  // readable.
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
          Images: {outcome.imagesPersisted ?? 0}/{outcome.imagesAttempted ?? 0}
          {failureSnippets.length > 0
            ? ` · errors: ${failureSnippets.join(', ')}${moreFailures}`
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
  if (!p) return 'Starting analysis…';
  if (p.phase === 'fetch_list') return 'Loading package list…';
  if (p.phase === 'parse') return `Parsing ${p.modelsTotal} model(s)…`;
  return `Loading books ${p.modelsDone}/${p.modelsTotal}${p.currentLabel ? ` – ${p.currentLabel}` : ''}`;
}

function humaniseError(code: string): string {
  switch (code) {
    case 'package_url_invalid':
      return 'The link does not match the MediaSlide package format.';
    case 'package_unreachable':
      return 'Package server is unreachable. Please try again later.';
    case 'package_timeout':
      return 'Timed out while loading the package.';
    case 'package_no_models':
      return 'No models found in the package.';
    case 'parser_drift_detected':
      return 'The package layout differs from the expected format. Import was blocked for safety.';
    case 'provider_not_supported':
      return 'This URL does not belong to a supported provider (MediaSlide / Netwalk).';
    case 'netwalk_provider_not_implemented':
      return 'Netwalk import is not enabled yet (Phase 2).';
    case 'package_proxy_forbidden':
      return 'You do not have permission to import packages (agency membership required).';
    default:
      if (code.startsWith('package_http_error:')) {
        return `MediaSlide responded with HTTP ${code.split(':')[1]}.`;
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
  fieldLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    fontWeight: '600',
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
