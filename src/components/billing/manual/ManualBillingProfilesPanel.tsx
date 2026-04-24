/**
 * ManualBillingProfilesPanel — list + edit for all manual billing profiles.
 *
 * Three sub-tabs:
 *   - Agency profiles  (manual_billing_agency_profiles)
 *   - Clients          (manual_billing_counterparties, kind='client')
 *   - Models           (manual_billing_counterparties, kind='model')
 *
 * Search, A–Z sort (DB), archived filter, create / edit / archive / delete.
 *
 * Owner-only delete is enforced server-side by RLS; we surface the failure
 * gracefully if a non-owner attempts it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { colors, spacing, typography } from '../../../theme/theme';
import { uiCopy } from '../../../constants/uiCopy';
import { showAppAlert, showConfirmAlert } from '../../../utils/crossPlatformAlert';
import {
  archiveManualAgencyBillingProfile,
  archiveManualBillingCounterparty,
  deleteManualAgencyBillingProfile,
  deleteManualBillingCounterparty,
  listManualAgencyBillingProfiles,
  listManualBillingCounterparties,
  upsertManualAgencyBillingProfile,
  upsertManualBillingCounterparty,
} from '../../../services/manualBillingProfilesSupabase';
import type {
  ManualBillingAgencyProfileInput,
  ManualBillingAgencyProfileRow,
  ManualBillingCounterpartyInput,
  ManualBillingCounterpartyKind,
  ManualBillingCounterpartyRow,
} from '../../../types/manualBillingTypes';

type Tab = 'agency' | 'client' | 'model';

type EditMode =
  | { kind: 'list' }
  | { kind: 'agencyForm'; existingId: string | null }
  | { kind: 'counterpartyForm'; cpKind: ManualBillingCounterpartyKind; existingId: string | null };

type Props = {
  agencyOrganizationId: string;
  onBack: () => void;
};

export const ManualBillingProfilesPanel: React.FC<Props> = ({ agencyOrganizationId, onBack }) => {
  const c = uiCopy.manualBilling;
  const [tab, setTab] = useState<Tab>('agency');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agencyRows, setAgencyRows] = useState<ManualBillingAgencyProfileRow[]>([]);
  const [counterpartyRows, setCounterpartyRows] = useState<ManualBillingCounterpartyRow[]>([]);
  const [mode, setMode] = useState<EditMode>({ kind: 'list' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'agency') {
        const rows = await listManualAgencyBillingProfiles(agencyOrganizationId, {
          includeArchived: showArchived,
        });
        setAgencyRows(rows);
      } else {
        const rows = await listManualBillingCounterparties(agencyOrganizationId, {
          kind: tab,
          includeArchived: showArchived,
          search: search.trim() || undefined,
        });
        setCounterpartyRows(rows);
      }
    } finally {
      setLoading(false);
    }
  }, [agencyOrganizationId, tab, showArchived, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── Filter for agency tab (client-side, since DB does not search agency table) ──
  const filteredAgency = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return agencyRows;
    return agencyRows.filter((r) => {
      return (
        r.legal_name.toLowerCase().includes(term) ||
        (r.trading_name ?? '').toLowerCase().includes(term) ||
        (r.vat_number ?? '').toLowerCase().includes(term) ||
        (r.city ?? '').toLowerCase().includes(term) ||
        (r.email ?? '').toLowerCase().includes(term)
      );
    });
  }, [agencyRows, search]);

  // ── Edit / form views ───────────────────────────────────────────────────
  if (mode.kind === 'agencyForm') {
    const existing = mode.existingId
      ? (agencyRows.find((r) => r.id === mode.existingId) ?? null)
      : null;
    return (
      <ScrollView contentContainerStyle={s.formScroll}>
        <ScreenHeader
          title={existing ? c.profilesEditTitle : c.profilesNewAgencyTitle}
          subtitle={c.profilesScreenSubtitle}
          onBack={() => setMode({ kind: 'list' })}
        />
        <AgencyProfileForm
          agencyOrganizationId={agencyOrganizationId}
          existing={existing}
          onCancel={() => setMode({ kind: 'list' })}
          onSaved={async () => {
            await reload();
            setMode({ kind: 'list' });
          }}
        />
      </ScrollView>
    );
  }

  if (mode.kind === 'counterpartyForm') {
    const existing = mode.existingId
      ? (counterpartyRows.find((r) => r.id === mode.existingId) ?? null)
      : null;
    const title = existing
      ? c.profilesEditTitle
      : mode.cpKind === 'client'
        ? c.profilesNewClientTitle
        : c.profilesNewModelTitle;
    return (
      <ScrollView contentContainerStyle={s.formScroll}>
        <ScreenHeader
          title={title}
          subtitle={c.profilesScreenSubtitle}
          onBack={() => setMode({ kind: 'list' })}
        />
        <CounterpartyForm
          agencyOrganizationId={agencyOrganizationId}
          cpKind={mode.cpKind}
          existing={existing}
          onCancel={() => setMode({ kind: 'list' })}
          onSaved={async () => {
            await reload();
            setMode({ kind: 'list' });
          }}
        />
      </ScrollView>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'agency', label: c.profilesTabAgency },
    { key: 'client', label: c.profilesTabClients },
    { key: 'model', label: c.profilesTabModels },
  ];

  return (
    <ScrollView contentContainerStyle={s.listScroll}>
      <ScreenHeader
        title={c.profilesScreenTitle}
        subtitle={c.profilesScreenSubtitle}
        onBack={onBack}
      />

      <View style={s.tabBar}>
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[s.tabPill, active && s.tabPillActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.tabLabel, active && s.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.controlsRow}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={c.profilesSearchPlaceholder}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <View style={s.archiveToggle}>
          <Text style={s.archiveLabel}>{c.profilesShowArchived}</Text>
          <Switch
            value={showArchived}
            onValueChange={setShowArchived}
            trackColor={{ false: colors.border, true: colors.textPrimary }}
          />
        </View>
      </View>

      <TouchableOpacity
        style={s.primaryBtn}
        onPress={() => {
          if (tab === 'agency') setMode({ kind: 'agencyForm', existingId: null });
          else setMode({ kind: 'counterpartyForm', cpKind: tab, existingId: null });
        }}
        accessibilityRole="button"
      >
        <Text style={s.primaryBtnText}>{c.profilesNew}</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={s.loadingBlock}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : tab === 'agency' ? (
        <AgencyList
          rows={filteredAgency}
          onSelect={(id) => setMode({ kind: 'agencyForm', existingId: id })}
          onArchive={async (id, archived) => {
            const ok = await archiveManualAgencyBillingProfile(agencyOrganizationId, id, !archived);
            if (!ok) showAppAlert(archived ? c.restoreFailed : c.archiveFailed);
            else await reload();
          }}
          onDelete={(id) => {
            showConfirmAlert(
              c.profilesDeleteConfirmTitle,
              c.profilesDeleteConfirmBody,
              async () => {
                const ok = await deleteManualAgencyBillingProfile(agencyOrganizationId, id);
                if (!ok) showAppAlert(c.deleteFailed);
                else await reload();
              },
              c.profilesDelete,
            );
          }}
        />
      ) : (
        <CounterpartyList
          rows={counterpartyRows}
          onSelect={(id) => setMode({ kind: 'counterpartyForm', cpKind: tab, existingId: id })}
          onArchive={async (id, archived) => {
            const ok = await archiveManualBillingCounterparty(agencyOrganizationId, id, !archived);
            if (!ok) showAppAlert(archived ? c.restoreFailed : c.archiveFailed);
            else await reload();
          }}
          onDelete={(id) => {
            showConfirmAlert(
              c.profilesDeleteConfirmTitle,
              c.profilesDeleteConfirmBody,
              async () => {
                const ok = await deleteManualBillingCounterparty(agencyOrganizationId, id);
                if (!ok) showAppAlert(c.deleteFailed);
                else await reload();
              },
              c.profilesDelete,
            );
          }}
          emptyText={tab === 'client' ? c.profilesEmptyClients : c.profilesEmptyModels}
        />
      )}

      {tab === 'agency' && !loading && filteredAgency.length === 0 && (
        <Text style={s.emptyText}>{c.profilesEmptyAgency}</Text>
      )}
    </ScrollView>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────

const ScreenHeader: React.FC<{
  title: string;
  subtitle: string;
  onBack: () => void;
}> = ({ title, subtitle, onBack }) => {
  const c = uiCopy.manualBilling;
  return (
    <View style={s.screenHeader}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" style={s.backBtn}>
        <Text style={s.backBtnText}>‹ {c.backToBilling}</Text>
      </TouchableOpacity>
      <Text style={s.screenTitle}>{title}</Text>
      <Text style={s.screenSubtitle}>{subtitle}</Text>
    </View>
  );
};

const AgencyList: React.FC<{
  rows: ManualBillingAgencyProfileRow[];
  onSelect: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void | Promise<void>;
  onDelete: (id: string) => void;
}> = ({ rows, onSelect, onArchive, onDelete }) => {
  const c = uiCopy.manualBilling;
  return (
    <View>
      {rows.map((r) => (
        <View key={r.id} style={s.card}>
          <TouchableOpacity onPress={() => onSelect(r.id)} accessibilityRole="button">
            <View style={s.cardHeaderRow}>
              <Text style={s.cardTitle}>{r.legal_name}</Text>
              <View style={s.badgeRow}>
                {r.is_default && <Badge text={c.profilesDefaultBadge} tone="primary" />}
                {r.is_archived && <Badge text={c.profilesArchived} tone="muted" />}
              </View>
            </View>
            {r.trading_name && <Text style={s.cardSub}>{r.trading_name}</Text>}
            <Text style={s.cardMeta}>
              {[r.country_code, r.vat_number, r.default_currency].filter(Boolean).join(' • ')}
            </Text>
          </TouchableOpacity>
          <View style={s.cardActions}>
            <TouchableOpacity onPress={() => onArchive(r.id, r.is_archived)}>
              <Text style={s.linkBtn}>{r.is_archived ? c.profilesRestore : c.profilesArchive}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onDelete(r.id)}>
              <Text style={[s.linkBtn, { color: colors.errorDark }]}>{c.profilesDelete}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
};

const CounterpartyList: React.FC<{
  rows: ManualBillingCounterpartyRow[];
  onSelect: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void | Promise<void>;
  onDelete: (id: string) => void;
  emptyText: string;
}> = ({ rows, onSelect, onArchive, onDelete, emptyText }) => {
  const c = uiCopy.manualBilling;
  if (rows.length === 0) {
    return <Text style={s.emptyText}>{emptyText}</Text>;
  }
  return (
    <View>
      {rows.map((r) => {
        const isReverseCharge = r.default_vat_treatment === 'reverse_charge';
        return (
          <View key={r.id} style={s.card}>
            <TouchableOpacity onPress={() => onSelect(r.id)} accessibilityRole="button">
              <View style={s.cardHeaderRow}>
                <Text style={s.cardTitle}>{r.legal_name}</Text>
                <View style={s.badgeRow}>
                  {isReverseCharge && <Badge text={c.profilesReverseChargeBadge} tone="warning" />}
                  {r.is_archived && <Badge text={c.profilesArchived} tone="muted" />}
                </View>
              </View>
              {r.display_name && <Text style={s.cardSub}>{r.display_name}</Text>}
              <Text style={s.cardMeta}>
                {[r.country_code, r.vat_number, r.contact_person, r.default_currency]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            </TouchableOpacity>
            <View style={s.cardActions}>
              <TouchableOpacity onPress={() => onArchive(r.id, r.is_archived)}>
                <Text style={s.linkBtn}>
                  {r.is_archived ? c.profilesRestore : c.profilesArchive}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onDelete(r.id)}>
                <Text style={[s.linkBtn, { color: colors.errorDark }]}>{c.profilesDelete}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const Badge: React.FC<{ text: string; tone: 'primary' | 'muted' | 'warning' }> = ({
  text,
  tone,
}) => {
  const bg =
    tone === 'primary'
      ? colors.textPrimary
      : tone === 'warning'
        ? colors.warning
        : colors.borderLight;
  const fg = tone === 'muted' ? colors.textSecondary : colors.background;
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
};

// ── Agency form ───────────────────────────────────────────────────────────

const AgencyProfileForm: React.FC<{
  agencyOrganizationId: string;
  existing: ManualBillingAgencyProfileRow | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}> = ({ agencyOrganizationId, existing, onCancel, onSaved }) => {
  const c = uiCopy.manualBilling;
  const [draft, setDraft] = useState<ManualBillingAgencyProfileInput>({
    legal_name: existing?.legal_name ?? '',
    trading_name: existing?.trading_name ?? null,
    address_line_1: existing?.address_line_1 ?? null,
    address_line_2: existing?.address_line_2 ?? null,
    city: existing?.city ?? null,
    postal_code: existing?.postal_code ?? null,
    state: existing?.state ?? null,
    country_code: existing?.country_code ?? null,
    company_registration_number: existing?.company_registration_number ?? null,
    vat_number: existing?.vat_number ?? null,
    tax_number: existing?.tax_number ?? null,
    phone: existing?.phone ?? null,
    email: existing?.email ?? null,
    website: existing?.website ?? null,
    bank_name: existing?.bank_name ?? null,
    bank_address: existing?.bank_address ?? null,
    iban: existing?.iban ?? null,
    bic: existing?.bic ?? null,
    account_holder: existing?.account_holder ?? null,
    default_currency: existing?.default_currency ?? 'EUR',
    default_payment_terms_days: existing?.default_payment_terms_days ?? 14,
    default_vat_treatment: existing?.default_vat_treatment ?? null,
    default_reverse_charge_note: existing?.default_reverse_charge_note ?? null,
    footer_notes: existing?.footer_notes ?? null,
    is_default: existing?.is_default ?? false,
    is_archived: existing?.is_archived ?? false,
  });
  const dirtyRef = useRef(false);
  const set = <K extends keyof ManualBillingAgencyProfileInput>(
    key: K,
    value: ManualBillingAgencyProfileInput[K],
  ) => {
    dirtyRef.current = true;
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!draft.legal_name?.trim()) {
      showAppAlert(c.saveFailedLegalName);
      return;
    }
    setSaving(true);
    try {
      const res = await upsertManualAgencyBillingProfile(
        agencyOrganizationId,
        draft,
        existing?.id ?? null,
      );
      if (!res.ok) {
        showAppAlert(c.saveFailedGeneric);
        return;
      }
      dirtyRef.current = false;
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (!dirtyRef.current) {
      onCancel();
      return;
    }
    showConfirmAlert(c.unsavedChangesTitle, c.unsavedChangesBody, onCancel, c.cancel);
  };

  return (
    <View style={s.formCard}>
      <SectionTitle text="Identity" />
      <Field
        label={c.fieldLegalName}
        hint={c.fieldLegalNameHint}
        value={draft.legal_name}
        onChangeText={(v) => set('legal_name', v)}
      />
      <Field
        label={c.fieldTradingName}
        value={draft.trading_name ?? ''}
        onChangeText={(v) => set('trading_name', v || null)}
      />

      <SectionTitle text="Address" />
      <Field
        label={c.fieldAddressLine1}
        value={draft.address_line_1 ?? ''}
        onChangeText={(v) => set('address_line_1', v || null)}
      />
      <Field
        label={c.fieldAddressLine2}
        value={draft.address_line_2 ?? ''}
        onChangeText={(v) => set('address_line_2', v || null)}
      />
      <Row>
        <FieldHalf
          label={c.fieldPostalCode}
          value={draft.postal_code ?? ''}
          onChangeText={(v) => set('postal_code', v || null)}
        />
        <FieldHalf
          label={c.fieldCity}
          value={draft.city ?? ''}
          onChangeText={(v) => set('city', v || null)}
        />
      </Row>
      <Row>
        <FieldHalf
          label={c.fieldState}
          value={draft.state ?? ''}
          onChangeText={(v) => set('state', v || null)}
        />
        <FieldHalf
          label={c.fieldCountryCode}
          hint={c.fieldCountryCodeHint}
          value={draft.country_code ?? ''}
          onChangeText={(v) => set('country_code', v ? v.toUpperCase().slice(0, 2) : null)}
          autoCapitalize="characters"
        />
      </Row>

      <SectionTitle text="Tax IDs" />
      <Field
        label={c.fieldCompanyRegistration}
        value={draft.company_registration_number ?? ''}
        onChangeText={(v) => set('company_registration_number', v || null)}
      />
      <Row>
        <FieldHalf
          label={c.fieldVatNumber}
          value={draft.vat_number ?? ''}
          onChangeText={(v) => set('vat_number', v || null)}
        />
        <FieldHalf
          label={c.fieldTaxNumber}
          value={draft.tax_number ?? ''}
          onChangeText={(v) => set('tax_number', v || null)}
        />
      </Row>

      <SectionTitle text="Contact" />
      <Row>
        <FieldHalf
          label={c.fieldPhone}
          value={draft.phone ?? ''}
          onChangeText={(v) => set('phone', v || null)}
        />
        <FieldHalf
          label={c.fieldEmail}
          value={draft.email ?? ''}
          onChangeText={(v) => set('email', v || null)}
          autoCapitalize="none"
        />
      </Row>
      <Field
        label={c.fieldWebsite}
        value={draft.website ?? ''}
        onChangeText={(v) => set('website', v || null)}
        autoCapitalize="none"
      />

      <SectionTitle text="Bank details" />
      <Field
        label={c.fieldAccountHolder}
        value={draft.account_holder ?? ''}
        onChangeText={(v) => set('account_holder', v || null)}
      />
      <Field
        label={c.fieldBankName}
        value={draft.bank_name ?? ''}
        onChangeText={(v) => set('bank_name', v || null)}
      />
      <Field
        label={c.fieldBankAddress}
        value={draft.bank_address ?? ''}
        onChangeText={(v) => set('bank_address', v || null)}
      />
      <Row>
        <FieldHalf
          label={c.fieldIban}
          value={draft.iban ?? ''}
          onChangeText={(v) => set('iban', v || null)}
          autoCapitalize="characters"
        />
        <FieldHalf
          label={c.fieldBic}
          value={draft.bic ?? ''}
          onChangeText={(v) => set('bic', v || null)}
          autoCapitalize="characters"
        />
      </Row>

      <SectionTitle text="Defaults" />
      <Row>
        <FieldHalf
          label={c.fieldDefaultCurrency}
          value={draft.default_currency ?? 'EUR'}
          onChangeText={(v) => set('default_currency', (v || 'EUR').toUpperCase())}
          autoCapitalize="characters"
        />
        <FieldHalf
          label={c.fieldDefaultPaymentTerms}
          value={String(draft.default_payment_terms_days ?? 14)}
          onChangeText={(v) =>
            set(
              'default_payment_terms_days',
              Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 14,
            )
          }
          keyboardType="number-pad"
        />
      </Row>
      <VatTreatmentPicker
        value={draft.default_vat_treatment ?? null}
        onChange={(v) => set('default_vat_treatment', v)}
      />
      <Field
        label={c.fieldDefaultReverseChargeNote}
        hint={c.fieldDefaultReverseChargeNoteHint}
        multiline
        value={draft.default_reverse_charge_note ?? ''}
        onChangeText={(v) => set('default_reverse_charge_note', v || null)}
      />
      <Field
        label={c.fieldFooterNotes}
        multiline
        value={draft.footer_notes ?? ''}
        onChangeText={(v) => set('footer_notes', v || null)}
      />

      <View style={s.toggleRow}>
        <Switch
          value={!!draft.is_default}
          onValueChange={(v) => set('is_default', v)}
          trackColor={{ false: colors.border, true: colors.textPrimary }}
        />
        <Text style={s.toggleLabel}>{c.fieldIsDefault}</Text>
      </View>

      <View style={s.formActions}>
        <TouchableOpacity onPress={cancel} disabled={saving} style={s.secondaryBtn}>
          <Text style={s.secondaryBtnText}>{c.cancel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSave} disabled={saving} style={s.primaryBtn}>
          <Text style={s.primaryBtnText}>{saving ? c.saving : c.save}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── Counterparty form ─────────────────────────────────────────────────────

const CounterpartyForm: React.FC<{
  agencyOrganizationId: string;
  cpKind: ManualBillingCounterpartyKind;
  existing: ManualBillingCounterpartyRow | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}> = ({ agencyOrganizationId, cpKind, existing, onCancel, onSaved }) => {
  const c = uiCopy.manualBilling;
  const [draft, setDraft] = useState<ManualBillingCounterpartyInput>({
    kind: cpKind,
    legal_name: existing?.legal_name ?? '',
    display_name: existing?.display_name ?? null,
    address_line_1: existing?.address_line_1 ?? null,
    address_line_2: existing?.address_line_2 ?? null,
    city: existing?.city ?? null,
    postal_code: existing?.postal_code ?? null,
    state: existing?.state ?? null,
    country_code: existing?.country_code ?? null,
    vat_number: existing?.vat_number ?? null,
    tax_number: existing?.tax_number ?? null,
    company_registration_number: existing?.company_registration_number ?? null,
    contact_person: existing?.contact_person ?? null,
    billing_email: existing?.billing_email ?? null,
    phone: existing?.phone ?? null,
    po_number: existing?.po_number ?? null,
    ap_contact: existing?.ap_contact ?? null,
    bank_name: existing?.bank_name ?? null,
    iban: existing?.iban ?? null,
    bic: existing?.bic ?? null,
    account_holder: existing?.account_holder ?? null,
    default_currency: existing?.default_currency ?? 'EUR',
    default_payment_terms_days: existing?.default_payment_terms_days ?? 14,
    default_vat_treatment: existing?.default_vat_treatment ?? null,
    default_invoice_note: existing?.default_invoice_note ?? null,
    default_service_charge_pct: existing?.default_service_charge_pct ?? null,
    default_expenses_reimbursed: existing?.default_expenses_reimbursed ?? false,
    default_travel_separate: existing?.default_travel_separate ?? false,
    default_agency_fee_separate: existing?.default_agency_fee_separate ?? false,
    notes: existing?.notes ?? null,
    is_archived: existing?.is_archived ?? false,
  });
  const dirtyRef = useRef(false);
  const set = <K extends keyof ManualBillingCounterpartyInput>(
    key: K,
    value: ManualBillingCounterpartyInput[K],
  ) => {
    dirtyRef.current = true;
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const [saving, setSaving] = useState(false);
  const onSave = async () => {
    if (!draft.legal_name?.trim()) {
      showAppAlert(c.saveFailedLegalName);
      return;
    }
    setSaving(true);
    try {
      const res = await upsertManualBillingCounterparty(
        agencyOrganizationId,
        draft,
        existing?.id ?? null,
      );
      if (!res.ok) {
        showAppAlert(c.saveFailedGeneric);
        return;
      }
      dirtyRef.current = false;
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (!dirtyRef.current) {
      onCancel();
      return;
    }
    showConfirmAlert(c.unsavedChangesTitle, c.unsavedChangesBody, onCancel, c.cancel);
  };

  return (
    <View style={s.formCard}>
      <SectionTitle text="Identity" />
      <Field
        label={c.fieldLegalName}
        hint={c.fieldLegalNameHint}
        value={draft.legal_name}
        onChangeText={(v) => set('legal_name', v)}
      />
      <Field
        label={c.fieldDisplayName}
        value={draft.display_name ?? ''}
        onChangeText={(v) => set('display_name', v || null)}
      />

      <SectionTitle text="Address" />
      <Field
        label={c.fieldAddressLine1}
        value={draft.address_line_1 ?? ''}
        onChangeText={(v) => set('address_line_1', v || null)}
      />
      <Field
        label={c.fieldAddressLine2}
        value={draft.address_line_2 ?? ''}
        onChangeText={(v) => set('address_line_2', v || null)}
      />
      <Row>
        <FieldHalf
          label={c.fieldPostalCode}
          value={draft.postal_code ?? ''}
          onChangeText={(v) => set('postal_code', v || null)}
        />
        <FieldHalf
          label={c.fieldCity}
          value={draft.city ?? ''}
          onChangeText={(v) => set('city', v || null)}
        />
      </Row>
      <Row>
        <FieldHalf
          label={c.fieldState}
          value={draft.state ?? ''}
          onChangeText={(v) => set('state', v || null)}
        />
        <FieldHalf
          label={c.fieldCountryCode}
          hint={c.fieldCountryCodeHint}
          value={draft.country_code ?? ''}
          onChangeText={(v) => set('country_code', v ? v.toUpperCase().slice(0, 2) : null)}
          autoCapitalize="characters"
        />
      </Row>

      <SectionTitle text="Tax IDs" />
      <Row>
        <FieldHalf
          label={c.fieldVatNumber}
          value={draft.vat_number ?? ''}
          onChangeText={(v) => set('vat_number', v || null)}
        />
        <FieldHalf
          label={c.fieldTaxNumber}
          value={draft.tax_number ?? ''}
          onChangeText={(v) => set('tax_number', v || null)}
        />
      </Row>
      <Field
        label={c.fieldCompanyRegistration}
        value={draft.company_registration_number ?? ''}
        onChangeText={(v) => set('company_registration_number', v || null)}
      />

      <SectionTitle text="Contact / billing" />
      <Field
        label={c.fieldContactPerson}
        value={draft.contact_person ?? ''}
        onChangeText={(v) => set('contact_person', v || null)}
      />
      <Row>
        <FieldHalf
          label={c.fieldBillingEmail}
          value={draft.billing_email ?? ''}
          onChangeText={(v) => set('billing_email', v || null)}
          autoCapitalize="none"
        />
        <FieldHalf
          label={c.fieldPhone}
          value={draft.phone ?? ''}
          onChangeText={(v) => set('phone', v || null)}
        />
      </Row>
      <Row>
        <FieldHalf
          label={c.fieldPoNumber}
          value={draft.po_number ?? ''}
          onChangeText={(v) => set('po_number', v || null)}
        />
        <FieldHalf
          label={c.fieldApContact}
          value={draft.ap_contact ?? ''}
          onChangeText={(v) => set('ap_contact', v || null)}
        />
      </Row>

      {cpKind === 'model' && (
        <>
          <SectionTitle text="Model bank details (optional)" />
          <Field
            label={c.fieldAccountHolder}
            value={draft.account_holder ?? ''}
            onChangeText={(v) => set('account_holder', v || null)}
          />
          <Field
            label={c.fieldBankName}
            value={draft.bank_name ?? ''}
            onChangeText={(v) => set('bank_name', v || null)}
          />
          <Row>
            <FieldHalf
              label={c.fieldIban}
              value={draft.iban ?? ''}
              onChangeText={(v) => set('iban', v || null)}
              autoCapitalize="characters"
            />
            <FieldHalf
              label={c.fieldBic}
              value={draft.bic ?? ''}
              onChangeText={(v) => set('bic', v || null)}
              autoCapitalize="characters"
            />
          </Row>
        </>
      )}

      <SectionTitle text="Defaults" />
      <Row>
        <FieldHalf
          label={c.fieldDefaultCurrency}
          value={draft.default_currency ?? 'EUR'}
          onChangeText={(v) => set('default_currency', (v || 'EUR').toUpperCase())}
          autoCapitalize="characters"
        />
        <FieldHalf
          label={c.fieldDefaultPaymentTerms}
          value={String(draft.default_payment_terms_days ?? 14)}
          onChangeText={(v) =>
            set(
              'default_payment_terms_days',
              Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 14,
            )
          }
          keyboardType="number-pad"
        />
      </Row>
      <VatTreatmentPicker
        value={draft.default_vat_treatment ?? null}
        onChange={(v) => set('default_vat_treatment', v)}
      />
      <Field
        label={c.fieldDefaultInvoiceNote}
        multiline
        value={draft.default_invoice_note ?? ''}
        onChangeText={(v) => set('default_invoice_note', v || null)}
      />
      {cpKind === 'client' && (
        <>
          <Row>
            <FieldHalf
              label={c.fieldDefaultServiceChargePct}
              value={
                draft.default_service_charge_pct == null
                  ? ''
                  : String(draft.default_service_charge_pct)
              }
              onChangeText={(v) => {
                const n = parseFloat(v);
                set('default_service_charge_pct', Number.isFinite(n) ? n : null);
              }}
              keyboardType="decimal-pad"
            />
            <View style={{ flex: 1 }} />
          </Row>
          <View style={s.toggleRow}>
            <Switch
              value={!!draft.default_expenses_reimbursed}
              onValueChange={(v) => set('default_expenses_reimbursed', v)}
              trackColor={{ false: colors.border, true: colors.textPrimary }}
            />
            <Text style={s.toggleLabel}>{c.fieldExpensesReimbursed}</Text>
          </View>
          <View style={s.toggleRow}>
            <Switch
              value={!!draft.default_travel_separate}
              onValueChange={(v) => set('default_travel_separate', v)}
              trackColor={{ false: colors.border, true: colors.textPrimary }}
            />
            <Text style={s.toggleLabel}>{c.fieldTravelSeparate}</Text>
          </View>
          <View style={s.toggleRow}>
            <Switch
              value={!!draft.default_agency_fee_separate}
              onValueChange={(v) => set('default_agency_fee_separate', v)}
              trackColor={{ false: colors.border, true: colors.textPrimary }}
            />
            <Text style={s.toggleLabel}>{c.fieldAgencyFeeSeparate}</Text>
          </View>
        </>
      )}

      <Field
        label={c.fieldNotes}
        multiline
        value={draft.notes ?? ''}
        onChangeText={(v) => set('notes', v || null)}
      />

      <View style={s.formActions}>
        <TouchableOpacity onPress={cancel} disabled={saving} style={s.secondaryBtn}>
          <Text style={s.secondaryBtnText}>{c.cancel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSave} disabled={saving} style={s.primaryBtn}>
          <Text style={s.primaryBtnText}>{saving ? c.saving : c.save}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── Reusable form bits ────────────────────────────────────────────────────

const SectionTitle: React.FC<{ text: string }> = ({ text }) => (
  <Text style={s.sectionTitle}>{text}</Text>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  hint?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'characters' | 'words';
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'email-address';
}> = ({ label, value, onChangeText, hint, multiline, autoCapitalize, keyboardType }) => (
  <View style={s.fieldBlock}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      style={[s.input, multiline && s.inputMultiline]}
      value={value}
      onChangeText={onChangeText}
      placeholderTextColor={colors.textSecondary}
      multiline={multiline}
      autoCapitalize={autoCapitalize ?? 'sentences'}
      keyboardType={keyboardType ?? 'default'}
    />
    {hint && <Text style={s.fieldHint}>{hint}</Text>}
  </View>
);

const FieldHalf: React.FC<React.ComponentProps<typeof Field>> = (props) => (
  <View style={{ flex: 1 }}>
    <Field {...props} />
  </View>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={s.row}>{children}</View>
);

const VatTreatmentPicker: React.FC<{
  value: string | null;
  onChange: (v: string | null) => void;
}> = ({ value, onChange }) => {
  const c = uiCopy.manualBilling;
  const opts: Array<{ value: string | null; label: string }> = [
    { value: null, label: '—' },
    { value: 'domestic', label: c.fieldVatTreatmentDomestic },
    { value: 'reverse_charge', label: c.fieldVatTreatmentReverseCharge },
    { value: 'zero_rated', label: c.fieldVatTreatmentZeroRated },
    { value: 'exempt', label: c.fieldVatTreatmentExempt },
    { value: 'out_of_scope', label: c.fieldVatTreatmentOutOfScope },
    { value: 'custom', label: c.fieldVatTreatmentCustom },
  ];
  return (
    <View style={s.fieldBlock}>
      <Text style={s.fieldLabel}>{c.fieldDefaultVatTreatment}</Text>
      <View style={s.pillRow}>
        {opts.map((o) => {
          const active = (value ?? null) === o.value;
          return (
            <TouchableOpacity
              key={o.label}
              onPress={() => onChange(o.value)}
              style={[s.optionPill, active && s.optionPillActive]}
            >
              <Text style={[s.optionPillText, active && s.optionPillTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

// ── styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  listScroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  formScroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },

  screenHeader: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  backBtn: { marginBottom: spacing.xs },
  backBtnText: { ...typography.body, color: colors.textSecondary },
  screenTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  screenSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  tabBar: { flexDirection: 'row', marginBottom: spacing.sm, flexWrap: 'wrap' },
  tabPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  tabPillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  tabLabel: { ...typography.body, color: colors.textPrimary },
  tabLabelActive: { color: colors.background, fontWeight: '600' as const },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minWidth: 200,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    ...typography.body,
  },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  archiveLabel: { ...typography.body, color: colors.textSecondary },

  primaryBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  primaryBtnText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600' as const,
  },
  secondaryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  secondaryBtnText: { ...typography.body, color: colors.textPrimary },

  loadingBlock: { paddingVertical: spacing.lg, alignItems: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: {
    ...typography.body,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    flexShrink: 1,
    flex: 1,
  },
  cardSub: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  cardMeta: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  linkBtn: { ...typography.body, color: colors.textPrimary, fontWeight: '600' as const },

  badgeRow: { flexDirection: 'row', gap: 6, marginLeft: spacing.xs },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { ...typography.label, fontSize: 10 },

  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  formCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  fieldBlock: { marginBottom: spacing.sm },
  fieldLabel: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: 4,
    fontWeight: '500' as const,
  },
  fieldHint: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    ...typography.body,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm },

  toggleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  toggleLabel: { ...typography.body, marginLeft: spacing.sm, color: colors.textPrimary },

  formActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionPillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  optionPillText: { ...typography.body, color: colors.textPrimary },
  optionPillTextActive: { color: colors.background, fontWeight: '600' as const },
});

export default ManualBillingProfilesPanel;
