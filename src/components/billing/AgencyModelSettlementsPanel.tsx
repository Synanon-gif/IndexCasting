/**
 * AgencyModelSettlementsPanel — Agency-internal model payout ledger.
 *
 * Lives under the Billing Hub `Settlements` sub-tab. Surfaces the
 * `agency_model_settlements` table:
 *   - Owner can create / edit drafts, mark as recorded / paid, delete drafts.
 *   - Booker (org member) sees read-only list (RLS still enforces).
 *   - Models NEVER see this UI (billing firewall — never mount in model workspace).
 *
 * Notes:
 *   - Settlements are NOT formal invoices; they live in their own table with
 *     their own RLS policies (see migration 20261111).
 *   - All visible strings come from `uiCopy.settlements` (English-only).
 *   - Service contract: Option A (boolean / null / [] on failure, never throws).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { useAuth } from '../../context/AuthContext';
import { isOrganizationOwner, isOrganizationOperationalMember } from '../../services/orgRoleTypes';
import {
  createAgencyModelSettlement,
  deleteAgencyModelSettlement,
  getAgencyModelSettlementWithItems,
  listAgencyModelSettlements,
  markAgencyModelSettlementPaid,
  updateAgencyModelSettlement,
} from '../../services/agencyModelSettlementsSupabase';
import { getModelsForAgencyFromSupabase, type SupabaseModel } from '../../services/modelsSupabase';
import type {
  AgencyModelSettlementRow,
  AgencyModelSettlementStatus,
  AgencyModelSettlementWithItems,
} from '../../types/billingTypes';
import { showAppAlert, showConfirmAlert } from '../../utils/crossPlatformAlert';

type Props = {
  organizationId: string | null;
};

type Mode = 'list' | 'create' | 'edit';

function formatCents(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

function statusLabel(status: AgencyModelSettlementStatus): string {
  const s = uiCopy.settlements;
  switch (status) {
    case 'draft':
      return s.statusDraft;
    case 'recorded':
      return s.statusRecorded;
    case 'paid':
      return s.statusPaid;
    case 'void':
      return s.statusVoid;
    default:
      return status;
  }
}

/** Parse a free-text amount input like "1.234,50" / "1234.50" into cents. */
function parseAmountToCents(text: string): number {
  if (!text) return 0;
  const normalized = text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const AgencyModelSettlementsPanel: React.FC<Props> = ({ organizationId }) => {
  const { profile } = useAuth();
  const s = uiCopy.settlements;
  // Phase A (2026-11-20): Settlements operational — Owner UND Booker/Employee dürfen
  // create/edit/mark recorded/mark paid. Delete bleibt Owner-only (ams_owner_delete_draft).
  const isOwner = isOrganizationOwner(profile?.org_member_role);
  const isMember = isOrganizationOperationalMember(profile?.org_member_role);

  const [mode, setMode] = useState<Mode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgencyModelSettlementRow[]>([]);
  const [models, setModels] = useState<SupabaseModel[]>([]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const data = await listAgencyModelSettlements(organizationId);
      setRows(data);
    } catch (e) {
      console.error('[AgencyModelSettlementsPanel] load', e);
      showAppAlert(uiCopy.common.error, s.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [organizationId, s.loadFailed]);

  const loadModels = useCallback(async () => {
    const agencyId = profile?.agency_id ?? null;
    if (!agencyId) return;
    try {
      const list = await getModelsForAgencyFromSupabase(agencyId);
      setModels(list);
    } catch (e) {
      console.error('[AgencyModelSettlementsPanel] loadModels', e);
    }
  }, [profile?.agency_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const modelNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of models) map[m.id] = m.name ?? '—';
    return map;
  }, [models]);

  const onDelete = useCallback(
    (row: AgencyModelSettlementRow) => {
      if (!isOwner || row.status !== 'draft' || !organizationId) return;
      const run = async () => {
        const ok = await deleteAgencyModelSettlement(row.id, organizationId);
        if (ok) {
          showAppAlert(uiCopy.common.success, s.deleteSuccess);
          await load();
        } else {
          showAppAlert(uiCopy.common.error, s.deleteFailed);
        }
      };
      showConfirmAlert(
        s.deleteConfirmTitle,
        s.deleteConfirmMessage,
        () => void run(),
        uiCopy.common.delete,
      );
    },
    [isOwner, organizationId, load, s],
  );

  const onMarkRecorded = useCallback(
    (row: AgencyModelSettlementRow) => {
      if (!isMember || row.status !== 'draft' || !organizationId) return;
      const run = async () => {
        const ok = await updateAgencyModelSettlement(row.id, organizationId, {
          status: 'recorded',
        });
        if (ok) await load();
        else showAppAlert(uiCopy.common.error, s.markRecordedFailed);
      };
      showConfirmAlert(
        s.markRecordedConfirmTitle,
        s.markRecordedConfirmMessage,
        () => void run(),
        s.markRecorded,
      );
    },
    [isMember, organizationId, load, s],
  );

  const onMarkPaid = useCallback(
    (row: AgencyModelSettlementRow) => {
      if (!isMember || row.status === 'paid' || row.status === 'void' || !organizationId) return;
      const run = async () => {
        const ok = await markAgencyModelSettlementPaid(row.id, organizationId);
        if (ok) {
          showAppAlert(uiCopy.common.success, s.markPaidSuccess);
          await load();
        } else {
          showAppAlert(uiCopy.common.error, s.markPaidFailed);
        }
      };
      showConfirmAlert(
        s.markPaidConfirmTitle,
        s.markPaidConfirmMessage,
        () => void run(),
        s.markPaid,
      );
    },
    [isMember, organizationId, load, s],
  );

  if (!organizationId) return null;

  if (mode === 'create' || (mode === 'edit' && editingId)) {
    return (
      <SettlementEditor
        organizationId={organizationId}
        settlementId={mode === 'edit' ? editingId : null}
        models={models}
        modelNameById={modelNameById}
        canEdit={isMember}
        onClose={() => {
          setMode('list');
          setEditingId(null);
          void load();
        }}
      />
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>{s.cardTitle}</Text>
        {isMember && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setMode('create')}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>{s.create}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.intro}>{s.intro}</Text>
      {!isMember && <Text style={styles.hint}>{s.ownerOnlyHint}</Text>}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.hint}>{s.loading}</Text>
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>{s.empty}</Text>
      ) : (
        <View style={styles.list}>
          {rows.map((r) => (
            <View key={r.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTopLine}>
                  <Text style={styles.invoiceNo} numberOfLines={1}>
                    {r.settlement_number ?? '—'}
                  </Text>
                  <Text style={styles.statusPill}>{statusLabel(r.status)}</Text>
                </View>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {modelNameById[r.model_id] ?? r.model_id} · {formatDate(r.created_at)}
                  {r.paid_at ? ` · ${s.listColPaidAt} ${formatDate(r.paid_at)}` : ''}
                </Text>
                <Text style={styles.rowAmount}>{formatCents(r.net_amount_cents, r.currency)}</Text>
              </View>
              <View style={styles.rowActions}>
                {r.status === 'draft' && isMember && (
                  <>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingId(r.id);
                        setMode('edit');
                      }}
                    >
                      <Text style={styles.linkAction}>{uiCopy.common.edit}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onMarkRecorded(r)}>
                      <Text style={styles.linkAction}>{s.markRecorded}</Text>
                    </TouchableOpacity>
                    {/* Delete bleibt Owner-only — RLS Policy ams_owner_delete_draft */}
                    {isOwner && (
                      <TouchableOpacity onPress={() => onDelete(r)}>
                        <Text style={styles.linkDanger}>{s.delete}</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
                {r.status === 'recorded' && isMember && (
                  <TouchableOpacity onPress={() => onMarkPaid(r)}>
                    <Text style={styles.linkAction}>{s.markPaid}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.refreshBtn} onPress={() => void load()} disabled={loading}>
        <Text style={styles.refreshText}>{uiCopy.common.refresh}</Text>
      </TouchableOpacity>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Editor (create + edit)
// ─────────────────────────────────────────────────────────────────────────────

type EditorProps = {
  organizationId: string;
  settlementId: string | null;
  models: SupabaseModel[];
  modelNameById: Record<string, string>;
  canEdit: boolean;
  onClose: () => void;
};

const SettlementEditor: React.FC<EditorProps> = ({
  organizationId,
  settlementId,
  models,
  modelNameById,
  canEdit,
  onClose,
}) => {
  const s = uiCopy.settlements;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modelId, setModelId] = useState<string>('');
  const [modelSearch, setModelSearch] = useState<string>('');
  const [showModelPicker, setShowModelPicker] = useState<boolean>(false);
  const [settlementNumber, setSettlementNumber] = useState<string>('');
  const [currency, setCurrency] = useState<string>('EUR');
  const [grossInput, setGrossInput] = useState<string>('0.00');
  const [commissionInput, setCommissionInput] = useState<string>('0.00');
  const [notes, setNotes] = useState<string>('');
  const [existing, setExisting] = useState<AgencyModelSettlementWithItems | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      if (settlementId) {
        const row = await getAgencyModelSettlementWithItems(settlementId);
        if (!cancelled && row) {
          setExisting(row);
          setModelId(row.model_id);
          setSettlementNumber(row.settlement_number ?? '');
          setCurrency(row.currency || 'EUR');
          setGrossInput(centsToInput(row.gross_amount_cents));
          setCommissionInput(centsToInput(row.commission_amount_cents));
          setNotes(row.notes ?? '');
        }
      }
      if (!cancelled) setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [settlementId]);

  const grossCents = useMemo(() => parseAmountToCents(grossInput), [grossInput]);
  const commissionCents = useMemo(() => parseAmountToCents(commissionInput), [commissionInput]);
  const netCents = Math.max(0, grossCents - commissionCents);

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    const list = models.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    if (!q) return list.slice(0, 50);
    return list.filter((m) => (m.name ?? '').toLowerCase().includes(q)).slice(0, 50);
  }, [models, modelSearch]);

  const isEdit = !!settlementId && !!existing;
  const lockedReadOnly = isEdit && existing?.status !== 'draft';
  const editable = canEdit && !lockedReadOnly && !saving;

  const onSave = useCallback(async () => {
    if (!editable) return;
    if (!modelId) {
      showAppAlert(uiCopy.common.error, s.fieldModel);
      return;
    }
    setSaving(true);
    try {
      if (!isEdit) {
        const id = await createAgencyModelSettlement(organizationId, {
          model_id: modelId,
          currency,
          gross_amount_cents: grossCents,
          commission_amount_cents: commissionCents,
          net_amount_cents: netCents,
          notes: notes.trim() || null,
        });
        if (!id) {
          showAppAlert(uiCopy.common.error, s.saveFailed);
          return;
        }
        if (settlementNumber.trim()) {
          await updateAgencyModelSettlement(id, organizationId, {
            settlement_number: settlementNumber.trim(),
          });
        }
        showAppAlert(uiCopy.common.success, s.saveSuccess);
        onClose();
      } else if (existing) {
        const ok = await updateAgencyModelSettlement(existing.id, organizationId, {
          currency,
          gross_amount_cents: grossCents,
          commission_amount_cents: commissionCents,
          net_amount_cents: netCents,
          notes: notes.trim() || null,
          settlement_number: settlementNumber.trim() || null,
        });
        if (!ok) {
          showAppAlert(uiCopy.common.error, s.saveFailed);
          return;
        }
        showAppAlert(uiCopy.common.success, s.saveSuccess);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }, [
    editable,
    modelId,
    isEdit,
    organizationId,
    currency,
    grossCents,
    commissionCents,
    netCents,
    notes,
    settlementNumber,
    existing,
    onClose,
    s,
  ]);

  if (loading) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.hint}>{s.loading}</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.editorWrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>
            {isEdit ? statusLabel(existing!.status) : s.createTitle}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.linkAction}>{s.backToList}</Text>
          </TouchableOpacity>
        </View>

        {lockedReadOnly && <Text style={styles.hint}>{s.ownerOnlyHint}</Text>}

        {/* Model picker */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{s.fieldModel}</Text>
          {modelId ? (
            <View style={styles.selectedModelRow}>
              <Text style={styles.selectedModelName}>{modelNameById[modelId] ?? modelId}</Text>
              {!isEdit && editable && (
                <TouchableOpacity onPress={() => setModelId('')}>
                  <Text style={styles.linkAction}>{uiCopy.common.change}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={modelSearch}
                onChangeText={(v) => {
                  setModelSearch(v);
                  setShowModelPicker(true);
                }}
                onFocus={() => setShowModelPicker(true)}
                placeholder={s.fieldModelPlaceholder}
                placeholderTextColor={colors.textSecondary}
                editable={editable}
              />
              {showModelPicker && filteredModels.length > 0 && (
                <View style={styles.modelPicker}>
                  {filteredModels.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => {
                        setModelId(m.id);
                        setShowModelPicker(false);
                        setModelSearch('');
                      }}
                      style={styles.modelPickerRow}
                    >
                      <Text style={styles.modelPickerName}>{m.name ?? '—'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </View>

        {/* Settlement number */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{s.fieldSettlementNumber}</Text>
          <TextInput
            style={styles.input}
            value={settlementNumber}
            onChangeText={setSettlementNumber}
            placeholder={s.fieldSettlementNumberPlaceholder}
            placeholderTextColor={colors.textSecondary}
            editable={editable}
          />
        </View>

        {/* Currency */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{s.fieldCurrency}</Text>
          <TextInput
            style={styles.input}
            value={currency}
            onChangeText={(v) => setCurrency(v.toUpperCase().slice(0, 3))}
            autoCapitalize="characters"
            editable={editable}
          />
        </View>

        {/* Amounts */}
        <View style={styles.amountsRow}>
          <View style={[styles.field, { flex: 1, marginRight: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{s.fieldGross}</Text>
            <TextInput
              style={styles.input}
              value={grossInput}
              onChangeText={setGrossInput}
              keyboardType="decimal-pad"
              editable={editable}
            />
          </View>
          <View style={[styles.field, { flex: 1, marginHorizontal: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{s.fieldCommission}</Text>
            <TextInput
              style={styles.input}
              value={commissionInput}
              onChangeText={setCommissionInput}
              keyboardType="decimal-pad"
              editable={editable}
            />
          </View>
          <View style={[styles.field, { flex: 1, marginLeft: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{s.fieldNet}</Text>
            <Text style={[styles.input, styles.readOnlyValue]}>
              {formatCents(netCents, currency)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{s.fieldNotes}</Text>
          <TextInput
            style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder={s.fieldNotesPlaceholder}
            placeholderTextColor={colors.textSecondary}
            multiline
            editable={editable}
          />
        </View>

        {editable && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => void onSave()}
            disabled={saving}
          >
            <Text style={styles.primaryBtnText}>{saving ? '…' : s.save}</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles (kept in lockstep with InvoicesPanel for visual parity).
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    // Phase D (2026-04-19): marginHorizontal hinzugefügt — Parität mit
    // InvoicesPanel/BillingDetailsForm. BillingHubView.body hat sein
    // paddingHorizontal entfernt; Karten bringen ihr Side-Padding selbst mit.
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  intro: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  hint: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  invoiceNo: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },
  statusPill: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  rowMeta: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowAmount: {
    ...typography.label,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 4,
  },
  rowActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  linkAction: { ...typography.label, color: colors.accentGreen, fontSize: 12 },
  linkDanger: { ...typography.label, color: colors.error, fontSize: 12 },
  primaryBtn: {
    backgroundColor: colors.buttonOptionGreen,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  primaryBtnText: { ...typography.label, color: colors.surface, fontSize: 12 },
  refreshBtn: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  refreshText: { ...typography.label, color: colors.textSecondary, fontSize: 12 },

  editorWrap: {
    paddingBottom: spacing.xl,
  },
  field: { marginBottom: spacing.sm },
  fieldLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  readOnlyValue: {
    color: colors.textSecondary,
    backgroundColor: colors.surface,
  },
  amountsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  selectedModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedModelName: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 14,
  },
  modelPicker: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    maxHeight: 240,
  },
  modelPickerRow: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modelPickerName: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 13,
  },
});

export default AgencyModelSettlementsPanel;
