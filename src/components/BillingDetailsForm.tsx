/**
 * B2B billing preparation (addresses + invoice defaults).
 *
 * Permissions (Phase A/B 2026-11-20):
 * - Owner: full read + write (create/edit/delete profiles, edit defaults)
 * - Booker / Employee: read-only view (transparency for accounting/operations
 *   workflows). Inputs disabled, write actions hidden, read-only banner shown.
 * - Model / non-org users: nothing rendered (parent should not mount this).
 *
 * Profiles + defaults remain owner-only for legal/accounting safety; this is
 * intentional and aligned with `organization_billing_profiles` /
 * `organization_billing_defaults` RLS (owner-write, member-read).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { isOrganizationOwner, isOrganizationOperationalMember } from '../services/orgRoleTypes';
import { useAuth } from '../context/AuthContext';
import {
  deleteOrganizationBillingProfile,
  getOrganizationBillingDefaults,
  listOrganizationBillingProfiles,
  upsertOrganizationBillingDefaults,
  upsertOrganizationBillingProfile,
} from '../services/billingProfilesSupabase';
import type { OrganizationBillingProfileRow } from '../types/billingTypes';
import { showAppAlert, showConfirmAlert } from '../utils/crossPlatformAlert';

type Props = {
  organizationId: string | null;
};

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function str(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '';
  return String(v);
}

export const BillingDetailsForm: React.FC<Props> = ({ organizationId }) => {
  const { profile } = useAuth();
  const bs = uiCopy.billingSettings;

  const isOwner = isOrganizationOwner(profile?.org_member_role);
  // Operational members (Booker/Employee) get a read-only view; non-members
  // get nothing rendered. RLS enforces the same boundaries server-side
  // (organization_billing_profiles + organization_billing_defaults are
  // owner-write, member-read).
  const isMember = isOrganizationOperationalMember(profile?.org_member_role);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profiles, setProfiles] = useState<OrganizationBillingProfileRow[]>([]);

  const [label, setLabel] = useState('');
  const [billingName, setBillingName] = useState('');
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [stateReg, setStateReg] = useState('');
  const [country, setCountry] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [vatId, setVatId] = useState('');
  const [taxId, setTaxId] = useState('');
  const [iban, setIban] = useState('');
  const [bic, setBic] = useState('');
  const [bankName, setBankName] = useState('');
  const [primaryId, setPrimaryId] = useState<string | null>(null);

  const [commission, setCommission] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [payDays, setPayDays] = useState('30');
  const [invPrefix, setInvPrefix] = useState('');
  const [notesTpl, setNotesTpl] = useState('');
  const [reverseCharge, setReverseCharge] = useState(false);

  const primaryRow = useMemo(
    () => profiles.find((p) => p.is_default) ?? profiles[0] ?? null,
    [profiles],
  );

  const extraProfiles = useMemo(
    () => profiles.filter((p) => primaryRow && p.id !== primaryRow.id),
    [profiles, primaryRow],
  );

  const hydrateFromPrimary = useCallback((row: OrganizationBillingProfileRow | null) => {
    if (!row) {
      setPrimaryId(null);
      setLabel('');
      setBillingName('');
      setAddr1('');
      setAddr2('');
      setCity('');
      setPostal('');
      setStateReg('');
      setCountry('');
      setBillingEmail('');
      setVatId('');
      setTaxId('');
      setIban('');
      setBic('');
      setBankName('');
      return;
    }
    setPrimaryId(row.id);
    setLabel(row.label ?? '');
    setBillingName(row.billing_name ?? '');
    setAddr1(row.billing_address_1 ?? '');
    setAddr2(row.billing_address_2 ?? '');
    setCity(row.billing_city ?? '');
    setPostal(row.billing_postal_code ?? '');
    setStateReg(row.billing_state ?? '');
    setCountry(row.billing_country ?? '');
    setBillingEmail(row.billing_email ?? '');
    setVatId(row.vat_id ?? '');
    setTaxId(row.tax_id ?? '');
    setIban(row.iban ?? '');
    setBic(row.bic ?? '');
    setBankName(row.bank_name ?? '');
  }, []);

  const load = useCallback(async () => {
    // Members (incl. Owner) can read; non-members return early.
    if (!organizationId || !isMember) return;
    setLoading(true);
    try {
      const [plist, defs] = await Promise.all([
        listOrganizationBillingProfiles(organizationId),
        getOrganizationBillingDefaults(organizationId),
      ]);
      setProfiles(plist);
      const def = plist.find((p) => p.is_default) ?? plist[0] ?? null;
      hydrateFromPrimary(def);
      if (defs) {
        setCommission(str(defs.default_commission_rate));
        setTaxRate(str(defs.default_tax_rate));
        setCurrency(defs.default_currency || 'EUR');
        setPayDays(String(defs.default_payment_terms_days ?? 30));
        setInvPrefix(defs.invoice_number_prefix ?? '');
        setNotesTpl(defs.invoice_notes_template ?? '');
        setReverseCharge(defs.reverse_charge_eligible ?? false);
      } else {
        setCommission('');
        setTaxRate('');
        setCurrency('EUR');
        setPayDays('30');
        setInvPrefix('');
        setNotesTpl('');
        setReverseCharge(false);
      }
    } catch (e) {
      console.error('[BillingDetailsForm] load', e);
      showAppAlert(uiCopy.common.error, bs.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [organizationId, isMember, hydrateFromPrimary, bs.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = useCallback(async () => {
    if (!organizationId || !isOwner) return;
    setSaving(true);
    try {
      const okProfile = await upsertOrganizationBillingProfile(
        organizationId,
        {
          label: label.trim() || null,
          billing_name: billingName.trim() || null,
          billing_address_1: addr1.trim() || null,
          billing_address_2: addr2.trim() || null,
          billing_city: city.trim() || null,
          billing_postal_code: postal.trim() || null,
          billing_state: stateReg.trim() || null,
          billing_country: country.trim() || null,
          billing_email: billingEmail.trim() || null,
          vat_id: vatId.trim() || null,
          tax_id: taxId.trim() || null,
          iban: iban.trim() || null,
          bic: bic.trim() || null,
          bank_name: bankName.trim() || null,
          is_default: true,
        },
        primaryId,
      );

      const pd = parseInt(payDays.trim(), 10);
      const okDef = await upsertOrganizationBillingDefaults(organizationId, {
        default_commission_rate: numOrNull(commission),
        default_tax_rate: numOrNull(taxRate),
        default_currency: currency.trim() || 'EUR',
        default_payment_terms_days: Number.isFinite(pd) ? pd : 30,
        invoice_number_prefix: invPrefix.trim() || null,
        invoice_notes_template: notesTpl.trim() || null,
        reverse_charge_eligible: reverseCharge,
      });

      if (okProfile && okDef) {
        showAppAlert(uiCopy.common.success, bs.saveSuccess);
        await load();
      } else {
        showAppAlert(uiCopy.common.error, bs.saveFailed);
      }
    } finally {
      setSaving(false);
    }
  }, [
    organizationId,
    isOwner,
    primaryId,
    label,
    billingName,
    addr1,
    addr2,
    city,
    postal,
    stateReg,
    country,
    billingEmail,
    vatId,
    taxId,
    iban,
    bic,
    bankName,
    commission,
    taxRate,
    currency,
    payDays,
    invPrefix,
    notesTpl,
    reverseCharge,
    load,
    bs.saveSuccess,
    bs.saveFailed,
  ]);

  const onAddAddress = useCallback(async () => {
    if (!organizationId || !isOwner) return;
    setSaving(true);
    try {
      const ok = await upsertOrganizationBillingProfile(
        organizationId,
        {
          label: 'Additional',
          is_default: false,
        },
        null,
      );
      if (ok) await load();
      else showAppAlert(uiCopy.common.error, bs.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [organizationId, isOwner, load, bs.saveFailed]);

  const onDelete = useCallback(
    (row: OrganizationBillingProfileRow) => {
      if (!organizationId) return;
      const run = async () => {
        setSaving(true);
        try {
          const ok = await deleteOrganizationBillingProfile(organizationId, row.id);
          if (ok) await load();
          else showAppAlert(uiCopy.common.error, bs.saveFailed);
        } finally {
          setSaving(false);
        }
      };
      showConfirmAlert(
        bs.deleteConfirmTitle,
        bs.deleteConfirmMessage,
        () => void run(),
        bs.deleteAddress,
      );
    },
    [organizationId, load, bs],
  );

  // Non-members (e.g. Models) get nothing — keep the workspace firewall intact.
  // Members (Owner/Booker/Employee) see the form; Owner can edit, others see
  // a read-only view.
  if (!organizationId || !isMember) {
    return null;
  }

  if (loading) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{bs.cardTitle}</Text>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{bs.cardTitle}</Text>
      <Text style={styles.intro}>{bs.intro}</Text>

      {!isOwner && (
        <View style={styles.readOnlyBanner}>
          <Text style={styles.readOnlyBannerText}>{bs.readOnlyHint}</Text>
        </View>
      )}

      <Text style={styles.section}>{bs.sectionAddresses}</Text>
      {primaryRow?.is_default && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{bs.primaryBadge}</Text>
        </View>
      )}

      <Text style={styles.label}>{bs.fieldLabel}</Text>
      <TextInput
        editable={isOwner}
        value={label}
        onChangeText={setLabel}
        placeholder={bs.fieldLabelPlaceholder}
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldBillingName}</Text>
      <TextInput
        editable={isOwner}
        value={billingName}
        onChangeText={setBillingName}
        placeholder={bs.fieldBillingNamePlaceholder}
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldAddress1}</Text>
      <TextInput editable={isOwner} value={addr1} onChangeText={setAddr1} style={styles.input} />
      <Text style={styles.label}>{bs.fieldAddress2}</Text>
      <TextInput editable={isOwner} value={addr2} onChangeText={setAddr2} style={styles.input} />
      <Text style={styles.label}>{bs.fieldCity}</Text>
      <TextInput editable={isOwner} value={city} onChangeText={setCity} style={styles.input} />
      <Text style={styles.label}>{bs.fieldPostalCode}</Text>
      <TextInput editable={isOwner} value={postal} onChangeText={setPostal} style={styles.input} />
      <Text style={styles.label}>{bs.fieldState}</Text>
      <TextInput
        editable={isOwner}
        value={stateReg}
        onChangeText={setStateReg}
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldCountry}</Text>
      <TextInput
        editable={isOwner}
        value={country}
        onChangeText={setCountry}
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldBillingEmail}</Text>
      <TextInput
        editable={isOwner}
        value={billingEmail}
        onChangeText={setBillingEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldVatId}</Text>
      <TextInput
        editable={isOwner}
        value={vatId}
        onChangeText={setVatId}
        style={styles.input}
        autoCapitalize="characters"
      />
      <Text style={styles.label}>{bs.fieldTaxId}</Text>
      <TextInput editable={isOwner} value={taxId} onChangeText={setTaxId} style={styles.input} />
      <Text style={styles.label}>{bs.fieldIban}</Text>
      <TextInput
        editable={isOwner}
        value={iban}
        onChangeText={setIban}
        style={styles.input}
        autoCapitalize="characters"
      />
      <Text style={styles.label}>{bs.fieldBic}</Text>
      <TextInput
        editable={isOwner}
        value={bic}
        onChangeText={setBic}
        style={styles.input}
        autoCapitalize="characters"
      />
      <Text style={styles.label}>{bs.fieldBankName}</Text>
      <TextInput
        editable={isOwner}
        value={bankName}
        onChangeText={setBankName}
        style={styles.input}
      />

      {extraProfiles.length > 0 && (
        <>
          <Text style={[styles.section, styles.gapTop]}>{bs.additionalIdentities}</Text>
          {extraProfiles.map((p) => (
            <View key={p.id} style={styles.extraRow}>
              <Text style={styles.extraText} numberOfLines={2}>
                {p.label || p.billing_name || p.billing_city || p.id}
              </Text>
              {isOwner && (
                <TouchableOpacity onPress={() => onDelete(p)} disabled={saving}>
                  <Text style={styles.deleteLink}>{bs.deleteAddress}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </>
      )}

      {isOwner && (
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => void onAddAddress()}
          disabled={saving}
        >
          <Text style={styles.secondaryBtnText}>{bs.addAddress}</Text>
        </TouchableOpacity>
      )}

      <Text style={[styles.section, styles.gapTop]}>{bs.sectionDefaults}</Text>
      <Text style={styles.label}>{bs.fieldCommissionRate}</Text>
      <Text style={styles.hint}>{bs.fieldCommissionHint}</Text>
      <TextInput
        editable={isOwner}
        value={commission}
        onChangeText={setCommission}
        keyboardType="decimal-pad"
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldTaxRate}</Text>
      <Text style={styles.hint}>{bs.fieldTaxHint}</Text>
      <TextInput
        editable={isOwner}
        value={taxRate}
        onChangeText={setTaxRate}
        keyboardType="decimal-pad"
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldCurrency}</Text>
      <TextInput
        editable={isOwner}
        value={currency}
        onChangeText={setCurrency}
        autoCapitalize="characters"
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldPaymentTerms}</Text>
      <TextInput
        editable={isOwner}
        value={payDays}
        onChangeText={setPayDays}
        keyboardType="number-pad"
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldInvoicePrefix}</Text>
      <TextInput
        editable={isOwner}
        value={invPrefix}
        onChangeText={setInvPrefix}
        placeholder={bs.fieldInvoicePrefixPlaceholder}
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      <Text style={styles.label}>{bs.fieldNotesTemplate}</Text>
      <TextInput
        editable={isOwner}
        value={notesTpl}
        onChangeText={setNotesTpl}
        placeholder={bs.fieldNotesPlaceholder}
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, styles.multiline]}
        multiline
      />
      <View style={styles.switchRow}>
        <View style={styles.switchLabelWrap}>
          <Text style={styles.label}>{bs.fieldReverseCharge}</Text>
          <Text style={styles.hint}>{bs.fieldReverseChargeHint}</Text>
        </View>
        <Switch value={reverseCharge} onValueChange={setReverseCharge} disabled={!isOwner} />
      </View>

      {isOwner && (
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          disabled={saving}
          onPress={() => void onSave()}
        >
          {saving ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.saveLabel}>{bs.save}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  intro: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  section: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gapTop: { marginTop: spacing.md },
  label: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  hint: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: spacing.sm,
  },
  badgeText: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  extraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  extraText: { ...typography.body, flex: 1, color: colors.textSecondary, marginRight: spacing.sm },
  deleteLink: { ...typography.label, color: colors.error, fontSize: 13 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  secondaryBtnText: { ...typography.label, color: colors.accentGreen, fontSize: 13 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  switchLabelWrap: { flex: 1 },
  saveBtn: {
    backgroundColor: colors.buttonOptionGreen,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  saveLabel: { ...typography.label, color: colors.surface },
  readOnlyBanner: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
  },
  readOnlyBannerText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
