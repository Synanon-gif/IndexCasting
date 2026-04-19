/**
 * Agency-to-Agency Roster Share — UI components.
 *
 * Three exports, all designed to be embedded inside `AgencyControllerView`'s
 * "My Models" surface with **minimal-invasive** wiring:
 *
 *   1. `AgencyShareInbox`        — small entry-point card listing incoming
 *      shares for the recipient agency. Click "Open" to launch the detail
 *      modal where the recipient picks territories per model and imports.
 *
 *   2. `AgencyShareDetailModal`  — full-screen modal with the model grid
 *      from a single share link, per-model country picker, conflict report,
 *      and (for unclaimed models) a "Generate claim link" button using the
 *      existing `generateModelClaimToken` co-agency branch (migration
 *      20261023).
 *
 *   3. `AgencyShareSendModal`    — sender-side modal: takes preselected
 *      `selectedModels`, validates a recipient email, calls
 *      `createAgencyShareePackage` + `sendAgencyShareInviteEmail`, and
 *      reports the result. The inviting agency stays the *home* agency for
 *      every model — the recipient becomes a co-agency only for the
 *      territories they pick after import.
 *
 * All user-visible strings come from `uiCopy.agencyShare`; all RPC + Edge
 * Function calls go through `agencySharePackagesSupabase`. No new business
 * logic lives in the UI layer.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { StorageImage } from './StorageImage';
import {
  createAgencyShareePackage,
  getAgencyShareInbox,
  getAgencyShareModels,
  importModelsFromAgencyShare,
  sendAgencyShareInviteEmail,
  buildAgencyShareUrl,
  type AgencyShareInboxEntry,
  type AgencyShareModel,
  type AgencyShareImportResult,
} from '../services/agencySharePackagesSupabase';
import { generateModelClaimToken, buildModelClaimUrl } from '../services/modelsSupabase';

// ─────────────────────────────────────────────────────────────────────────────
// Country list (shared with AgencyControllerView)
// ─────────────────────────────────────────────────────────────────────────────

countries.registerLocale(enLocale as Parameters<typeof countries.registerLocale>[0]);
const ISO_COUNTRY_NAMES: Record<string, string> = countries.getNames('en', {
  select: 'official',
}) as Record<string, string>;

const ALL_COUNTRIES: Array<{ code: string; name: string }> = Object.entries(ISO_COUNTRY_NAMES)
  .map(([code, name]) => ({ code: code.toUpperCase(), name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const countryName = (iso: string): string =>
  ISO_COUNTRY_NAMES[iso.toLowerCase()] ?? ISO_COUNTRY_NAMES[iso.toUpperCase()] ?? iso;

// ─────────────────────────────────────────────────────────────────────────────
// Shared style snippets
// ─────────────────────────────────────────────────────────────────────────────

const overlayStyle = {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.35)',
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  padding: spacing.md,
};

const cardStyle = {
  width: '100%' as const,
  maxWidth: 720,
  maxHeight: '92%' as const,
  backgroundColor: colors.surface,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.md,
};

const primaryButton = {
  backgroundColor: colors.textPrimary,
  borderRadius: 999,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  alignItems: 'center' as const,
};

const secondaryButton = {
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 999,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  alignItems: 'center' as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) AgencyShareInbox — embedded entry-point card
// ─────────────────────────────────────────────────────────────────────────────

export type AgencyShareInboxProps = {
  /** Recipient agency organization id (caller must be a member). */
  organizationId: string | null | undefined;
  /**
   * If set, the detail modal opens automatically for this link id on mount
   * (used by App.tsx → AgencyControllerView routing for `?agency_share=`).
   * Caller must invoke {@link onInitialLinkConsumed} once we open it.
   */
  initialOpenLinkId?: string | null;
  onInitialLinkConsumed?: () => void;
  /** Called after a successful import so the parent can refresh the roster. */
  onImported?: () => void;
};

export const AgencyShareInbox: React.FC<AgencyShareInboxProps> = ({
  organizationId,
  initialOpenLinkId,
  onInitialLinkConsumed,
  onImported,
}) => {
  const [entries, setEntries] = useState<AgencyShareInboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [openLinkId, setOpenLinkId] = useState<string | null>(null);

  const loadInbox = React.useCallback(async () => {
    if (!organizationId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await getAgencyShareInbox(organizationId);
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  // Auto-open from URL routing once on mount/whenever id changes.
  useEffect(() => {
    if (!initialOpenLinkId) return;
    setOpenLinkId(initialOpenLinkId);
    onInitialLinkConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenLinkId]);

  if (!organizationId) return null;

  const renderEmpty = () => (
    <Text
      style={{
        ...typography.body,
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: spacing.xs,
      }}
    >
      {loading ? uiCopy.agencyShare.inboxLoading : uiCopy.agencyShare.inboxEmpty}
    </Text>
  );

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={{ ...typography.heading, fontSize: 14, color: colors.textPrimary }}>
          {uiCopy.agencyShare.inboxTitle}
        </Text>
        <TouchableOpacity onPress={() => void loadInbox()} disabled={loading}>
          <Text
            style={{
              ...typography.label,
              fontSize: 11,
              color: colors.textSecondary,
              opacity: loading ? 0.4 : 1,
            }}
          >
            {loading ? '…' : '↻'}
          </Text>
        </TouchableOpacity>
      </View>

      {entries.length === 0 ? (
        renderEmpty()
      ) : (
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {entries.map((e) => (
            <InboxRow key={e.linkId} entry={e} onOpen={() => setOpenLinkId(e.linkId)} />
          ))}
        </View>
      )}

      <AgencyShareDetailModal
        visible={openLinkId !== null}
        linkId={openLinkId}
        organizationId={organizationId}
        onClose={() => setOpenLinkId(null)}
        onImported={() => {
          onImported?.();
          void loadInbox();
        }}
      />
    </View>
  );
};

const InboxRow: React.FC<{
  entry: AgencyShareInboxEntry;
  onOpen: () => void;
}> = ({ entry, onOpen }) => {
  const countLabel =
    entry.modelCount === 1
      ? uiCopy.agencyShare.inboxModelCountSingular
      : uiCopy.agencyShare.inboxModelCountPlural.replace('{count}', String(entry.modelCount));
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}
          numberOfLines={1}
        >
          {uiCopy.agencyShare.inboxFromAgency.replace('{agency}', entry.senderAgencyName || '—')}
        </Text>
        <Text
          style={{
            ...typography.body,
            fontSize: 11,
            color: colors.textSecondary,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {countLabel}
          {entry.label ? ` · ${entry.label}` : ''}
          {entry.expiresAt
            ? ` · ${uiCopy.agencyShare.inboxExpiresAt.replace(
                '{date}',
                new Date(entry.expiresAt).toLocaleDateString('en-GB'),
              )}`
            : ''}
          {!entry.isActive ? ` · ${uiCopy.agencyShare.inboxInactive}` : ''}
        </Text>
      </View>
      <TouchableOpacity style={primaryButton} onPress={onOpen} disabled={!entry.isActive}>
        <Text style={{ ...typography.label, fontSize: 11, color: colors.surface }}>
          {uiCopy.agencyShare.inboxOpenButton}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) AgencyShareDetailModal — view + import
// ─────────────────────────────────────────────────────────────────────────────

type AgencyShareDetailModalProps = {
  visible: boolean;
  linkId: string | null;
  organizationId: string;
  onClose: () => void;
  onImported?: () => void;
};

const AgencyShareDetailModal: React.FC<AgencyShareDetailModalProps> = ({
  visible,
  linkId,
  organizationId,
  onClose,
  onImported,
}) => {
  const [models, setModels] = useState<AgencyShareModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** model_id → selected ISO codes */
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<AgencyShareImportResult | null>(null);
  const [pickerForModel, setPickerForModel] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [claimTokenByModel, setClaimTokenByModel] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible || !linkId) {
      setModels(null);
      setSelection({});
      setResult(null);
      setLoadError(null);
      setClaimTokenByModel({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getAgencyShareModels(linkId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setLoadError(res.error);
        setModels([]);
        return;
      }
      setModels(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, linkId]);

  const filteredCountries = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return ALL_COUNTRIES;
    return ALL_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [pickerSearch]);

  const totalSelected = useMemo(
    () => Object.values(selection).reduce((acc, arr) => acc + arr.length, 0),
    [selection],
  );

  const toggleCountry = (modelId: string, code: string) => {
    setSelection((prev) => {
      const cur = prev[modelId] ?? [];
      const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
      return { ...prev, [modelId]: next };
    });
  };

  const handleImport = async () => {
    if (!linkId || totalSelected === 0) return;
    setImporting(true);
    setResult(null);
    const imports = Object.entries(selection)
      .filter(([, arr]) => arr.length > 0)
      .map(([modelId, countryCodes]) => ({ modelId, countryCodes }));
    const res = await importModelsFromAgencyShare({ organizationId, linkId, imports });
    setImporting(false);
    if (!res.ok) {
      Alert.alert(uiCopy.agencyShare.importErrorTitle, uiCopy.agencyShare.importErrorBody);
      return;
    }
    setResult(res.data);
    if (res.data.imported.length > 0) {
      onImported?.();
    }
  };

  const handleGenerateClaim = async (model: AgencyShareModel) => {
    const res = await generateModelClaimToken(model.id, organizationId);
    if (!res.ok) {
      Alert.alert(uiCopy.common.error, uiCopy.agencyShare.claimTokenError);
      return;
    }
    const url = buildModelClaimUrl(res.data.token);
    setClaimTokenByModel((prev) => ({ ...prev, [model.id]: url }));
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* best-effort */
      }
    }
    Alert.alert(uiCopy.agencyShare.importSuccessTitle, uiCopy.agencyShare.claimTokenSuccess);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={overlayStyle}>
        <View style={cardStyle}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.sm,
            }}
          >
            <Text
              style={{ ...typography.heading, fontSize: 15, color: colors.textPrimary, flex: 1 }}
            >
              {uiCopy.agencyShare.detailTitle}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
                {uiCopy.common.close ?? 'Close'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text
            style={{
              ...typography.body,
              fontSize: 12,
              color: colors.textSecondary,
              marginBottom: spacing.sm,
            }}
          >
            {uiCopy.agencyShare.detailSubtitle}
          </Text>

          {loading ? (
            <View style={{ padding: spacing.lg, alignItems: 'center' }}>
              <ActivityIndicator />
              <Text
                style={{
                  ...typography.body,
                  fontSize: 12,
                  color: colors.textSecondary,
                  marginTop: spacing.xs,
                }}
              >
                {uiCopy.agencyShare.detailLoading}
              </Text>
            </View>
          ) : loadError ? (
            <Text style={{ ...typography.body, fontSize: 12, color: colors.error ?? '#cc3333' }}>
              {uiCopy.agencyShare.detailError} ({loadError})
            </Text>
          ) : !models || models.length === 0 ? (
            <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary }}>
              {uiCopy.agencyShare.detailEmpty}
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 480 }}>
              {models.map((m) => (
                <ModelDetailCard
                  key={m.id}
                  model={m}
                  selectedCountries={selection[m.id] ?? []}
                  onOpenPicker={() => {
                    setPickerForModel(m.id);
                    setPickerSearch('');
                  }}
                  onGenerateClaim={() => void handleGenerateClaim(m)}
                  claimUrl={claimTokenByModel[m.id]}
                />
              ))}
            </ScrollView>
          )}

          {result && (
            <ImportResultBanner
              result={result}
              modelsById={Object.fromEntries((models ?? []).map((m) => [m.id, m.name]))}
            />
          )}

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: spacing.sm,
              marginTop: spacing.md,
            }}
          >
            <TouchableOpacity style={secondaryButton} onPress={onClose}>
              <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>
                {uiCopy.common.close ?? 'Close'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[primaryButton, (totalSelected === 0 || importing) && { opacity: 0.4 }]}
              disabled={totalSelected === 0 || importing}
              onPress={() => void handleImport()}
            >
              <Text style={{ ...typography.label, fontSize: 12, color: colors.surface }}>
                {importing
                  ? uiCopy.agencyShare.importingButton
                  : `${uiCopy.agencyShare.importButton} (${totalSelected})`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Country picker modal — nested */}
        <CountryPickerModal
          visible={pickerForModel !== null}
          countries={filteredCountries}
          selected={pickerForModel ? (selection[pickerForModel] ?? []) : []}
          search={pickerSearch}
          onSearchChange={setPickerSearch}
          onToggle={(code) => {
            if (pickerForModel) toggleCountry(pickerForModel, code);
          }}
          onClose={() => setPickerForModel(null)}
        />
      </View>
    </Modal>
  );
};

const ModelDetailCard: React.FC<{
  model: AgencyShareModel;
  selectedCountries: string[];
  onOpenPicker: () => void;
  onGenerateClaim: () => void;
  claimUrl?: string;
}> = ({ model, selectedCountries, onOpenPicker, onGenerateClaim, claimUrl }) => {
  const cover = model.portfolioImages[0] ?? null;
  const chest = model.bust;
  const fmt = (v: number | null) => (typeof v === 'number' ? `${v}` : '—');
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View
        style={{
          width: 84,
          height: 112,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: colors.border,
        }}
      >
        {cover ? (
          <StorageImage uri={cover} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ ...typography.label, fontSize: 13, color: colors.textPrimary }}
          numberOfLines={1}
        >
          {model.name || '—'}
        </Text>
        <Text
          style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginTop: 2 }}
        >
          {uiCopy.agencyShare.heightLabel}: {fmt(model.height)} · {uiCopy.agencyShare.chestLabel}:{' '}
          {fmt(chest)} · {uiCopy.agencyShare.waistLabel}: {fmt(model.waist)} ·{' '}
          {uiCopy.agencyShare.hipsLabel}: {fmt(model.hips)}
        </Text>
        {model.effectiveCity || model.city ? (
          <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
            {uiCopy.agencyShare.cityLabel}: {model.effectiveCity ?? model.city}
          </Text>
        ) : null}
        <Text
          style={{
            ...typography.body,
            fontSize: 10,
            color: model.hasAccount ? (colors.success ?? '#2e7d32') : colors.textSecondary,
            marginTop: 2,
          }}
        >
          {model.hasAccount
            ? uiCopy.agencyShare.modelHasAccount
            : uiCopy.agencyShare.modelNoAccount}
        </Text>

        <View
          style={{
            marginTop: spacing.xs,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 4,
            alignItems: 'center',
          }}
        >
          {selectedCountries.length === 0 ? (
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
              {uiCopy.agencyShare.countryPickerPlaceholder}
            </Text>
          ) : (
            selectedCountries.map((c) => (
              <View
                key={c}
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ ...typography.label, fontSize: 10, color: colors.textPrimary }}>
                  {c}
                </Text>
              </View>
            ))
          )}
          <TouchableOpacity
            onPress={onOpenPicker}
            style={{
              borderWidth: 1,
              borderColor: colors.textPrimary,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 2,
            }}
          >
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textPrimary }}>
              {uiCopy.agencyShare.countryPickerLabel}
            </Text>
          </TouchableOpacity>
        </View>

        {!model.hasAccount && (
          <View style={{ marginTop: spacing.xs }}>
            <TouchableOpacity
              onPress={onGenerateClaim}
              style={[secondaryButton, { paddingVertical: 4, paddingHorizontal: 10 }]}
            >
              <Text style={{ ...typography.label, fontSize: 10, color: colors.textPrimary }}>
                {uiCopy.agencyShare.generateClaimTokenButton}
              </Text>
            </TouchableOpacity>
            {claimUrl ? (
              <Text
                style={{
                  ...typography.body,
                  fontSize: 9,
                  color: colors.textSecondary,
                  marginTop: 2,
                }}
                numberOfLines={2}
              >
                {claimUrl}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
};

const CountryPickerModal: React.FC<{
  visible: boolean;
  countries: Array<{ code: string; name: string }>;
  selected: string[];
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (code: string) => void;
  onClose: () => void;
}> = ({ visible, countries: list, selected, search, onSearchChange, onToggle, onClose }) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={overlayStyle}>
        <View style={[cardStyle, { maxWidth: 420 }]}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginBottom: spacing.xs,
            }}
          >
            <Text style={{ ...typography.heading, fontSize: 13, color: colors.textPrimary }}>
              {uiCopy.agencyShare.countryPickerLabel}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
                {uiCopy.common.close ?? 'Close'}
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            placeholder={uiCopy.agencyShare.countryPickerPlaceholder}
            placeholderTextColor={colors.textSecondary}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 999,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              ...typography.body,
              fontSize: 12,
              marginBottom: spacing.xs,
            }}
          />
          <ScrollView style={{ maxHeight: 360 }}>
            {list.map((c) => {
              const isSelected = selected.includes(c.code);
              return (
                <TouchableOpacity
                  key={c.code}
                  onPress={() => onToggle(c.code)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: isSelected ? colors.background : 'transparent',
                    borderRadius: 6,
                  }}
                >
                  <Text style={{ ...typography.body, fontSize: 12, color: colors.textPrimary }}>
                    {c.name}
                  </Text>
                  <Text
                    style={{
                      ...typography.label,
                      fontSize: 11,
                      color: isSelected ? colors.textPrimary : colors.textSecondary,
                    }}
                  >
                    {isSelected ? '✓' : c.code}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const ImportResultBanner: React.FC<{
  result: AgencyShareImportResult;
  modelsById: Record<string, string>;
}> = ({ result, modelsById }) => {
  const importedCount = result.imported.length;
  const skippedCount = result.skipped.length;
  const body =
    importedCount > 0 && skippedCount === 0
      ? uiCopy.agencyShare.importSuccessBody
          .replace('{imported}', String(importedCount))
          .replace('{ies}', importedCount === 1 ? 'y' : 'ies')
      : importedCount > 0 && skippedCount > 0
        ? uiCopy.agencyShare.importPartialBody
            .replace('{imported}', String(importedCount))
            .replace('{skipped}', String(skippedCount))
        : uiCopy.agencyShare.importNoneBody;
  return (
    <View
      style={{
        marginTop: spacing.sm,
        padding: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>
        {uiCopy.agencyShare.importSuccessTitle}
      </Text>
      <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
        {body}
      </Text>
      {result.skipped.length > 0 && (
        <View style={{ marginTop: spacing.xs, gap: 2 }}>
          <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
            {uiCopy.agencyShare.skippedConflictTitle}
          </Text>
          {result.skipped.map((s, idx) => (
            <Text
              key={`${s.modelId}-${s.countryCode}-${idx}`}
              style={{ ...typography.body, fontSize: 10, color: colors.textSecondary }}
            >
              {uiCopy.agencyShare.skippedConflictRow
                .replace('{model}', modelsById[s.modelId] ?? s.modelId.slice(0, 8))
                .replace('{country}', countryName(s.countryCode))}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 3) AgencyShareSendModal — sender flow
// ─────────────────────────────────────────────────────────────────────────────

export type AgencyShareSendModalProps = {
  visible: boolean;
  onClose: () => void;
  organizationId: string;
  senderAgencyName?: string | null;
  inviterName?: string | null;
  /** Models already selected by the user (e.g. via bulk-select toolbar). */
  selectedModels: Array<{ id: string; name: string }>;
};

export const AgencyShareSendModal: React.FC<AgencyShareSendModalProps> = ({
  visible,
  onClose,
  organizationId,
  senderAgencyName,
  inviterName,
  selectedModels,
}) => {
  const [recipient, setRecipient] = useState('');
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('14');
  const [sending, setSending] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [emailFailedNotice, setEmailFailedNotice] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRecipient('');
      setLabel('');
      setExpiresInDays('14');
      setSending(false);
      setShareUrl(null);
      setEmailFailedNotice(false);
    }
  }, [visible]);

  const handleSend = async () => {
    const cleaned = recipient.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      Alert.alert(uiCopy.agencyShare.sendErrorTitle, uiCopy.agencyShare.invalidEmailError);
      return;
    }
    if (selectedModels.length === 0) {
      Alert.alert(uiCopy.agencyShare.sendErrorTitle, uiCopy.agencyShare.noModelsError);
      return;
    }
    setSending(true);
    setEmailFailedNotice(false);

    const days = Math.max(1, Math.min(180, Number.parseInt(expiresInDays, 10) || 14));
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

    const createRes = await createAgencyShareePackage({
      organizationId,
      recipientEmail: cleaned,
      modelIds: selectedModels.map((m) => m.id),
      label: label.trim() || null,
      expiresAt,
    });

    if (!createRes.ok) {
      setSending(false);
      const message =
        createRes.error.includes('recipient_agency_not_found') ||
        createRes.error === 'recipient_agency_not_found'
          ? uiCopy.agencyShare.recipientNotFoundError
          : createRes.error.includes('cannot_share_with_self')
            ? uiCopy.agencyShare.selfShareError
            : createRes.error.includes('invalid_models_for_sender')
              ? uiCopy.agencyShare.invalidModelsError
              : `${uiCopy.agencyShare.sendErrorTitle}: ${createRes.error}`;
      Alert.alert(uiCopy.agencyShare.sendErrorTitle, message);
      return;
    }

    const url = buildAgencyShareUrl(createRes.data.linkId);
    setShareUrl(url);

    const emailRes = await sendAgencyShareInviteEmail({
      linkId: createRes.data.linkId,
      to: cleaned,
      senderOrganizationId: organizationId,
      senderAgencyName: senderAgencyName ?? undefined,
      recipientAgencyName: createRes.data.targetAgencyName ?? undefined,
      inviterName: inviterName ?? undefined,
      modelCount: selectedModels.length,
      label: label.trim() || null,
    });
    setSending(false);

    if (!emailRes.ok) {
      setEmailFailedNotice(true);
    } else {
      Alert.alert(uiCopy.agencyShare.sendSuccessTitle, uiCopy.agencyShare.sendSuccessBody);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        Alert.alert(uiCopy.agencyShare.linkCopied);
      } catch {
        /* best-effort */
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={overlayStyle}>
        <View style={[cardStyle, { maxWidth: 480 }]}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginBottom: spacing.xs,
            }}
          >
            <Text style={{ ...typography.heading, fontSize: 15, color: colors.textPrimary }}>
              {uiCopy.agencyShare.sectionTitle}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
                {uiCopy.common.close ?? 'Close'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text
            style={{
              ...typography.body,
              fontSize: 12,
              color: colors.textSecondary,
              marginBottom: spacing.sm,
            }}
          >
            {uiCopy.agencyShare.sectionSubtitle}
          </Text>
          <Text
            style={{
              ...typography.label,
              fontSize: 11,
              color: colors.textPrimary,
              marginBottom: 4,
            }}
          >
            {uiCopy.bulkActions.selectedCount.replace('{count}', String(selectedModels.length))}
          </Text>

          <Text style={{ ...typography.label, fontSize: 11, marginTop: spacing.sm }}>
            {uiCopy.agencyShare.recipientEmailLabel}
          </Text>
          <TextInput
            value={recipient}
            onChangeText={setRecipient}
            placeholder={uiCopy.agencyShare.recipientEmailPlaceholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
              ...typography.body,
              fontSize: 12,
              marginTop: 4,
            }}
          />

          <Text style={{ ...typography.label, fontSize: 11, marginTop: spacing.sm }}>
            {uiCopy.agencyShare.labelPlaceholder}
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={uiCopy.agencyShare.labelPlaceholder}
            placeholderTextColor={colors.textSecondary}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
              ...typography.body,
              fontSize: 12,
              marginTop: 4,
            }}
          />

          <Text style={{ ...typography.label, fontSize: 11, marginTop: spacing.sm }}>
            {uiCopy.agencyShare.expiresInDaysLabel}
          </Text>
          <TextInput
            value={expiresInDays}
            onChangeText={setExpiresInDays}
            keyboardType="numeric"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
              ...typography.body,
              fontSize: 12,
              marginTop: 4,
              width: 100,
            }}
          />

          {emailFailedNotice && (
            <Text
              style={{
                ...typography.body,
                fontSize: 11,
                color: colors.error ?? '#cc3333',
                marginTop: spacing.sm,
              }}
            >
              {uiCopy.agencyShare.emailFailedNotice}
            </Text>
          )}

          {shareUrl && (
            <View style={{ marginTop: spacing.sm }}>
              <Text
                style={{ ...typography.body, fontSize: 10, color: colors.textSecondary }}
                numberOfLines={2}
              >
                {shareUrl}
              </Text>
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  onPress={() => void copyLink()}
                  style={[secondaryButton, { marginTop: 4, alignSelf: 'flex-start' }]}
                >
                  <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                    {uiCopy.agencyShare.copyLinkLabel}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: spacing.sm,
              marginTop: spacing.md,
            }}
          >
            <TouchableOpacity style={secondaryButton} onPress={onClose}>
              <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>
                {uiCopy.common.close ?? 'Close'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[primaryButton, (sending || selectedModels.length === 0) && { opacity: 0.4 }]}
              disabled={sending || selectedModels.length === 0}
              onPress={() => void handleSend()}
            >
              <Text style={{ ...typography.label, fontSize: 12, color: colors.surface }}>
                {sending ? uiCopy.agencyShare.sendingButton : uiCopy.agencyShare.sendButton}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
