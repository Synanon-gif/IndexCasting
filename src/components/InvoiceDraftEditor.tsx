/**
 * InvoiceDraftEditor — Owner-only B2B invoice draft editor.
 *
 * Responsibilities:
 * - Create or edit a draft invoice (top-level fields + line items).
 * - Live recompute totals (subtotal/tax/total) per line edit.
 * - Send via Stripe (calls send-invoice-via-stripe Edge Function).
 *
 * Invariants:
 * - Status must remain 'draft' to allow edits (RLS enforced server-side).
 * - Owner-only writes; non-owners get a read-only view.
 * - I-PAY-1: DB invoices row is canonical truth; Stripe IDs only persisted on send.
 * - I-PAY-10: model billing firewall — never mounted in model workspace.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { isOrganizationOperationalMember } from '../services/orgRoleTypes';
import { useAuth } from '../context/AuthContext';
import {
  addInvoiceLineItem,
  createInvoiceDraft,
  deleteInvoiceLineItem,
  getInvoiceWithLines,
  recomputeInvoiceTotals,
  sendInvoiceViaEmail,
  sendInvoiceViaStripe,
  updateInvoiceDraft,
  updateInvoiceLineItem,
} from '../services/invoicesSupabase';
import {
  listClientOrganizationsForAgencyDirectory,
  type ClientOrganizationDirectoryRow,
} from '../services/clientOrganizationsDirectorySupabase';
import { listAgencyOrganizationsForAgencyDirectory } from '../services/agencyOrganizationsDirectorySupabase';
import { getOrganizationBillingDefaults } from '../services/billingProfilesSupabase';
import {
  getDefaultPresetForClient,
  listAgencyClientBillingPresets,
} from '../services/agencyClientBillingPresetsSupabase';
import { showAppAlert, showConfirmAlert } from '../utils/crossPlatformAlert';
import type {
  AgencyClientBillingPresetRow,
  InvoiceLineItemRow,
  InvoiceType,
  InvoiceWithLines,
} from '../types/billingTypes';

type Props = {
  organizationId: string;
  /** null = create new draft; string = edit existing draft */
  invoiceId: string | null;
  onClose: () => void;
};

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function centsFromInput(s: string): number {
  const n = Number(s.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * Phase E (2026-04-19): Same lightweight RFC-5322-ish check used by the
 * `send-invoice-via-email` Edge Function — keep them in sync. Both reject
 * obvious nonsense and protect against accidental whitespace; the actual
 * deliverability check happens at Resend.
 */
function isValidEmailAddress(s: string): boolean {
  const t = s.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function inputFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return '0';
  return (cents / 100).toFixed(2);
}

function formatCents(cents: number, currency: string): string {
  const amount = (cents ?? 0) / 100;
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

export const InvoiceDraftEditor: React.FC<Props> = ({ organizationId, invoiceId, onClose }) => {
  const { profile } = useAuth();
  const inv = uiCopy.invoices;
  // Phase A (2026-11-20): Drafts editieren + senden ist für Owner UND Booker/Employee.
  // Owner-only Aktionen (Delete Draft, Void) werden in InvoicesPanel separat geguarded.
  const isMember = isOrganizationOperationalMember(profile?.org_member_role);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [data, setData] = useState<InvoiceWithLines | null>(null);

  // Phase E (2026-04-19): Email send dialog (alternative to Stripe send).
  // The dialog opens on "Send via Email" and lets the operator override
  // recipient / cc / subject / message before dispatching. Defaults come from
  // the recipient billing snapshot — see send-invoice-via-email Edge Function
  // for resolution rules.
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  // Top-level editable fields (mirrored to DB on blur/save)
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState<string>('');
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('agency_to_client');
  const [currency, setCurrency] = useState('EUR');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [taxMode, setTaxMode] = useState<'manual' | 'stripe_tax'>('manual');
  const [reverseCharge, setReverseCharge] = useState(false);

  // Recipient picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerRows, setPickerRows] = useState<ClientOrganizationDirectoryRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Preset prefill (only relevant for new agency_to_client drafts before first save).
  const [availablePresets, setAvailablePresets] = useState<AgencyClientBillingPresetRow[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetApplied, setPresetApplied] = useState(false);

  const isDraft = data?.status === 'draft' || invoiceId === null;
  const canEdit = isMember && isDraft;
  // Preset picker only meaningful for new agency_to_client drafts (presets are agency↔client).
  const presetPickerVisible =
    canEdit && invoiceId === null && !data?.id && invoiceType === 'agency_to_client';

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const row = await getInvoiceWithLines(id);
        if (!row) {
          showAppAlert(uiCopy.common.error, inv.loadFailed);
          onClose();
          return;
        }
        setData(row);
        setRecipientId(row.recipient_organization_id);
        setRecipientName('');
        setInvoiceType(row.invoice_type);
        setCurrency(row.currency || 'EUR');
        setNotes(row.notes ?? '');
        setDueDate(row.due_date ?? '');
        setTaxRate(row.tax_rate_percent != null ? String(row.tax_rate_percent) : '');
        setTaxMode(row.tax_mode === 'stripe_tax' ? 'stripe_tax' : 'manual');
        setReverseCharge(row.reverse_charge_applied === true);
      } finally {
        setLoading(false);
      }
    },
    [inv.loadFailed, onClose],
  );

  useEffect(() => {
    if (invoiceId) {
      void load(invoiceId);
      return;
    }
    // Create flow: stub data shell (no DB row yet — created on first save).
    // Pre-populate currency, tax rate, and reverse-charge eligibility from issuer billing defaults.
    let cancelled = false;
    const initCreate = async () => {
      let initialCurrency = 'EUR';
      let initialTaxRate = '';
      let initialReverseCharge = false;
      try {
        const defaults = await getOrganizationBillingDefaults(organizationId);
        if (defaults) {
          if (defaults.default_currency) initialCurrency = defaults.default_currency;
          if (defaults.default_tax_rate != null) initialTaxRate = String(defaults.default_tax_rate);
          if (defaults.reverse_charge_eligible === true) initialReverseCharge = true;
        }
      } catch (e) {
        console.warn('[InvoiceDraftEditor] billing defaults load failed (non-fatal):', e);
      }
      if (cancelled) return;
      setCurrency(initialCurrency);
      setTaxRate(initialTaxRate);
      setReverseCharge(initialReverseCharge);
      setData({
        id: '',
        organization_id: organizationId,
        recipient_organization_id: null,
        invoice_type: 'agency_to_client',
        status: 'draft',
        invoice_number: null,
        source_option_request_id: null,
        period_start: null,
        period_end: null,
        payment_provider: 'stripe',
        payment_provider_metadata: {},
        stripe_invoice_id: null,
        stripe_hosted_url: null,
        stripe_pdf_url: null,
        stripe_payment_intent_id: null,
        billing_profile_snapshot: null,
        recipient_billing_snapshot: null,
        currency: initialCurrency,
        subtotal_amount_cents: 0,
        tax_amount_cents: 0,
        total_amount_cents: 0,
        tax_rate_percent: initialTaxRate ? Number(initialTaxRate) : null,
        tax_mode: 'manual',
        reverse_charge_applied: initialReverseCharge,
        notes: null,
        due_date: null,
        sent_at: null,
        paid_at: null,
        // Phase C.3 (20261123) — Stripe failure tracking columns. New drafts
        // start clean; webhook populates them only after a real payment_failed
        // event from Stripe.
        last_stripe_failure_at: null,
        last_stripe_failure_reason: null,
        created_by: null,
        sent_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        line_items: [],
      });
      setLoading(false);
    };
    void initCreate();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, organizationId, load]);

  // Recipient picker search — invoice_type drives which directory we query.
  // agency_to_client → client orgs (existing picker)
  // agency_to_agency → other agency orgs (Phase B.1, 2026-11-21)
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    const run = async () => {
      setPickerLoading(true);
      try {
        const rows =
          invoiceType === 'agency_to_agency'
            ? await listAgencyOrganizationsForAgencyDirectory(organizationId, pickerQuery)
            : await listClientOrganizationsForAgencyDirectory(organizationId, pickerQuery);
        if (!cancelled) setPickerRows(rows);
      } finally {
        if (!cancelled) setPickerLoading(false);
      }
    };
    const t = setTimeout(() => void run(), 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pickerOpen, pickerQuery, organizationId, invoiceType]);

  /**
   * Apply a preset's defaults to the local form state.
   * Only used in CREATE mode before the draft has been persisted.
   * Does NOT touch the DB — the preset id is sent on createInvoiceDraft so the
   * server-side prefill (incl. line items + recipient_billing_snapshot) takes effect.
   */
  const applyPresetLocal = useCallback((preset: AgencyClientBillingPresetRow | null) => {
    if (!preset) {
      setPresetApplied(false);
      return;
    }
    if (preset.default_currency) setCurrency(preset.default_currency);
    if (preset.default_tax_rate_percent != null) {
      setTaxRate(String(preset.default_tax_rate_percent));
    }
    setTaxMode(preset.default_tax_mode ?? 'manual');
    setReverseCharge(preset.default_reverse_charge === true);
    if (preset.default_notes) setNotes(preset.default_notes);
    // Compute due date from terms (best-effort, can be edited).
    const terms = preset.default_payment_terms_days ?? 30;
    if (Number.isFinite(terms) && terms > 0) {
      const due = new Date(Date.now() + terms * 24 * 60 * 60 * 1000);
      setDueDate(due.toISOString().slice(0, 10));
    }
    setPresetApplied(true);
  }, []);

  /**
   * When the recipient changes (CREATE mode, agency_to_client), load presets and
   * auto-apply the default preset locally so the user immediately sees prefilled
   * fields. The preset id is also persisted on first save (createInvoiceDraft).
   */
  useEffect(() => {
    if (!presetPickerVisible || !recipientId) {
      setAvailablePresets([]);
      setSelectedPresetId(null);
      setPresetApplied(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const [list, def] = await Promise.all([
        listAgencyClientBillingPresets(organizationId, {
          clientOrganizationId: recipientId,
          limit: 100,
        }),
        getDefaultPresetForClient(organizationId, recipientId),
      ]);
      if (cancelled) return;
      setAvailablePresets(list);
      if (def && !selectedPresetId) {
        setSelectedPresetId(def.id);
        applyPresetLocal(def);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // selectedPresetId intentionally omitted: only auto-apply default once per recipient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, recipientId, presetPickerVisible, applyPresetLocal]);

  const ensurePersisted = useCallback(async (): Promise<string | null> => {
    if (data?.id) return data.id;
    // Create draft row first. Pass presetId so the server-side prefill can apply
    // recipient_billing_snapshot + starter line items + tax/currency defaults.
    // Explicit values from this form ALWAYS override preset values (handled in service).
    const newId = await createInvoiceDraft(organizationId, {
      invoice_type: invoiceType,
      recipient_organization_id: recipientId,
      currency: currency.trim() || 'EUR',
      notes: notes.trim() || null,
      due_date: dueDate.trim() || null,
      tax_rate_percent: numOrNull(taxRate),
      tax_mode: taxMode,
      reverse_charge_applied: reverseCharge,
      presetId: invoiceType === 'agency_to_client' ? selectedPresetId : null,
    });
    if (!newId) {
      showAppAlert(uiCopy.common.error, inv.saveFailed);
      return null;
    }
    await load(newId);
    return newId;
  }, [
    data?.id,
    organizationId,
    invoiceType,
    recipientId,
    currency,
    notes,
    dueDate,
    taxRate,
    taxMode,
    reverseCharge,
    selectedPresetId,
    load,
    inv.saveFailed,
  ]);

  const onSaveTopLevel = useCallback(async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const id = await ensurePersisted();
      if (!id) return;
      const ok = await updateInvoiceDraft(id, {
        notes: notes.trim() || null,
        due_date: dueDate.trim() || null,
        currency: currency.trim() || 'EUR',
        tax_rate_percent: numOrNull(taxRate),
        tax_mode: taxMode,
        reverse_charge_applied: reverseCharge,
        recipient_organization_id: recipientId,
      });
      if (ok) {
        await recomputeInvoiceTotals(id);
        await load(id);
        showAppAlert(uiCopy.common.success, inv.saveSuccess);
      } else {
        showAppAlert(uiCopy.common.error, inv.saveFailed);
      }
    } finally {
      setSaving(false);
    }
  }, [
    canEdit,
    ensurePersisted,
    notes,
    dueDate,
    currency,
    taxRate,
    taxMode,
    reverseCharge,
    recipientId,
    load,
    inv,
  ]);

  const onAddLine = useCallback(async () => {
    if (!canEdit) return;
    const id = await ensurePersisted();
    if (!id) return;
    const ok = await addInvoiceLineItem(id, {
      description: 'New line item',
      quantity: 1,
      unit_amount_cents: 0,
      currency: currency.trim() || 'EUR',
      position: data?.line_items.length ?? 0,
    });
    if (ok) {
      await load(id);
    } else {
      showAppAlert(uiCopy.common.error, inv.saveFailed);
    }
  }, [canEdit, ensurePersisted, currency, data?.line_items.length, load, inv.saveFailed]);

  const onUpdateLine = useCallback(
    async (
      line: InvoiceLineItemRow,
      patch: Partial<{
        description: string;
        quantity: number;
        unit_amount_cents: number;
      }>,
    ) => {
      if (!canEdit || !data?.id) return;
      const ok = await updateInvoiceLineItem(line.id, data.id, patch);
      if (ok) {
        await load(data.id);
      } else {
        showAppAlert(uiCopy.common.error, inv.saveFailed);
      }
    },
    [canEdit, data?.id, load, inv.saveFailed],
  );

  const onRemoveLine = useCallback(
    (line: InvoiceLineItemRow) => {
      if (!canEdit || !data?.id) return;
      const id = data.id;
      const run = async () => {
        const ok = await deleteInvoiceLineItem(line.id, id);
        if (ok) {
          await load(id);
        } else {
          showAppAlert(uiCopy.common.error, inv.saveFailed);
        }
      };
      showConfirmAlert(
        inv.removeLine,
        inv.deleteConfirmMessage,
        () => void run(),
        uiCopy.common.delete,
      );
    },
    [canEdit, data?.id, load, inv],
  );

  const onSend = useCallback(async () => {
    if (!canEdit || !data?.id) return;
    if (!recipientId) {
      showAppAlert(uiCopy.common.error, inv.notRecipientYet);
      return;
    }
    if (!data.line_items.length) {
      showAppAlert(uiCopy.common.error, inv.noLineItemsYet);
      return;
    }
    showConfirmAlert(
      inv.sendConfirmTitle,
      inv.sendConfirmMessage,
      async () => {
        setSending(true);
        try {
          // Save latest top-level edits first.
          await updateInvoiceDraft(data.id, {
            notes: notes.trim() || null,
            due_date: dueDate.trim() || null,
            currency: currency.trim() || 'EUR',
            tax_rate_percent: numOrNull(taxRate),
            tax_mode: taxMode,
            reverse_charge_applied: reverseCharge,
            recipient_organization_id: recipientId,
          });
          await recomputeInvoiceTotals(data.id);
          const result = await sendInvoiceViaStripe(data.id);
          if (result.ok) {
            showAppAlert(uiCopy.common.success, inv.sendSuccess);
            onClose();
          } else {
            showAppAlert(uiCopy.common.error, result.error ?? inv.sendFailed);
          }
        } finally {
          setSending(false);
        }
      },
      inv.sendViaStripe,
    );
  }, [
    canEdit,
    data?.id,
    data?.line_items.length,
    recipientId,
    notes,
    dueDate,
    currency,
    taxRate,
    taxMode,
    reverseCharge,
    inv,
    onClose,
  ]);

  /**
   * Phase E (2026-04-19): Open the inline email-send form. Pre-fills the
   * recipient field from the draft's recipient_billing_snapshot when present
   * so the operator usually only needs to confirm. The actual default
   * resolution and validation happens server-side in the Edge Function — this
   * is purely UX convenience.
   */
  const onOpenEmailForm = useCallback(() => {
    if (!canEdit || !data?.id) return;
    if (!recipientId) {
      showAppAlert(uiCopy.common.error, inv.notRecipientYet);
      return;
    }
    if (!data.line_items.length) {
      showAppAlert(uiCopy.common.error, inv.noLineItemsYet);
      return;
    }
    const snapshot = data.recipient_billing_snapshot as {
      email?: unknown;
      billing_email?: unknown;
    } | null;
    const snapshotEmail =
      typeof snapshot?.billing_email === 'string'
        ? snapshot.billing_email
        : typeof snapshot?.email === 'string'
          ? snapshot.email
          : '';
    setEmailRecipient(snapshotEmail);
    setEmailCc('');
    setEmailSubject('');
    setEmailMessage('');
    setEmailFormOpen(true);
  }, [
    canEdit,
    data?.id,
    data?.line_items.length,
    data?.recipient_billing_snapshot,
    recipientId,
    inv,
  ]);

  /**
   * Phase E (2026-04-19): Dispatch the invoice via the
   * `send-invoice-via-email` Edge Function. The Edge Function performs the
   * same draft → pending_send pre-lock as the Stripe path, draws the next
   * invoice number, freezes the snapshots and sends through Resend. UI
   * validation here is a courtesy — server validates again.
   */
  const onSendEmail = useCallback(async () => {
    if (!canEdit || !data?.id) return;
    const trimmedRecipient = emailRecipient.trim();
    if (trimmedRecipient && !isValidEmailAddress(trimmedRecipient)) {
      showAppAlert(uiCopy.common.error, inv.sendEmailInvalidRecipient);
      return;
    }
    const ccList = emailCc
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ccList.some((addr) => !isValidEmailAddress(addr))) {
      showAppAlert(uiCopy.common.error, inv.sendEmailInvalidCc);
      return;
    }
    setSendingEmail(true);
    try {
      // Save latest top-level edits first — same pattern as onSend (Stripe).
      await updateInvoiceDraft(data.id, {
        notes: notes.trim() || null,
        due_date: dueDate.trim() || null,
        currency: currency.trim() || 'EUR',
        tax_rate_percent: numOrNull(taxRate),
        tax_mode: taxMode,
        reverse_charge_applied: reverseCharge,
        recipient_organization_id: recipientId,
      });
      await recomputeInvoiceTotals(data.id);
      const result = await sendInvoiceViaEmail(data.id, {
        to: trimmedRecipient || undefined,
        cc: ccList.length > 0 ? ccList : undefined,
        subject: emailSubject.trim() || undefined,
        message: emailMessage.trim() || undefined,
      });
      if (result.ok) {
        setEmailFormOpen(false);
        showAppAlert(uiCopy.common.success, inv.sendEmailSuccess);
        onClose();
      } else {
        const reason = result.error ?? inv.sendEmailFailed;
        // Surface a friendlier message for the most common operator-facing case.
        const friendly =
          reason === 'recipient_email_required'
            ? inv.sendEmailMissingRecipient
            : reason === 'recipient_email_invalid'
              ? inv.sendEmailInvalidRecipient
              : reason;
        showAppAlert(uiCopy.common.error, friendly);
      }
    } finally {
      setSendingEmail(false);
    }
  }, [
    canEdit,
    data?.id,
    emailRecipient,
    emailCc,
    emailSubject,
    emailMessage,
    notes,
    dueDate,
    currency,
    taxRate,
    taxMode,
    reverseCharge,
    recipientId,
    inv,
    onClose,
  ]);

  const totalDisplay = useMemo(() => {
    const c = currency.trim() || 'EUR';
    return {
      subtotal: formatCents(data?.subtotal_amount_cents ?? 0, c),
      tax: formatCents(data?.tax_amount_cents ?? 0, c),
      total: formatCents(data?.total_amount_cents ?? 0, c),
    };
  }, [data, currency]);

  if (loading || !data) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.backLink}>← {inv.backToList}</Text>
        </TouchableOpacity>
        <Text style={styles.invoiceNoTitle}>{data.invoice_number ?? inv.invoiceNumberPending}</Text>
      </View>

      {!canEdit && <Text style={styles.warning}>{inv.cantEditNonDraft}</Text>}

      {/* Recipient-Type toggle (Client | Agency) — only for new drafts; once
          persisted, invoice_type is locked because the snapshot/numbering
          assumes a stable recipient kind. */}
      {canEdit && invoiceId === null && !data.id && (
        <View style={styles.field}>
          <Text style={styles.label}>{inv.recipientTypeLabel}</Text>
          <View style={styles.modeToggleRow}>
            {(
              [
                ['agency_to_client', inv.recipientTypeClient],
                ['agency_to_agency', inv.recipientTypeAgency],
              ] as const
            ).map(([value, label]) => (
              <TouchableOpacity
                key={value}
                onPress={() => {
                  if (invoiceType === value) return;
                  setInvoiceType(value);
                  // Clear recipient selection — the picker queries a different
                  // directory per type (client vs other agency), so a recipient
                  // picked under the previous type is no longer valid.
                  setRecipientId('');
                  setRecipientName('');
                  setPickerRows([]);
                  setPickerQuery('');
                  // Clear preset selection if leaving client recipient type
                  // (presets are agency↔client only).
                  if (value !== 'agency_to_client') {
                    setSelectedPresetId(null);
                    setPresetApplied(false);
                  }
                }}
                style={[styles.modeChip, invoiceType === value ? styles.modeChipActive : null]}
              >
                <Text
                  style={[
                    styles.modeChipText,
                    invoiceType === value ? styles.modeChipTextActive : null,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Recipient picker */}
      <Text style={styles.label}>{inv.fieldRecipient}</Text>
      <Text style={styles.hint}>{inv.fieldRecipientHint}</Text>
      {pickerOpen ? (
        <View style={styles.pickerBox}>
          <TextInput
            value={pickerQuery}
            onChangeText={setPickerQuery}
            placeholder={inv.fieldRecipientPlaceholder}
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            autoFocus
          />
          {pickerLoading ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : pickerRows.length === 0 ? (
            <Text style={styles.hint}>—</Text>
          ) : (
            <View style={styles.pickerList}>
              {pickerRows.slice(0, 20).map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.pickerRow}
                  onPress={() => {
                    setRecipientId(r.id);
                    setRecipientName(r.name);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerName}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity onPress={() => setPickerOpen(false)}>
            <Text style={styles.linkAction}>{uiCopy.common.cancel}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.recipientRow}>
          <Text style={styles.recipientText}>{recipientName || recipientId || '—'}</Text>
          {canEdit && (
            <TouchableOpacity onPress={() => setPickerOpen(true)}>
              <Text style={styles.linkAction}>{inv.fieldRecipientPickAgain}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {presetPickerVisible && recipientId && availablePresets.length > 0 && (
        <View style={styles.presetBox}>
          <Text style={styles.label}>{inv.presetPickerLabel}</Text>
          <Text style={styles.hint}>{inv.presetPickerHint}</Text>
          <View style={styles.pickerList}>
            <TouchableOpacity
              style={[styles.presetRow, selectedPresetId === null ? styles.presetRowActive : null]}
              onPress={() => {
                setSelectedPresetId(null);
                setPresetApplied(false);
              }}
            >
              <Text style={styles.presetRowLabel}>{inv.presetPickerNone}</Text>
            </TouchableOpacity>
            {availablePresets.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.presetRow,
                  selectedPresetId === p.id ? styles.presetRowActive : null,
                ]}
                onPress={() => {
                  setSelectedPresetId(p.id);
                  applyPresetLocal(p);
                }}
              >
                <Text style={styles.presetRowLabel}>
                  {p.label || p.recipient_billing_name || '—'}
                  {p.is_default ? ' ★' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {presetApplied && <Text style={styles.presetNotice}>{inv.presetAppliedNotice}</Text>}
        </View>
      )}

      <Text style={styles.label}>{inv.fieldCurrency}</Text>
      <TextInput
        value={currency}
        onChangeText={setCurrency}
        autoCapitalize="characters"
        editable={canEdit}
        style={styles.input}
      />

      <Text style={styles.label}>{inv.fieldDueDate}</Text>
      <TextInput
        value={dueDate}
        onChangeText={setDueDate}
        placeholder={inv.fieldDueDatePlaceholder}
        placeholderTextColor={colors.textSecondary}
        editable={canEdit}
        style={styles.input}
      />

      <Text style={styles.label}>{inv.fieldTaxRate}</Text>
      <TextInput
        value={taxRate}
        onChangeText={setTaxRate}
        keyboardType="decimal-pad"
        editable={canEdit}
        style={styles.input}
      />

      <View style={styles.switchRow}>
        <View style={styles.switchLabelWrap}>
          <Text style={styles.label}>{inv.fieldReverseCharge}</Text>
          <Text style={styles.hint}>{inv.fieldReverseChargeHint}</Text>
        </View>
        <Switch value={reverseCharge} onValueChange={setReverseCharge} disabled={!canEdit} />
      </View>

      <Text style={styles.label}>{inv.fieldNotes}</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder={inv.fieldNotesPlaceholder}
        placeholderTextColor={colors.textSecondary}
        editable={canEdit}
        style={[styles.input, styles.multiline]}
        multiline
      />

      {/* Line items */}
      <Text style={[styles.section, styles.gapTop]}>{inv.sectionLineItems}</Text>
      {data.line_items.length === 0 ? (
        <Text style={styles.hint}>—</Text>
      ) : (
        data.line_items.map((line) => (
          <View key={line.id} style={styles.lineCard}>
            <Text style={styles.label}>{inv.lineDescription}</Text>
            <TextInput
              defaultValue={line.description}
              editable={canEdit}
              onEndEditing={(e) => void onUpdateLine(line, { description: e.nativeEvent.text })}
              style={styles.input}
            />
            <View style={styles.lineGrid}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{inv.lineQuantity}</Text>
                <TextInput
                  defaultValue={String(line.quantity ?? 1)}
                  keyboardType="decimal-pad"
                  editable={canEdit}
                  onEndEditing={(e) => {
                    const q = Number(e.nativeEvent.text.replace(',', '.'));
                    if (Number.isFinite(q) && q > 0) {
                      void onUpdateLine(line, { quantity: q });
                    }
                  }}
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>
                  {inv.lineUnit} ({line.currency})
                </Text>
                <TextInput
                  defaultValue={inputFromCents(line.unit_amount_cents)}
                  keyboardType="decimal-pad"
                  editable={canEdit}
                  onEndEditing={(e) =>
                    void onUpdateLine(line, {
                      unit_amount_cents: centsFromInput(e.nativeEvent.text),
                    })
                  }
                  style={styles.input}
                />
              </View>
            </View>
            <View style={styles.lineFooter}>
              <Text style={styles.lineTotalText}>
                {inv.lineTotal}: {formatCents(line.total_amount_cents, line.currency)}
              </Text>
              {canEdit && (
                <TouchableOpacity onPress={() => onRemoveLine(line)}>
                  <Text style={styles.linkDanger}>{inv.removeLine}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))
      )}

      {canEdit && (
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => void onAddLine()}>
          <Text style={styles.secondaryBtnText}>{inv.addLineItem}</Text>
        </TouchableOpacity>
      )}

      {/* Summary */}
      <View style={[styles.summaryBox, styles.gapTop]}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{inv.summarySubtotal}</Text>
          <Text style={styles.summaryValue}>{totalDisplay.subtotal}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{inv.summaryTax}</Text>
          <Text style={styles.summaryValue}>{totalDisplay.tax}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.textPrimary }]}>
            {inv.summaryTotal}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.textPrimary, fontSize: 16 }]}>
            {totalDisplay.total}
          </Text>
        </View>
        {reverseCharge && <Text style={styles.hint}>{inv.summaryReverseChargeNote}</Text>}
      </View>

      {canEdit && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            disabled={saving || sending || sendingEmail}
            onPress={() => void onSaveTopLevel()}
          >
            {saving ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.saveLabel}>{uiCopy.common.save}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sendBtn, (sending || saving || sendingEmail) && { opacity: 0.6 }]}
            disabled={sending || saving || sendingEmail}
            onPress={() => void onSend()}
          >
            {sending ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.saveLabel}>{inv.sendViaStripe}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sendBtn, (sending || saving || sendingEmail) && { opacity: 0.6 }]}
            disabled={sending || saving || sendingEmail}
            onPress={onOpenEmailForm}
          >
            <Text style={styles.saveLabel}>{inv.sendViaEmail}</Text>
          </TouchableOpacity>
        </View>
      )}

      {emailFormOpen && canEdit && (
        <View style={styles.emailFormCard}>
          <Text style={styles.emailFormTitle}>{inv.sendEmailModalTitle}</Text>
          <Text style={styles.emailFormIntro}>{inv.sendEmailModalIntro}</Text>

          <Text style={styles.label}>{inv.sendEmailRecipientLabel}</Text>
          <TextInput
            style={styles.input}
            value={emailRecipient}
            onChangeText={setEmailRecipient}
            placeholder={inv.sendEmailRecipientPlaceholder}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!sendingEmail}
          />
          <Text style={styles.hint}>{inv.sendEmailRecipientHint}</Text>

          <Text style={styles.label}>{inv.sendEmailCcLabel}</Text>
          <TextInput
            style={styles.input}
            value={emailCc}
            onChangeText={setEmailCc}
            placeholder={inv.sendEmailCcPlaceholder}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!sendingEmail}
          />

          <Text style={styles.label}>{inv.sendEmailSubjectLabel}</Text>
          <TextInput
            style={styles.input}
            value={emailSubject}
            onChangeText={setEmailSubject}
            placeholder={inv.sendEmailSubjectPlaceholder}
            placeholderTextColor={colors.textSecondary}
            editable={!sendingEmail}
          />

          <Text style={styles.label}>{inv.sendEmailMessageLabel}</Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={emailMessage}
            onChangeText={setEmailMessage}
            placeholder={inv.sendEmailMessagePlaceholder}
            placeholderTextColor={colors.textSecondary}
            multiline
            editable={!sendingEmail}
          />

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.saveBtn, sendingEmail && { opacity: 0.6 }]}
              disabled={sendingEmail}
              onPress={() => setEmailFormOpen(false)}
            >
              <Text style={styles.saveLabel}>{inv.sendEmailCancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, sendingEmail && { opacity: 0.6 }]}
              disabled={sendingEmail}
              onPress={() => void onSendEmail()}
            >
              {sendingEmail ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.saveLabel}>{inv.sendEmailDispatch}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  backLink: { ...typography.label, color: colors.accentGreen, fontSize: 13 },
  invoiceNoTitle: { ...typography.heading, fontSize: 14, color: colors.textPrimary },
  warning: {
    ...typography.body,
    fontSize: 12,
    color: colors.error,
    marginBottom: spacing.sm,
  },
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
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  section: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gapTop: { marginTop: spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  switchLabelWrap: { flex: 1 },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  recipientText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  pickerBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  pickerList: { gap: 4 },
  pickerRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  pickerName: { ...typography.body, color: colors.textPrimary, fontSize: 13 },
  lineCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  lineGrid: { flexDirection: 'row', gap: spacing.sm },
  lineFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  lineTotalText: { ...typography.label, color: colors.textPrimary, fontSize: 12 },
  linkAction: { ...typography.label, color: colors.accentGreen, fontSize: 12 },
  linkDanger: { ...typography.label, color: colors.error, fontSize: 12 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  secondaryBtnText: { ...typography.label, color: colors.accentGreen, fontSize: 13 },
  summaryBox: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: { ...typography.label, color: colors.textSecondary, fontSize: 12 },
  summaryValue: { ...typography.body, color: colors.textSecondary, fontSize: 13 },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
    justifyContent: 'center',
  },
  sendBtn: {
    flex: 2,
    backgroundColor: colors.buttonOptionGreen,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  saveLabel: { ...typography.label, color: colors.surface },
  emailFormCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  emailFormTitle: {
    ...typography.label,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emailFormIntro: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  field: { marginBottom: spacing.sm },
  modeToggleRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  modeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  modeChipActive: {
    backgroundColor: colors.accentGreen,
    borderColor: colors.accentGreen,
  },
  modeChipText: { ...typography.label, fontSize: 12, color: colors.textSecondary },
  modeChipTextActive: { color: colors.surface },
  presetBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceAlt,
    gap: spacing.xs,
  },
  presetRow: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  presetRowActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentGreen,
  },
  presetRowLabel: { ...typography.body, fontSize: 13, color: colors.textPrimary },
  presetNotice: {
    ...typography.body,
    fontSize: 11,
    color: colors.accentGreen,
    marginTop: 4,
  },
});
