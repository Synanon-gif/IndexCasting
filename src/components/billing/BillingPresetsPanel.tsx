/**
 * BillingPresetsPanel — Agency × Client billing presets management.
 *
 * Lives under the Billing Hub `Clients & Presets` sub-tab. Surfaces the
 * `agency_client_billing_presets` table as a per-client list of reusable
 * billing templates that prefill new invoice drafts (without ever altering
 * existing invoices — the recipient_billing_snapshot stays immutable).
 *
 * Behaviour:
 *   - Owner can create / edit / delete / set-default presets per client.
 *   - Booker (org member) sees read-only list (RLS still enforces).
 *   - Clients organizations seed naturally from existing presets + invoices
 *     where this agency was the issuer (`recipient_organization_id` distinct).
 *   - Models NEVER see this UI (billing firewall — never mount in model workspace).
 *
 * Notes:
 *   - All visible strings come from `uiCopy.billingPresets` (English-only).
 *   - Service contract: Option A (boolean / null / [] on failure, never throws).
 *   - At most one preset per (agency, client) pair may have `is_default = true`
 *     (DB-enforced via partial unique index `acbp_one_default_per_pair`).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { useAuth } from '../../context/AuthContext';
import { isOrganizationOperationalMember } from '../../services/orgRoleTypes';
import {
  createAgencyClientBillingPreset,
  deleteAgencyClientBillingPreset,
  listAgencyClientBillingPresets,
  updateAgencyClientBillingPreset,
} from '../../services/agencyClientBillingPresetsSupabase';
import { listInvoicesForOrganization } from '../../services/invoicesSupabase';
import { getOrganizationById } from '../../services/organizationsInvitationsSupabase';
import type {
  AgencyClientBillingPresetInput,
  AgencyClientBillingPresetPatch,
  AgencyClientBillingPresetRow,
} from '../../types/billingTypes';
import { showAppAlert, showConfirmAlert } from '../../utils/crossPlatformAlert';

type Props = {
  organizationId: string | null;
};

type Mode =
  | { kind: 'list' }
  | { kind: 'create'; clientOrganizationId: string }
  | { kind: 'edit'; presetId: string };

type ClientGroup = {
  clientOrganizationId: string;
  clientName: string;
  presets: AgencyClientBillingPresetRow[];
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

export const BillingPresetsPanel: React.FC<Props> = ({ organizationId }) => {
  const { profile } = useAuth();
  const c = uiCopy.billingPresets;
  // Phase A (2026-11-20): Presets sind operationale Convenience-Daten — Owner UND
  // Booker/Employee dürfen erstellen/editieren/löschen. Siehe Migration 20261120.
  const isMember = isOrganizationOperationalMember(profile?.org_member_role);

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ClientGroup[]>([]);

  /** Load presets for this agency, plus seed client list from invoices issued. */
  const load = useCallback(async () => {
    if (!organizationId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [presets, invoices] = await Promise.all([
        listAgencyClientBillingPresets(organizationId, { limit: 500 }),
        listInvoicesForOrganization(organizationId, {
          types: ['agency_to_client'],
          limit: 500,
        }),
      ]);

      // Distinct client organization ids from presets + invoices.
      const clientIdSet = new Set<string>();
      presets.forEach((p) => {
        if (p.client_organization_id) clientIdSet.add(p.client_organization_id);
      });
      invoices.forEach((inv) => {
        if (inv.recipient_organization_id) {
          clientIdSet.add(inv.recipient_organization_id);
        }
      });

      const clientIds = Array.from(clientIdSet);
      // Resolve names in parallel (org SELECT is RLS-scoped to members; for clients
      // outside the agency org membership this returns null and we fall back to id).
      const nameMap: Record<string, string> = {};
      await Promise.all(
        clientIds.map(async (id) => {
          const org = await getOrganizationById(id);
          if (org?.name) nameMap[id] = org.name;
        }),
      );

      const grouped: ClientGroup[] = clientIds
        .map((id) => ({
          clientOrganizationId: id,
          clientName: nameMap[id] ?? id.slice(0, 8),
          presets: presets
            .filter((p) => p.client_organization_id === id)
            .sort((a, b) => {
              if (a.is_default && !b.is_default) return -1;
              if (!a.is_default && b.is_default) return 1;
              return (a.label ?? '').localeCompare(b.label ?? '');
            }),
        }))
        .sort((a, b) => a.clientName.localeCompare(b.clientName));

      setGroups(grouped);
    } catch (e) {
      console.error('[BillingPresetsPanel.load] exception:', e);
      showAppAlert(uiCopy.common.error, c.saveFailed);
    } finally {
      setLoading(false);
    }
  }, [organizationId, c.saveFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDelete = useCallback(
    (preset: AgencyClientBillingPresetRow) => {
      if (!isMember || !organizationId) return;
      showConfirmAlert(
        c.presetDeleteConfirmTitle,
        c.presetDeleteConfirmMessage,
        () => {
          void deleteAgencyClientBillingPreset(preset.id, organizationId).then((ok) => {
            if (!ok) {
              showAppAlert(uiCopy.common.error, c.presetDeleteFailed);
              return;
            }
            void load();
          });
        },
        uiCopy.common.delete,
      );
    },
    [isMember, organizationId, load, c],
  );

  const onSetDefault = useCallback(
    (preset: AgencyClientBillingPresetRow) => {
      if (!isMember || !organizationId) return;
      void updateAgencyClientBillingPreset(preset.id, organizationId, {
        is_default: true,
      }).then((ok) => {
        if (!ok) {
          showAppAlert(uiCopy.common.error, c.saveFailed);
          return;
        }
        void load();
      });
    },
    [isMember, organizationId, load, c],
  );

  if (!organizationId) return null;

  if (mode.kind === 'create') {
    return (
      <PresetEditor
        agencyOrganizationId={organizationId}
        clientOrganizationId={mode.clientOrganizationId}
        clientName={
          groups.find((g) => g.clientOrganizationId === mode.clientOrganizationId)?.clientName ??
          mode.clientOrganizationId
        }
        existing={null}
        canEdit={isMember}
        onClose={() => {
          setMode({ kind: 'list' });
          void load();
        }}
      />
    );
  }
  if (mode.kind === 'edit') {
    const existing = groups.flatMap((g) => g.presets).find((p) => p.id === mode.presetId) ?? null;
    if (!existing) {
      // Fallback: stale id; bounce back to list.
      return (
        <View style={styles.card}>
          <Text style={styles.empty}>{c.presetListEmpty}</Text>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => {
              setMode({ kind: 'list' });
              void load();
            }}
          >
            <Text style={styles.refreshText}>{uiCopy.common.refresh}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <PresetEditor
        agencyOrganizationId={organizationId}
        clientOrganizationId={existing.client_organization_id}
        clientName={
          groups.find((g) => g.clientOrganizationId === existing.client_organization_id)
            ?.clientName ?? existing.client_organization_id
        }
        existing={existing}
        canEdit={isMember}
        onClose={() => {
          setMode({ kind: 'list' });
          void load();
        }}
      />
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>{c.cardTitle}</Text>
      </View>
      <Text style={styles.intro}>{c.intro}</Text>
      {!isMember && <Text style={styles.hint}>{c.ownerOnlyHint}</Text>}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.hint}>{uiCopy.common.loading}</Text>
        </View>
      ) : groups.length === 0 ? (
        <View>
          <Text style={styles.empty}>{c.listEmpty}</Text>
          <Text style={styles.hint}>{c.listEmptyHint}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {groups.map((g) => (
            <View key={g.clientOrganizationId} style={styles.clientGroup}>
              <View style={styles.clientHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{g.clientName}</Text>
                  <Text style={styles.rowMeta}>
                    {g.presets.length} {c.presetListTitle.toLowerCase()}
                  </Text>
                </View>
                {isMember && (
                  <TouchableOpacity
                    style={styles.smallBtn}
                    onPress={() =>
                      setMode({
                        kind: 'create',
                        clientOrganizationId: g.clientOrganizationId,
                      })
                    }
                  >
                    <Text style={styles.smallBtnText}>{c.presetCreate}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {g.presets.length === 0 ? (
                <Text style={styles.empty}>{c.presetListEmpty}</Text>
              ) : (
                <View style={styles.presetList}>
                  {g.presets.map((p) => (
                    <View key={p.id} style={styles.presetRow}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.rowTopLine}>
                          <Text style={styles.presetLabel}>
                            {p.label?.trim() || c.fieldLabelPlaceholder}
                          </Text>
                          {p.is_default && (
                            <Text style={styles.defaultPill}>{c.presetIsDefault}</Text>
                          )}
                        </View>
                        <Text style={styles.rowMeta}>
                          {p.default_currency} · {p.default_payment_terms_days}d ·{' '}
                          {formatDate(p.updated_at ?? p.created_at)}
                        </Text>
                      </View>
                      <View style={styles.rowActions}>
                        <TouchableOpacity onPress={() => setMode({ kind: 'edit', presetId: p.id })}>
                          <Text style={styles.linkAction}>
                            {isMember ? c.presetEdit : uiCopy.common.edit}
                          </Text>
                        </TouchableOpacity>
                        {isMember && !p.is_default && (
                          <TouchableOpacity onPress={() => onSetDefault(p)}>
                            <Text style={styles.linkAction}>{c.presetSetDefault}</Text>
                          </TouchableOpacity>
                        )}
                        {isMember && (
                          <TouchableOpacity onPress={() => onDelete(p)}>
                            <Text style={styles.linkDanger}>{c.presetDelete}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
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
// Editor
// ─────────────────────────────────────────────────────────────────────────────

type EditorProps = {
  agencyOrganizationId: string;
  clientOrganizationId: string;
  clientName: string;
  existing: AgencyClientBillingPresetRow | null;
  canEdit: boolean;
  onClose: () => void;
};

const PresetEditor: React.FC<EditorProps> = ({
  agencyOrganizationId,
  clientOrganizationId,
  clientName,
  existing,
  canEdit,
  onClose,
}) => {
  const c = uiCopy.billingPresets;

  const [saving, setSaving] = useState(false);

  const [label, setLabel] = useState<string>(existing?.label ?? '');
  const [isDefault, setIsDefault] = useState<boolean>(existing?.is_default ?? false);

  const [recipientName, setRecipientName] = useState<string>(
    existing?.recipient_billing_name ?? '',
  );
  const [address1, setAddress1] = useState<string>(existing?.recipient_billing_address_1 ?? '');
  const [address2, setAddress2] = useState<string>(existing?.recipient_billing_address_2 ?? '');
  const [city, setCity] = useState<string>(existing?.recipient_billing_city ?? '');
  const [postalCode, setPostalCode] = useState<string>(
    existing?.recipient_billing_postal_code ?? '',
  );
  const [state, setState] = useState<string>(existing?.recipient_billing_state ?? '');
  const [country, setCountry] = useState<string>(existing?.recipient_billing_country ?? '');
  const [recipientEmail, setRecipientEmail] = useState<string>(
    existing?.recipient_billing_email ?? '',
  );
  const [vatId, setVatId] = useState<string>(existing?.recipient_vat_id ?? '');
  const [taxId, setTaxId] = useState<string>(existing?.recipient_tax_id ?? '');

  const [currency, setCurrency] = useState<string>(existing?.default_currency ?? 'EUR');
  const [taxMode, setTaxMode] = useState<'manual' | 'stripe_tax'>(
    existing?.default_tax_mode ?? 'manual',
  );
  const [taxRateInput, setTaxRateInput] = useState<string>(
    existing?.default_tax_rate_percent != null ? String(existing.default_tax_rate_percent) : '',
  );
  const [reverseCharge, setReverseCharge] = useState<boolean>(
    existing?.default_reverse_charge ?? false,
  );
  const [paymentTermsInput, setPaymentTermsInput] = useState<string>(
    String(existing?.default_payment_terms_days ?? 30),
  );
  const [notes, setNotes] = useState<string>(existing?.default_notes ?? '');

  const editable = canEdit && !saving;
  const isEdit = !!existing;

  const onSave = useCallback(async () => {
    if (!editable) return;
    setSaving(true);
    try {
      const taxRate = taxRateInput.trim() === '' ? null : Number(taxRateInput.replace(',', '.'));
      const paymentTerms = Number(paymentTermsInput) || 30;

      if (isEdit && existing) {
        const patch: AgencyClientBillingPresetPatch = {
          label: label.trim() || null,
          is_default: isDefault,
          recipient_billing_name: recipientName.trim() || null,
          recipient_billing_address_1: address1.trim() || null,
          recipient_billing_address_2: address2.trim() || null,
          recipient_billing_city: city.trim() || null,
          recipient_billing_postal_code: postalCode.trim() || null,
          recipient_billing_state: state.trim() || null,
          recipient_billing_country: country.trim() || null,
          recipient_billing_email: recipientEmail.trim() || null,
          recipient_vat_id: vatId.trim() || null,
          recipient_tax_id: taxId.trim() || null,
          default_currency: currency.trim().toUpperCase().slice(0, 3) || 'EUR',
          default_tax_mode: taxMode,
          default_tax_rate_percent: taxRate != null && Number.isFinite(taxRate) ? taxRate : null,
          default_reverse_charge: reverseCharge,
          default_payment_terms_days: paymentTerms,
          default_notes: notes.trim() || null,
        };
        const ok = await updateAgencyClientBillingPreset(existing.id, agencyOrganizationId, patch);
        if (!ok) {
          showAppAlert(uiCopy.common.error, c.saveFailed);
          return;
        }
      } else {
        const payload: AgencyClientBillingPresetInput = {
          client_organization_id: clientOrganizationId,
          label: label.trim() || null,
          is_default: isDefault,
          recipient_billing_name: recipientName.trim() || null,
          recipient_billing_address_1: address1.trim() || null,
          recipient_billing_address_2: address2.trim() || null,
          recipient_billing_city: city.trim() || null,
          recipient_billing_postal_code: postalCode.trim() || null,
          recipient_billing_state: state.trim() || null,
          recipient_billing_country: country.trim() || null,
          recipient_billing_email: recipientEmail.trim() || null,
          recipient_vat_id: vatId.trim() || null,
          recipient_tax_id: taxId.trim() || null,
          default_currency: currency.trim().toUpperCase().slice(0, 3) || 'EUR',
          default_tax_mode: taxMode,
          default_tax_rate_percent: taxRate != null && Number.isFinite(taxRate) ? taxRate : null,
          default_reverse_charge: reverseCharge,
          default_payment_terms_days: paymentTerms,
          default_notes: notes.trim() || null,
        };
        const id = await createAgencyClientBillingPreset(agencyOrganizationId, payload);
        if (!id) {
          showAppAlert(uiCopy.common.error, c.saveFailed);
          return;
        }
      }
      onClose();
    } catch (e) {
      console.error('[PresetEditor.onSave] exception:', e);
      showAppAlert(uiCopy.common.error, c.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [
    editable,
    isEdit,
    existing,
    agencyOrganizationId,
    clientOrganizationId,
    label,
    isDefault,
    recipientName,
    address1,
    address2,
    city,
    postalCode,
    state,
    country,
    recipientEmail,
    vatId,
    taxId,
    currency,
    taxMode,
    taxRateInput,
    reverseCharge,
    paymentTermsInput,
    notes,
    c,
    onClose,
  ]);

  return (
    <ScrollView contentContainerStyle={styles.editorWrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>
            {isEdit ? c.presetEdit : c.presetCreate} · {clientName}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.linkAction}>{uiCopy.common.cancel}</Text>
          </TouchableOpacity>
        </View>

        {!canEdit && <Text style={styles.hint}>{c.ownerOnlyHint}</Text>}
        {isEdit && <Text style={styles.hint}>{c.snapshotImmutabilityNote}</Text>}

        {/* Label */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{c.fieldLabel}</Text>
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder={c.fieldLabelPlaceholder}
            placeholderTextColor={colors.textSecondary}
            editable={editable}
          />
        </View>

        {/* Default toggle */}
        <View style={styles.toggleRow}>
          <Text style={styles.fieldLabel}>{c.presetSetDefault}</Text>
          <Switch
            value={isDefault}
            onValueChange={setIsDefault}
            disabled={!editable}
            trackColor={{ false: colors.border, true: colors.accentGreen }}
          />
        </View>

        {/* Recipient block */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{c.fieldRecipientName}</Text>
          <TextInput
            style={styles.input}
            value={recipientName}
            onChangeText={setRecipientName}
            editable={editable}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{c.fieldRecipientAddress1}</Text>
          <TextInput
            style={styles.input}
            value={address1}
            onChangeText={setAddress1}
            editable={editable}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{c.fieldRecipientAddress2}</Text>
          <TextInput
            style={styles.input}
            value={address2}
            onChangeText={setAddress2}
            editable={editable}
          />
        </View>
        <View style={styles.amountsRow}>
          <View style={[styles.field, { flex: 2, marginRight: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldRecipientCity}</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              editable={editable}
            />
          </View>
          <View style={[styles.field, { flex: 1, marginLeft: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldRecipientPostalCode}</Text>
            <TextInput
              style={styles.input}
              value={postalCode}
              onChangeText={setPostalCode}
              editable={editable}
            />
          </View>
        </View>
        <View style={styles.amountsRow}>
          <View style={[styles.field, { flex: 1, marginRight: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldRecipientState}</Text>
            <TextInput
              style={styles.input}
              value={state}
              onChangeText={setState}
              editable={editable}
            />
          </View>
          <View style={[styles.field, { flex: 1, marginLeft: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldRecipientCountry}</Text>
            <TextInput
              style={styles.input}
              value={country}
              onChangeText={setCountry}
              editable={editable}
              autoCapitalize="characters"
            />
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{c.fieldRecipientEmail}</Text>
          <TextInput
            style={styles.input}
            value={recipientEmail}
            onChangeText={setRecipientEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={editable}
          />
        </View>
        <View style={styles.amountsRow}>
          <View style={[styles.field, { flex: 1, marginRight: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldVatId}</Text>
            <TextInput
              style={styles.input}
              value={vatId}
              onChangeText={setVatId}
              editable={editable}
              autoCapitalize="characters"
            />
          </View>
          <View style={[styles.field, { flex: 1, marginLeft: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldTaxId}</Text>
            <TextInput
              style={styles.input}
              value={taxId}
              onChangeText={setTaxId}
              editable={editable}
            />
          </View>
        </View>

        {/* Tax / payment defaults */}
        <View style={styles.amountsRow}>
          <View style={[styles.field, { flex: 1, marginRight: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldCurrency}</Text>
            <TextInput
              style={styles.input}
              value={currency}
              onChangeText={(v) => setCurrency(v.toUpperCase().slice(0, 3))}
              autoCapitalize="characters"
              editable={editable}
            />
          </View>
          <View style={[styles.field, { flex: 1, marginHorizontal: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldTaxRate}</Text>
            <TextInput
              style={styles.input}
              value={taxRateInput}
              onChangeText={setTaxRateInput}
              keyboardType="decimal-pad"
              editable={editable}
            />
          </View>
          <View style={[styles.field, { flex: 1, marginLeft: spacing.xs }]}>
            <Text style={styles.fieldLabel}>{c.fieldPaymentTerms}</Text>
            <TextInput
              style={styles.input}
              value={paymentTermsInput}
              onChangeText={setPaymentTermsInput}
              keyboardType="number-pad"
              editable={editable}
            />
          </View>
        </View>

        {/* Tax mode selector */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{c.fieldTaxMode}</Text>
          <View style={styles.modeToggleRow}>
            {(['manual', 'stripe_tax'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                disabled={!editable}
                onPress={() => setTaxMode(m)}
                style={[styles.modeChip, taxMode === m ? styles.modeChipActive : null]}
              >
                <Text
                  style={[styles.modeChipText, taxMode === m ? styles.modeChipTextActive : null]}
                >
                  {m === 'manual' ? 'Manual' : 'Stripe Tax'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Reverse charge */}
        <View style={styles.toggleRow}>
          <Text style={styles.fieldLabel}>{c.fieldReverseCharge}</Text>
          <Switch
            value={reverseCharge}
            onValueChange={setReverseCharge}
            disabled={!editable}
            trackColor={{ false: colors.border, true: colors.accentGreen }}
          />
        </View>

        {/* Notes */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{c.fieldNotes}</Text>
          <TextInput
            style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder={c.fieldNotesPlaceholder}
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
            <Text style={styles.primaryBtnText}>{saving ? '…' : c.save}</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles (visual parity with InvoicesPanel / AgencyModelSettlementsPanel).
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
    flex: 1,
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
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  list: { gap: spacing.md },
  clientGroup: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clientHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  clientName: {
    ...typography.label,
    fontSize: 14,
    color: colors.textPrimary,
  },
  presetList: { gap: spacing.xs, marginTop: spacing.xs },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    gap: spacing.sm,
  },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  presetLabel: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  defaultPill: {
    ...typography.label,
    fontSize: 10,
    color: colors.surface,
    backgroundColor: colors.accentGreen,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  rowMeta: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  smallBtn: {
    backgroundColor: colors.buttonOptionGreen,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  smallBtnText: { ...typography.label, color: colors.surface, fontSize: 11 },
  linkAction: { ...typography.label, color: colors.accentGreen, fontSize: 12 },
  linkDanger: { ...typography.label, color: colors.error, fontSize: 12 },
  primaryBtn: {
    backgroundColor: colors.buttonOptionGreen,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
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
  amountsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  modeChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  modeChipActive: {
    backgroundColor: colors.accentGreen,
    borderColor: colors.accentGreen,
  },
  modeChipText: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  modeChipTextActive: {
    color: colors.surface,
  },
});

export default BillingPresetsPanel;
