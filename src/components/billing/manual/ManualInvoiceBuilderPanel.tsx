/**
 * ManualInvoiceBuilderPanel — wizard for creating / editing a manual invoice.
 *
 * Steps:
 *   1. Direction (agency_to_client | agency_to_model | model_to_agency)
 *   2. Sender + recipient profile pickers (filtered by direction)
 *   3. Invoice metadata (number, dates, currency, references)
 *   4. Line items (rates + expenses)
 *   5. Totals + tax notes
 *   6. PDF preview + generate
 *
 * State management:
 *   - Local "draft" object holds everything before persistence.
 *   - "Save draft" persists/updates the DB row at any step (creates an
 *     editable manual_invoices row, status='draft').
 *   - "Generate" calls generateManualInvoice (server-side validation, freeze
 *     snapshots, set status='generated').
 *
 * No silent tax decisions: any reverse-charge / zero-rated treatment is
 * pre-filled from the recipient profile but always editable + visible to the
 * user before generation.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
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
import { logManualBillingWarning } from '../../../utils/manualBillingLog';
import { shareOrDownloadManualInvoicePdf } from '../../../utils/manualInvoicePdfShare';
import {
  listManualAgencyBillingProfiles,
  listManualBillingCounterparties,
  getManualAgencyBillingProfile,
  getManualBillingCounterparty,
  upsertManualAgencyBillingProfile,
} from '../../../services/manualBillingProfilesSupabase';
import { listOrganizationBillingProfiles } from '../../../services/billingProfilesSupabase';
import type { ManualBillingAgencyProfileInput } from '../../../types/manualBillingTypes';
import {
  createManualInvoiceDraft,
  generateManualInvoice,
  getManualInvoiceWithLines,
  isManualInvoiceNumberTaken,
  refreshManualInvoiceAggregates,
  replaceManualInvoiceLineItems,
  suggestNextManualInvoiceNumber,
  updateManualInvoiceHeader,
} from '../../../services/manualInvoicesSupabase';
import {
  computeManualInvoiceTotals,
  formatMoneyCents,
  toLineLike,
} from '../../../utils/manualInvoiceTotals';
import {
  buildManualInvoicePdf,
  downloadManualInvoicePdf,
  manualInvoicePdfFilename,
} from '../../../utils/manualInvoicePdf';
import type {
  ManualBillingAgencyProfileRow,
  ManualBillingCounterpartyRow,
  ManualInvoiceDirection,
  ManualInvoiceHeaderInput,
  ManualInvoiceLineItemInput,
  ManualInvoiceWithLines,
} from '../../../types/manualBillingTypes';

type Props = {
  agencyOrganizationId: string;
  invoiceId: string | null;
  onBack: () => void;
  onDone: () => void;
};

type DraftLine = ManualInvoiceLineItemInput & { _key: string };

type Draft = {
  id: string | null;
  status: 'draft' | 'generated' | 'void';
  direction: ManualInvoiceDirection;
  sender_agency_profile_id: string | null;
  sender_counterparty_id: string | null;
  recipient_agency_profile_id: string | null;
  recipient_counterparty_id: string | null;

  invoice_number: string;
  issue_date: string;
  supply_date: string;
  due_date: string;
  payment_terms_days: number;
  currency: string;

  po_number: string;
  buyer_reference: string;
  job_reference: string;
  booking_reference: string;

  service_charge_pct: number | null;
  reverse_charge_applied: boolean;
  tax_note: string;
  invoice_notes: string;
  payment_instructions: string;
  footer_notes: string;

  lines: DraftLine[];
};

const TOTAL_STEPS = 6;

/** Shown when a date field cannot be parsed before Save draft / persist. */
const MANUAL_INVOICE_DATE_INVALID_MSG =
  'Please enter the date in a valid format, e.g. 2026-05-22 or 22.05.2026.';

function pad2(n: number): string {
  return n >= 10 ? String(n) : `0${n}`;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || y < 1 || y > 9999) return false;
  if (!Number.isFinite(m) || m < 1 || m > 12) return false;
  if (!Number.isFinite(d) || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Parses common typed dates to ISO YYYY-MM-DD for Postgres date columns.
 * Supports YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY (slash/dash), with ambiguous
 * numeric segments resolved like DD/MM vs MM/DD (EU-first when both ≤ 12).
 */
function parseManualInvoiceDateToIso(raw: string): { ok: true; iso: string } | { ok: false } {
  const s = raw.trim();
  if (!s) return { ok: false };

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isValidYmd(y, mo, d)) return { ok: true, iso: `${m[1]}-${m[2]}-${m[3]}` };
    return { ok: false };
  }

  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (isValidYmd(y, mo, d)) return { ok: true, iso: `${y}-${pad2(mo)}-${pad2(d)}` };
    return { ok: false };
  }

  m = s.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = Number(m[4]);
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else if (a <= 12 && b <= 12) {
      day = a;
      month = b;
    } else {
      return { ok: false };
    }
    if (isValidYmd(y, month, day)) return { ok: true, iso: `${y}-${pad2(month)}-${pad2(day)}` };
    return { ok: false };
  }

  return { ok: false };
}

type NormalizedOptionalDate =
  | { kind: 'empty' }
  | { kind: 'iso'; value: string }
  | { kind: 'invalid' };

function normalizeOptionalManualInvoiceDateField(raw: string): NormalizedOptionalDate {
  const t = raw.trim();
  if (!t) return { kind: 'empty' };
  const r = parseManualInvoiceDateToIso(t);
  return r.ok ? { kind: 'iso', value: r.iso } : { kind: 'invalid' };
}

/**
 * Builds header + lines with ISO dates only for Supabase. Empty optional fields → null.
 * Any non-empty field that fails parsing yields invalid result (caller blocks save).
 */
function normalizeDraftForPersistence(
  d: Draft,
): { ok: true; header: ManualInvoiceHeaderInput; lines: DraftLine[] } | { ok: false } {
  const issue = normalizeOptionalManualInvoiceDateField(d.issue_date);
  if (issue.kind === 'invalid') return { ok: false };
  const supply = normalizeOptionalManualInvoiceDateField(d.supply_date);
  if (supply.kind === 'invalid') return { ok: false };
  const due = normalizeOptionalManualInvoiceDateField(d.due_date);
  if (due.kind === 'invalid') return { ok: false };

  const lines: DraftLine[] = [];
  for (const line of d.lines) {
    const po = normalizeOptionalManualInvoiceDateField(line.performed_on ?? '');
    if (po.kind === 'invalid') return { ok: false };
    lines.push({
      ...line,
      performed_on: po.kind === 'empty' ? null : po.value,
    });
  }

  const base = toHeaderInput(d);
  return {
    ok: true,
    header: {
      ...base,
      issue_date: issue.kind === 'empty' ? null : issue.value,
      supply_date: supply.kind === 'empty' ? null : supply.value,
      due_date: due.kind === 'empty' ? null : due.value,
    },
    lines,
  };
}

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(): Draft {
  const today = todayIso();
  return {
    id: null,
    status: 'draft',
    direction: 'agency_to_client',
    sender_agency_profile_id: null,
    sender_counterparty_id: null,
    recipient_agency_profile_id: null,
    recipient_counterparty_id: null,
    invoice_number: '',
    issue_date: today,
    supply_date: today,
    due_date: '',
    payment_terms_days: 14,
    currency: 'EUR',
    po_number: '',
    buyer_reference: '',
    job_reference: '',
    booking_reference: '',
    service_charge_pct: null,
    reverse_charge_applied: false,
    tax_note: '',
    invoice_notes: '',
    payment_instructions: '',
    footer_notes: '',
    lines: [],
  };
}

function fromInvoice(inv: ManualInvoiceWithLines): Draft {
  return {
    id: inv.id,
    status: inv.status === 'void' ? 'void' : (inv.status as 'draft' | 'generated'),
    direction: inv.direction,
    sender_agency_profile_id: inv.sender_agency_profile_id,
    sender_counterparty_id: inv.sender_counterparty_id,
    recipient_agency_profile_id: inv.recipient_agency_profile_id,
    recipient_counterparty_id: inv.recipient_counterparty_id,
    invoice_number: inv.invoice_number ?? '',
    issue_date: inv.issue_date ?? '',
    supply_date: inv.supply_date ?? '',
    due_date: inv.due_date ?? '',
    payment_terms_days: inv.payment_terms_days ?? 14,
    currency: inv.currency ?? 'EUR',
    po_number: inv.po_number ?? '',
    buyer_reference: inv.buyer_reference ?? '',
    job_reference: inv.job_reference ?? '',
    booking_reference: inv.booking_reference ?? '',
    service_charge_pct: inv.service_charge_pct,
    reverse_charge_applied: inv.reverse_charge_applied,
    tax_note: inv.tax_note ?? '',
    invoice_notes: inv.invoice_notes ?? '',
    payment_instructions: inv.payment_instructions ?? '',
    footer_notes: inv.footer_notes ?? '',
    lines: (inv.line_items ?? [])
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        _key: newKey(),
        id: l.id,
        position: l.position,
        category: l.category,
        is_expense: l.is_expense,
        description: l.description,
        notes: l.notes,
        model_label: l.model_label,
        job_label: l.job_label,
        performed_on: l.performed_on,
        quantity: Number(l.quantity),
        unit: l.unit,
        unit_amount_cents: Number(l.unit_amount_cents),
        tax_treatment: l.tax_treatment,
        tax_rate_percent: l.tax_rate_percent,
        currency: l.currency,
        metadata: l.metadata,
      })),
  };
}

function toHeaderInput(d: Draft): ManualInvoiceHeaderInput {
  return {
    direction: d.direction,
    sender_agency_profile_id: d.sender_agency_profile_id,
    sender_counterparty_id: d.sender_counterparty_id,
    recipient_agency_profile_id: d.recipient_agency_profile_id,
    recipient_counterparty_id: d.recipient_counterparty_id,
    invoice_number: d.invoice_number || null,
    issue_date: d.issue_date || null,
    supply_date: d.supply_date || null,
    due_date: d.due_date || null,
    payment_terms_days: d.payment_terms_days,
    currency: d.currency,
    po_number: d.po_number || null,
    buyer_reference: d.buyer_reference || null,
    job_reference: d.job_reference || null,
    booking_reference: d.booking_reference || null,
    service_charge_pct: d.service_charge_pct,
    reverse_charge_applied: d.reverse_charge_applied,
    tax_note: d.tax_note || null,
    invoice_notes: d.invoice_notes || null,
    payment_instructions: d.payment_instructions || null,
    footer_notes: d.footer_notes || null,
  };
}

export const ManualInvoiceBuilderPanel: React.FC<Props> = ({
  agencyOrganizationId,
  invoiceId,
  onBack,
  onDone,
}) => {
  const c = uiCopy.manualBilling;
  const dirtyRef = useRef(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(invoiceId != null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [agencyProfiles, setAgencyProfiles] = useState<ManualBillingAgencyProfileRow[]>([]);
  const [clientProfiles, setClientProfiles] = useState<ManualBillingCounterpartyRow[]>([]);
  const [modelProfiles, setModelProfiles] = useState<ManualBillingCounterpartyRow[]>([]);

  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Load profile lists + (optionally) the existing invoice ───────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const [ap, cp, mp] = await Promise.all([
        listManualAgencyBillingProfiles(agencyOrganizationId),
        listManualBillingCounterparties(agencyOrganizationId, { kind: 'client' }),
        listManualBillingCounterparties(agencyOrganizationId, { kind: 'model' }),
      ]);
      if (!alive) return;
      setAgencyProfiles(ap);
      setClientProfiles(cp);
      setModelProfiles(mp);

      if (invoiceId) {
        const inv = await getManualInvoiceWithLines(invoiceId);
        if (alive && inv) setDraft(fromInvoice(inv));
        setLoading(false);
      } else {
        // Auto-pick default agency profile for sender if Agency→… direction
        const def = ap.find((p) => p.is_default) ?? ap[0] ?? null;
        if (def) {
          setDraft((prev) => ({
            ...prev,
            sender_agency_profile_id: def.id,
            currency: def.default_currency || 'EUR',
            payment_terms_days: def.default_payment_terms_days || 14,
            payment_instructions:
              prev.payment_instructions ||
              [
                def.account_holder ? `Account holder: ${def.account_holder}` : '',
                def.bank_name ? `Bank: ${def.bank_name}` : '',
                def.iban ? `IBAN: ${def.iban}` : '',
                def.bic ? `BIC: ${def.bic}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            footer_notes: prev.footer_notes || def.footer_notes || '',
            tax_note:
              def.default_vat_treatment === 'reverse_charge' && def.default_reverse_charge_note
                ? def.default_reverse_charge_note
                : prev.tax_note,
          }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [agencyOrganizationId, invoiceId]);

  // Mark dirty on any draft change (after first load)
  const setDraftWithDirty = useCallback((updater: (prev: Draft) => Draft) => {
    dirtyRef.current = true;
    setDraft(updater);
  }, []);

  // ── Pre-fill recipient defaults whenever client/model recipient changes ──
  useEffect(() => {
    const recipientCpId =
      draft.direction === 'agency_to_client' || draft.direction === 'agency_to_model'
        ? draft.recipient_counterparty_id
        : null;
    if (!recipientCpId) return;
    const cp =
      clientProfiles.find((p) => p.id === recipientCpId) ??
      modelProfiles.find((p) => p.id === recipientCpId) ??
      null;
    if (!cp) return;
    setDraft((prev) => ({
      ...prev,
      currency: prev.currency || cp.default_currency || 'EUR',
      payment_terms_days: prev.payment_terms_days || cp.default_payment_terms_days || 14,
      service_charge_pct: prev.service_charge_pct ?? cp.default_service_charge_pct,
      tax_note: prev.tax_note || cp.default_invoice_note || '',
      reverse_charge_applied:
        cp.default_vat_treatment === 'reverse_charge' || prev.reverse_charge_applied,
    }));
    // Note: we deliberately don't call setDraftWithDirty here — this is an
    // automated pre-fill, not a user action. dirtyRef is updated by user
    // edits in the metadata step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.recipient_counterparty_id, draft.direction]);

  // ── Live totals ─────────────────────────────────────────────────────────
  const totals = useMemo(
    () => computeManualInvoiceTotals(draft.lines.map(toLineLike), draft.service_charge_pct),
    [draft.lines, draft.service_charge_pct],
  );

  // ── Step validation ─────────────────────────────────────────────────────
  function validateStep(s: number): string | null {
    switch (s) {
      case 1:
        return null;
      case 2: {
        if (draft.direction === 'agency_to_client') {
          if (!draft.sender_agency_profile_id) return c.errorMissingSender;
          if (!draft.recipient_counterparty_id) return c.errorMissingRecipient;
        } else if (draft.direction === 'agency_to_model') {
          if (!draft.sender_agency_profile_id) return c.errorMissingSender;
          if (!draft.recipient_counterparty_id) return c.errorMissingRecipient;
        } else {
          if (!draft.sender_counterparty_id) return c.errorMissingSender;
          if (!draft.recipient_agency_profile_id) return c.errorMissingRecipient;
        }
        return null;
      }
      case 3:
        if (!draft.invoice_number.trim()) return c.errorMissingInvoiceNumber;
        return null;
      case 4: {
        if (draft.lines.length === 0) return c.errorNoLineItems;
        for (const ln of draft.lines) {
          if (!ln.description?.trim()) return c.errorLineMissingDescription;
          if (!ln.unit_amount_cents && ln.unit_amount_cents !== 0) return c.errorLineInvalidAmount;
        }
        return null;
      }
      default:
        return null;
    }
  }

  // ── Persistence helpers ─────────────────────────────────────────────────
  const persistDraft = useCallback(
    async (
      patch?: Partial<Draft>,
    ): Promise<{ ok: boolean; id?: string; reason?: string; message?: string }> => {
      const merged: Draft = patch ? { ...draft, ...patch } : draft;
      const normalized = normalizeDraftForPersistence(merged);
      if (!normalized.ok) {
        return {
          ok: false,
          reason: 'invalid_date',
          message: MANUAL_INVOICE_DATE_INVALID_MSG,
        };
      }
      try {
        if (!merged.id) {
          const res = await createManualInvoiceDraft(agencyOrganizationId, normalized.header);
          if (!res.ok || !res.id) return { ok: false, reason: res.reason };
          // Now upsert line items
          if (normalized.lines.length > 0) {
            const ok = await replaceManualInvoiceLineItems(
              agencyOrganizationId,
              res.id,
              normalized.lines.map((l, idx) => ({ ...l, position: idx })),
            );
            if (!ok) return { ok: false, reason: 'line_items_failed' };
          }
          await refreshManualInvoiceAggregates(agencyOrganizationId, res.id);
          setDraft((prev) => ({ ...prev, id: res.id! }));
          dirtyRef.current = false;
          return { ok: true, id: res.id };
        }
        const upd = await updateManualInvoiceHeader(
          agencyOrganizationId,
          merged.id,
          normalized.header,
        );
        if (!upd.ok) return { ok: false, reason: upd.reason };
        const okLines = await replaceManualInvoiceLineItems(
          agencyOrganizationId,
          merged.id,
          normalized.lines.map((l, idx) => ({ ...l, position: idx })),
        );
        if (!okLines) return { ok: false, reason: 'line_items_failed' };
        dirtyRef.current = false;
        return { ok: true, id: merged.id };
      } catch (e) {
        logManualBillingWarning('ManualInvoiceBuilderPanel:persistDraft', e);
        return { ok: false, reason: 'exception' };
      }
    },
    [agencyOrganizationId, draft],
  );

  const onSaveDraft = async () => {
    if (!agencyOrganizationId || agencyOrganizationId.trim() === '') {
      showAppAlert(c.errorBuilderNoOrgContext);
      return;
    }
    const stepErr = validateStep(step);
    if (stepErr) {
      showAppAlert(stepErr);
      return;
    }
    setSaving(true);
    try {
      const res = await persistDraft();
      if (!res.ok) {
        if (res.reason === 'invalid_date' && res.message) {
          showAppAlert(res.message);
          return;
        }
        logManualBillingWarning('ManualInvoiceBuilderPanel:onSaveDraft', {
          reason: res.reason,
          step,
          draftId: draft.id,
        });
        // Map known direction-validation reason codes to specific copy.
        // reasonToCopy falls back to errorBuilderGenerationFailed for unknown
        // codes — that message is wrong for a save; use the save fallback instead.
        const safeCopy = res.reason ? reasonToCopy(res.reason) : null;
        showAppAlert(
          safeCopy && safeCopy !== c.errorBuilderGenerationFailed
            ? safeCopy
            : c.errorBuilderSaveFailed,
        );
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Import agency profile from Org profiles ────────────────────────────
  const [importingOrgProfile, setImportingOrgProfile] = useState(false);

  const onImportFromOrgProfile = useCallback(async () => {
    setImportingOrgProfile(true);
    try {
      const orgProfiles = await listOrganizationBillingProfiles(agencyOrganizationId);
      const src = orgProfiles.find((p) => p.is_default) ?? orgProfiles[0] ?? null;
      if (!src) {
        showAppAlert(c.step2CopyFromOrgProfileNoOrg);
        return;
      }
      const legalName = (src.billing_name ?? src.label ?? '').trim();
      if (!legalName) {
        showAppAlert(c.step2CopyFromOrgProfileNoName);
        return;
      }
      const input: ManualBillingAgencyProfileInput = {
        legal_name: legalName,
        address_line_1: src.billing_address_1 ?? null,
        address_line_2: src.billing_address_2 ?? null,
        city: src.billing_city ?? null,
        postal_code: src.billing_postal_code ?? null,
        state: src.billing_state ?? null,
        // billing_country is intentionally NOT mapped — it may be free text
        // ("Germany") while country_code expects a 2-letter ISO code ("DE").
        email: src.billing_email ?? null,
        vat_number: src.vat_id ?? null,
        tax_number: src.tax_id ?? null,
        iban: src.iban ?? null,
        bic: src.bic ?? null,
        bank_name: src.bank_name ?? null,
        default_currency: 'EUR',
        default_payment_terms_days: 14,
        is_default: true,
        is_archived: false,
      };
      const res = await upsertManualAgencyBillingProfile(agencyOrganizationId, input, null);
      if (!res.ok) {
        showAppAlert(c.saveFailedGeneric);
        return;
      }
      const refreshed = await listManualAgencyBillingProfiles(agencyOrganizationId);
      setAgencyProfiles(refreshed);
      // Auto-select the newly created profile as sender
      const created = res.id ? (refreshed.find((p) => p.id === res.id) ?? null) : null;
      if (created) {
        setDraftWithDirty((prev) => ({
          ...prev,
          sender_agency_profile_id: created.id,
          currency: created.default_currency || 'EUR',
          payment_terms_days: created.default_payment_terms_days || 14,
        }));
      }
    } catch (e) {
      logManualBillingWarning('ManualInvoiceBuilderPanel:onImportFromOrgProfile', e);
      showAppAlert(c.saveFailedGeneric);
    } finally {
      setImportingOrgProfile(false);
    }
  }, [agencyOrganizationId, c, setDraftWithDirty]);

  // ── Number suggestion ──────────────────────────────────────────────────
  const onSuggestNumber = async () => {
    const next = await suggestNextManualInvoiceNumber(agencyOrganizationId);
    if (!next) {
      showAppAlert(c.step3SuggestFailed);
      return;
    }
    setDraftWithDirty((prev) => ({ ...prev, invoice_number: next }));
  };

  // ── Preview (PDF) ──────────────────────────────────────────────────────
  const buildPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const sender = await pickPartyForPreview(
        draft.direction === 'model_to_agency' ? 'counterparty' : 'agency',
        draft.direction === 'model_to_agency'
          ? draft.sender_counterparty_id
          : draft.sender_agency_profile_id,
      );
      const recipient = await pickPartyForPreview(
        draft.direction === 'model_to_agency' ? 'agency' : 'counterparty',
        draft.direction === 'model_to_agency'
          ? draft.recipient_agency_profile_id
          : draft.recipient_counterparty_id,
      );
      const blob = await buildManualInvoicePdf({
        invoice: {
          direction: draft.direction,
          status: draft.status,
          invoice_number: draft.invoice_number || null,
          issue_date: draft.issue_date || null,
          supply_date: draft.supply_date || null,
          due_date: draft.due_date || null,
          payment_terms_days: draft.payment_terms_days,
          currency: draft.currency,
          po_number: draft.po_number || null,
          buyer_reference: draft.buyer_reference || null,
          job_reference: draft.job_reference || null,
          booking_reference: draft.booking_reference || null,
          service_charge_pct: draft.service_charge_pct,
          tax_note: draft.tax_note || null,
          invoice_notes: draft.invoice_notes || null,
          payment_instructions: draft.payment_instructions || null,
          footer_notes: draft.footer_notes || null,
          reverse_charge_applied: draft.reverse_charge_applied,
        },
        sender,
        recipient,
        lines: draft.lines,
        totals,
        isDraft: draft.status !== 'generated',
      });
      setPreviewBlob(blob);
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      logManualBillingWarning('ManualInvoiceBuilderPanel:buildPreview', e);
      showAppAlert(c.step6PreviewFailed);
    } finally {
      setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, totals]);

  // Build preview when entering step 6
  useEffect(() => {
    if (step === 6) {
      void buildPreview();
    } else {
      // Free preview memory when not on step 6
      if (previewUrl && typeof URL !== 'undefined') {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewBlob(null);
      setPreviewUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Helper: load party row for preview either from already-loaded lists or DB
  async function pickPartyForPreview(
    kind: 'agency' | 'counterparty',
    id: string | null,
  ): Promise<ManualBillingAgencyProfileRow | ManualBillingCounterpartyRow | null> {
    if (!id) return null;
    if (kind === 'agency') {
      const local = agencyProfiles.find((p) => p.id === id);
      return local ?? (await getManualAgencyBillingProfile(id));
    }
    const local = [...clientProfiles, ...modelProfiles].find((p) => p.id === id);
    return local ?? (await getManualBillingCounterparty(id));
  }

  // ── Generate ───────────────────────────────────────────────────────────
  const onGenerate = async () => {
    showConfirmAlert(
      c.step6GenerateConfirmTitle,
      c.step6GenerateConfirmBody,
      async () => {
        setGenerating(true);
        try {
          // Persist latest first
          const persisted = await persistDraft();
          if (!persisted.ok || !persisted.id) {
            showAppAlert(
              persisted.reason === 'invalid_date' && persisted.message
                ? persisted.message
                : c.errorBuilderSaveFailed,
            );
            return;
          }
          // Pre-flight: check number collision (we have it locally).
          if (draft.invoice_number.trim()) {
            const taken = await isManualInvoiceNumberTaken(
              agencyOrganizationId,
              draft.invoice_number.trim(),
              persisted.id,
            );
            if (taken) {
              showAppAlert(c.errorInvoiceNumberTaken);
              return;
            }
          }
          const res = await generateManualInvoice(agencyOrganizationId, persisted.id, {
            invoiceNumber: draft.invoice_number || undefined,
          });
          if (!res.ok) {
            showAppAlert(reasonToCopy(res.reason));
            return;
          }
          // Refresh local state to "generated"
          const fresh = await getManualInvoiceWithLines(persisted.id);
          if (fresh) setDraft(fromInvoice(fresh));
          showAppAlert(c.saveSuccess);
        } finally {
          setGenerating(false);
        }
      },
      c.builderGenerate,
    );
  };

  function reasonToCopy(reason: string): string {
    switch (reason) {
      case 'invoice_number_taken':
        return c.errorInvoiceNumberTaken;
      case 'no_line_items':
        return c.errorNoLineItems;
      case 'agency_to_client_sender_must_be_agency_profile':
        return c.reasonAgencyToClientSenderMustBeAgency;
      case 'agency_to_client_recipient_must_be_counterparty':
        return c.reasonAgencyToClientRecipientMustBeCounterparty;
      case 'agency_to_model_sender_must_be_agency_profile':
        return c.reasonAgencyToModelSenderMustBeAgency;
      case 'agency_to_model_recipient_must_be_counterparty':
        return c.reasonAgencyToModelRecipientMustBeCounterparty;
      case 'model_to_agency_sender_must_be_counterparty':
        return c.reasonModelToAgencySenderMustBeCounterparty;
      case 'model_to_agency_recipient_must_be_agency_profile':
        return c.reasonModelToAgencyRecipientMustBeAgency;
      default:
        return c.errorBuilderGenerationFailed;
    }
  }

  // ── Step navigation ────────────────────────────────────────────────────
  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      showAppAlert(err);
      return;
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  };
  const goBack = () => {
    if (step === 1) {
      if (dirtyRef.current && draft.status === 'draft') {
        showConfirmAlert(c.unsavedChangesTitle, c.unsavedChangesBody, onBack, c.cancel);
      } else {
        onBack();
      }
      return;
    }
    if (dirtyRef.current && draft.status === 'draft') {
      showConfirmAlert(
        c.unsavedChangesTitle,
        c.unsavedChangesBody,
        () => {
          setStep((s) => Math.max(s - 1, 1));
        },
        c.cancel,
      );
      return;
    }
    setStep((s) => Math.max(s - 1, 1));
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    );
  }

  const isReadOnly = draft.status === 'generated';

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={s.headerBlock}>
        <TouchableOpacity onPress={goBack} accessibilityRole="button" style={s.backBtn}>
          <Text style={s.backBtnText}>‹ {step === 1 ? c.backToBilling : c.builderBack}</Text>
        </TouchableOpacity>
        <Text style={s.title}>
          {invoiceId ? c.builderEditTitle : c.builderTitle}
          {draft.invoice_number ? ` — ${draft.invoice_number}` : ''}
        </Text>
        <Text style={s.subtitle}>{c.builderProgress(step, TOTAL_STEPS)}</Text>
        {isReadOnly && (
          <View style={s.readOnlyBanner} accessibilityRole="alert">
            <Text style={s.readOnlyBannerTitle}>{c.builderInvoiceLockedTitle}</Text>
            <Text style={s.readOnlyBannerText}>{c.builderInvoiceLockedBody}</Text>
          </View>
        )}
      </View>

      {/* Steps */}
      {step === 1 && (
        <Step1Direction
          value={draft.direction}
          disabled={isReadOnly}
          onChange={(d) =>
            setDraftWithDirty((prev) => {
              // Reset profile selections when direction changes
              return {
                ...prev,
                direction: d,
                sender_agency_profile_id: null,
                sender_counterparty_id: null,
                recipient_agency_profile_id: null,
                recipient_counterparty_id: null,
              };
            })
          }
        />
      )}
      {step === 2 && (
        <Step2Profiles
          draft={draft}
          disabled={isReadOnly}
          agencyProfiles={agencyProfiles}
          clientProfiles={clientProfiles}
          modelProfiles={modelProfiles}
          onChange={setDraftWithDirty}
          onImportFromOrgProfile={onImportFromOrgProfile}
          importingOrgProfile={importingOrgProfile}
        />
      )}
      {step === 3 && (
        <Step3Metadata
          draft={draft}
          disabled={isReadOnly}
          onChange={setDraftWithDirty}
          onSuggestNumber={onSuggestNumber}
        />
      )}
      {step === 4 && (
        <Step4LineItems
          draft={draft}
          disabled={isReadOnly}
          totals={totals}
          onChange={setDraftWithDirty}
        />
      )}
      {step === 5 && (
        <Step5Totals
          draft={draft}
          disabled={isReadOnly}
          totals={totals}
          onChange={setDraftWithDirty}
        />
      )}
      {step === 6 && (
        <Step6Preview
          previewLoading={previewLoading}
          previewUrl={previewUrl}
          previewBlob={previewBlob}
          onRebuild={buildPreview}
          isGenerated={isReadOnly}
          invoiceNumber={draft.invoice_number || null}
          isWeb={Platform.OS === 'web'}
          onShareNative={async () => {
            if (!previewBlob) return;
            const fn = manualInvoicePdfFilename({
              invoiceNumber: draft.invoice_number || null,
              isDraft: draft.status !== 'generated',
            });
            const r = await shareOrDownloadManualInvoicePdf(previewBlob, fn);
            if (!r.ok) showAppAlert(c.step6OpenPdfFailed);
          }}
        />
      )}

      {/* Footer actions */}
      <View style={s.footerActions}>
        <TouchableOpacity onPress={goBack} style={s.secondaryBtn}>
          <Text style={s.secondaryBtnText}>{step === 1 ? c.cancel : c.builderBack}</Text>
        </TouchableOpacity>
        {!isReadOnly && (
          <TouchableOpacity onPress={onSaveDraft} disabled={saving} style={s.secondaryBtn}>
            <Text style={s.secondaryBtnText}>{saving ? c.saving : c.builderSaveDraft}</Text>
          </TouchableOpacity>
        )}
        {step < TOTAL_STEPS ? (
          <TouchableOpacity onPress={goNext} style={s.primaryBtn}>
            <Text style={s.primaryBtnText}>{c.builderNext}</Text>
          </TouchableOpacity>
        ) : isReadOnly ? (
          <TouchableOpacity onPress={onDone} style={s.primaryBtn}>
            <Text style={s.primaryBtnText}>Close</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onGenerate} disabled={generating} style={s.primaryBtn}>
            <Text style={s.primaryBtnText}>{generating ? c.saving : c.builderGenerate}</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};

// ── Step 1 ────────────────────────────────────────────────────────────────

const Step1Direction: React.FC<{
  value: ManualInvoiceDirection;
  disabled: boolean;
  onChange: (d: ManualInvoiceDirection) => void;
}> = ({ value, disabled, onChange }) => {
  const c = uiCopy.manualBilling;
  const opts: Array<{
    v: ManualInvoiceDirection;
    title: string;
    hint: string;
  }> = [
    {
      v: 'agency_to_client',
      title: c.step1OptionAgencyClient,
      hint: c.step1OptionAgencyClientHint,
    },
    { v: 'agency_to_model', title: c.step1OptionAgencyModel, hint: c.step1OptionAgencyModelHint },
    { v: 'model_to_agency', title: c.step1OptionModelAgency, hint: c.step1OptionModelAgencyHint },
  ];
  return (
    <View style={s.stepCard}>
      <Text style={s.stepTitle}>{c.step1Title}</Text>
      <Text style={s.stepSubtitle}>{c.step1Subtitle}</Text>
      {opts.map((o) => {
        const active = o.v === value;
        return (
          <TouchableOpacity
            key={o.v}
            disabled={disabled}
            onPress={() => onChange(o.v)}
            style={[s.choiceCard, active && s.choiceCardActive, disabled && { opacity: 0.5 }]}
          >
            <Text style={[s.choiceTitle, active && s.choiceTitleActive]}>{o.title}</Text>
            <Text style={[s.choiceHint, active && s.choiceHintActive]}>{o.hint}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// ── Step 2 ────────────────────────────────────────────────────────────────

const Step2Profiles: React.FC<{
  draft: Draft;
  disabled: boolean;
  agencyProfiles: ManualBillingAgencyProfileRow[];
  clientProfiles: ManualBillingCounterpartyRow[];
  modelProfiles: ManualBillingCounterpartyRow[];
  onChange: (updater: (prev: Draft) => Draft) => void;
  onImportFromOrgProfile: () => void | Promise<void>;
  importingOrgProfile: boolean;
}> = ({
  draft,
  disabled,
  agencyProfiles,
  clientProfiles,
  modelProfiles,
  onChange,
  onImportFromOrgProfile,
  importingOrgProfile,
}) => {
  const c = uiCopy.manualBilling;
  // Search state lives here — NOT inside PartyPicker — to survive parent re-renders.
  const [senderSearch, setSenderSearch] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [sortMode, setSortMode] = useState<'alpha' | 'modified'>('alpha');

  const senderKind: 'agency' | 'client' | 'model' =
    draft.direction === 'model_to_agency' ? 'model' : 'agency';
  const recipientKind: 'agency' | 'client' | 'model' =
    draft.direction === 'agency_to_client'
      ? 'client'
      : draft.direction === 'agency_to_model'
        ? 'model'
        : 'agency';

  function PartyPicker({
    label,
    kind,
    value,
    onPick,
    required,
    search,
    onSearchChange,
  }: {
    label: string;
    kind: 'agency' | 'client' | 'model';
    value: string | null;
    onPick: (id: string | null) => void;
    required?: boolean;
    search: string;
    onSearchChange: (v: string) => void;
  }) {
    const list =
      kind === 'agency' ? agencyProfiles : kind === 'client' ? clientProfiles : modelProfiles;
    const placeholder =
      kind === 'agency'
        ? c.step2PickAgencyProfile
        : kind === 'client'
          ? c.step2PickClientProfile
          : c.step2PickModelProfile;
    const isMissing = required && value == null && list.length > 0;
    const term = search.trim().toLowerCase();

    const filtered = term
      ? list.filter((p) => {
          if (p.legal_name.toLowerCase().includes(term)) return true;
          if ((p.city ?? '').toLowerCase().includes(term)) return true;
          if ((p.vat_number ?? '').toLowerCase().includes(term)) return true;
          if (kind === 'agency') {
            const ap = p as ManualBillingAgencyProfileRow;
            return (ap.trading_name ?? '').toLowerCase().includes(term);
          }
          const cp = p as ManualBillingCounterpartyRow;
          return (
            (cp.display_name ?? '').toLowerCase().includes(term) ||
            (cp.contact_person ?? '').toLowerCase().includes(term) ||
            (cp.billing_email ?? '').toLowerCase().includes(term)
          );
        })
      : list;

    // ISO 8601 strings sort correctly as plain strings.
    const sorted =
      sortMode === 'modified'
        ? [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        : filtered;

    return (
      <View
        style={[
          s.pickerBlock,
          isMissing && {
            borderWidth: 1,
            borderColor: colors.errorDark,
            borderRadius: 8,
            padding: 8,
          },
        ]}
      >
        <Text style={[s.fieldLabel, isMissing && { color: colors.errorDark }]}>{label}</Text>

        {list.length > 0 && (
          <TextInput
            style={s.pickerSearchInput}
            value={search}
            onChangeText={onSearchChange}
            placeholder={c.step2SearchPlaceholder}
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            editable={!disabled}
          />
        )}

        {list.length === 0 ? (
          <View style={s.pickerEmptyBlock}>
            <Text style={s.emptyText}>
              {kind === 'agency' ? c.step2NoAgencyProfileFound : c.step2NoProfileSelected}
            </Text>
            {kind === 'agency' && !disabled && (
              <TouchableOpacity
                onPress={() => void onImportFromOrgProfile()}
                disabled={importingOrgProfile}
                style={[
                  s.secondaryBtn,
                  { marginTop: spacing.xs },
                  importingOrgProfile && { opacity: 0.5 },
                ]}
              >
                <Text style={s.secondaryBtnText}>
                  {importingOrgProfile
                    ? c.step2CopyFromOrgProfileImporting
                    : c.step2CopyFromOrgProfile}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {term.length > 0 && (
              <Text style={s.pickerCount}>{c.step2ShowingCount(filtered.length, list.length)}</Text>
            )}
            {sorted.length === 0 ? (
              <Text style={s.emptyText}>{c.step2NoSearchResults(search.trim())}</Text>
            ) : (
              sorted.map((p) => {
                const active = value === p.id;
                const isAgencyKind = kind === 'agency';
                const ap = isAgencyKind ? (p as ManualBillingAgencyProfileRow) : null;
                const cp = isAgencyKind ? null : (p as ManualBillingCounterpartyRow);

                const metaParts: string[] = [];
                if (ap) {
                  if (ap.trading_name) metaParts.push(ap.trading_name);
                } else if (cp) {
                  if (cp.display_name && cp.display_name !== cp.legal_name)
                    metaParts.push(cp.display_name);
                  if (cp.contact_person) metaParts.push(cp.contact_person);
                }
                if (p.city) metaParts.push(p.city);
                if (p.country_code) metaParts.push(p.country_code);
                if (p.vat_number) metaParts.push(p.vat_number);
                if (ap) metaParts.push(ap.default_currency);

                return (
                  <TouchableOpacity
                    key={p.id}
                    disabled={disabled}
                    onPress={() => onPick(active ? null : p.id)}
                    style={[
                      s.profileRow,
                      active && s.profileRowActive,
                      disabled && { opacity: 0.5 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Text style={[s.profileRowName, active && s.profileRowNameActive]}>
                        {p.legal_name}
                      </Text>
                      {ap?.is_default && (
                        <View style={s.profileDefaultBadge}>
                          <Text style={s.profileDefaultBadgeText}>{c.step2DefaultBadge}</Text>
                        </View>
                      )}
                    </View>
                    {metaParts.length > 0 && (
                      <Text
                        style={[s.profileRowMeta, active && { color: 'rgba(255,255,255,0.75)' }]}
                        numberOfLines={1}
                      >
                        {metaParts.join(' · ')}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}

        {value == null && list.length > 0 && <Text style={s.fieldHint}>{placeholder}</Text>}
        <Text style={s.fieldHint}>{c.step2CreateProfileHint}</Text>
      </View>
    );
  }

  return (
    <View style={s.stepCard}>
      <Text style={s.stepTitle}>{c.step2Title}</Text>
      <Text style={s.stepSubtitle}>{c.step2Subtitle}</Text>

      {/* Sort mode toggle — shared across both pickers */}
      <View style={s.sortBar}>
        <Text style={s.fieldHint}>{c.step2SortLabel}</Text>
        {(['alpha', 'modified'] as const).map((mode) => {
          const active = sortMode === mode;
          return (
            <TouchableOpacity
              key={mode}
              onPress={() => setSortMode(mode)}
              style={[s.sortPill, active && s.sortPillActive]}
            >
              <Text style={[s.sortPillText, active && s.sortPillTextActive]}>
                {mode === 'alpha' ? c.step2SortAlpha : c.step2SortModified}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <PartyPicker
        label={c.step2SenderLabel}
        kind={senderKind}
        required
        search={senderSearch}
        onSearchChange={setSenderSearch}
        value={
          senderKind === 'agency' ? draft.sender_agency_profile_id : draft.sender_counterparty_id
        }
        onPick={(id) =>
          onChange((prev) => ({
            ...prev,
            sender_agency_profile_id: senderKind === 'agency' ? id : null,
            sender_counterparty_id: senderKind === 'agency' ? null : id,
          }))
        }
      />
      <PartyPicker
        label={c.step2RecipientLabel}
        kind={recipientKind}
        required
        search={recipientSearch}
        onSearchChange={setRecipientSearch}
        value={
          recipientKind === 'agency'
            ? draft.recipient_agency_profile_id
            : draft.recipient_counterparty_id
        }
        onPick={(id) =>
          onChange((prev) => ({
            ...prev,
            recipient_agency_profile_id: recipientKind === 'agency' ? id : null,
            recipient_counterparty_id: recipientKind === 'agency' ? null : id,
          }))
        }
      />
    </View>
  );
};

// ── Step 3 ────────────────────────────────────────────────────────────────

const Step3Metadata: React.FC<{
  draft: Draft;
  disabled: boolean;
  onChange: (updater: (prev: Draft) => Draft) => void;
  onSuggestNumber: () => void | Promise<void>;
}> = ({ draft, disabled, onChange, onSuggestNumber }) => {
  const c = uiCopy.manualBilling;
  return (
    <View style={s.stepCard}>
      <Text style={s.stepTitle}>{c.step3Title}</Text>
      <Text style={s.stepSubtitle}>{c.step3Subtitle}</Text>

      <View style={s.fieldBlock}>
        <Text style={s.fieldLabel}>{c.step3InvoiceNumberLabel}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={draft.invoice_number}
            onChangeText={(v) => onChange((prev) => ({ ...prev, invoice_number: v }))}
            editable={!disabled}
            placeholder={c.step3InvoiceNumberPlaceholder}
            placeholderTextColor={colors.textSecondary}
          />
          <TouchableOpacity
            disabled={disabled}
            onPress={onSuggestNumber}
            style={[s.secondaryBtn, disabled && { opacity: 0.5 }]}
          >
            <Text style={s.secondaryBtnText}>{c.step3SuggestNumber}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.row}>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3IssueDateLabel}</Text>
          <TextInput
            style={s.input}
            value={draft.issue_date}
            onChangeText={(v) => onChange((prev) => ({ ...prev, issue_date: v }))}
            editable={!disabled}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3SupplyDateLabel}</Text>
          <TextInput
            style={s.input}
            value={draft.supply_date}
            onChangeText={(v) => onChange((prev) => ({ ...prev, supply_date: v }))}
            editable={!disabled}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      </View>

      <View style={s.row}>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3DueDateLabel}</Text>
          <TextInput
            style={s.input}
            value={draft.due_date}
            onChangeText={(v) => onChange((prev) => ({ ...prev, due_date: v }))}
            editable={!disabled}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3PaymentTermsLabel}</Text>
          <TextInput
            style={s.input}
            value={String(draft.payment_terms_days)}
            onChangeText={(v) =>
              onChange((prev) => ({
                ...prev,
                payment_terms_days: Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 14,
              }))
            }
            editable={!disabled}
            keyboardType="number-pad"
          />
        </View>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3CurrencyLabel}</Text>
          <TextInput
            style={s.input}
            value={draft.currency}
            onChangeText={(v) =>
              onChange((prev) => ({ ...prev, currency: (v || 'EUR').toUpperCase() }))
            }
            editable={!disabled}
            autoCapitalize="characters"
          />
        </View>
      </View>

      <View style={s.row}>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3PoNumberLabel}</Text>
          <TextInput
            style={s.input}
            value={draft.po_number}
            onChangeText={(v) => onChange((prev) => ({ ...prev, po_number: v }))}
            editable={!disabled}
          />
        </View>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3JobReferenceLabel}</Text>
          <TextInput
            style={s.input}
            value={draft.job_reference}
            onChangeText={(v) => onChange((prev) => ({ ...prev, job_reference: v }))}
            editable={!disabled}
          />
        </View>
        <View style={[s.fieldBlock, { flex: 1 }]}>
          <Text style={s.fieldLabel}>{c.step3BookingReferenceLabel}</Text>
          <TextInput
            style={s.input}
            value={draft.booking_reference}
            onChangeText={(v) => onChange((prev) => ({ ...prev, booking_reference: v }))}
            editable={!disabled}
          />
        </View>
      </View>
    </View>
  );
};

// ── Step 4 ────────────────────────────────────────────────────────────────

const Step4LineItems: React.FC<{
  draft: Draft;
  disabled: boolean;
  totals: ReturnType<typeof computeManualInvoiceTotals>;
  onChange: (updater: (prev: Draft) => Draft) => void;
}> = ({ draft, disabled, totals, onChange }) => {
  const c = uiCopy.manualBilling;
  const addLine = (isExpense: boolean) => {
    onChange((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          _key: newKey(),
          description: '',
          quantity: 1,
          unit_amount_cents: 0,
          is_expense: isExpense,
          tax_rate_percent: 0,
          tax_treatment: prev.reverse_charge_applied ? 'reverse_charge' : null,
        },
      ],
    }));
  };

  const updateLine = (idx: number, patch: Partial<DraftLine>) => {
    onChange((prev) => {
      const next = [...prev.lines];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, lines: next };
    });
  };

  const removeLine = (idx: number) => {
    onChange((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));
  };

  const duplicateLine = (idx: number) => {
    onChange((prev) => {
      const next = [...prev.lines];
      next.splice(idx + 1, 0, { ...next[idx], _key: newKey(), id: undefined });
      return { ...prev, lines: next };
    });
  };

  const move = (idx: number, dir: -1 | 1) => {
    onChange((prev) => {
      const next = [...prev.lines];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, lines: next };
    });
  };

  return (
    <View style={s.stepCard}>
      <Text style={s.stepTitle}>{c.step4Title}</Text>
      <Text style={s.stepSubtitle}>{c.step4Subtitle}</Text>

      {draft.lines.length === 0 && <Text style={s.emptyText}>{c.step4Empty}</Text>}

      {draft.lines.map((line, idx) => {
        const lineNet = computeManualInvoiceTotals([toLineLike(line)]);
        return (
          <View key={line._key} style={s.lineCard}>
            <View style={s.row}>
              <View style={[s.fieldBlock, { flex: 1 }]}>
                <Text style={s.fieldLabel}>{c.step4LinePerformedOn}</Text>
                <TextInput
                  style={s.input}
                  value={line.performed_on ?? ''}
                  onChangeText={(v) => updateLine(idx, { performed_on: v || null })}
                  editable={!disabled}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={[s.fieldBlock, { flex: 2 }]}>
                <Text style={s.fieldLabel}>{c.step4LineCategory}</Text>
                <TextInput
                  style={s.input}
                  value={line.category ?? ''}
                  onChangeText={(v) => updateLine(idx, { category: v || null })}
                  editable={!disabled}
                  placeholder={c.step4CategoryDayRate}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>

            <View style={s.fieldBlock}>
              <Text style={s.fieldLabel}>{c.step4LineDescription}</Text>
              <TextInput
                style={[s.input, s.inputMultiline]}
                value={line.description}
                onChangeText={(v) => updateLine(idx, { description: v })}
                editable={!disabled}
                multiline
              />
            </View>

            <View style={s.row}>
              <View style={[s.fieldBlock, { flex: 1 }]}>
                <Text style={s.fieldLabel}>{c.step4LineModelLabel}</Text>
                <TextInput
                  style={s.input}
                  value={line.model_label ?? ''}
                  onChangeText={(v) => updateLine(idx, { model_label: v || null })}
                  editable={!disabled}
                />
              </View>
              <View style={[s.fieldBlock, { flex: 1 }]}>
                <Text style={s.fieldLabel}>{c.step4LineJobLabel}</Text>
                <TextInput
                  style={s.input}
                  value={line.job_label ?? ''}
                  onChangeText={(v) => updateLine(idx, { job_label: v || null })}
                  editable={!disabled}
                />
              </View>
            </View>

            <View style={s.row}>
              <View style={[s.fieldBlock, { flex: 0.6 }]}>
                <Text style={s.fieldLabel}>{c.step4LineQuantity}</Text>
                <TextInput
                  style={s.input}
                  value={String(line.quantity ?? 1)}
                  onChangeText={(v) => {
                    const n = parseFloat(v.replace(',', '.'));
                    updateLine(idx, { quantity: Number.isFinite(n) ? n : 1 });
                  }}
                  editable={!disabled}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={[s.fieldBlock, { flex: 0.6 }]}>
                <Text style={s.fieldLabel}>{c.step4LineUnit}</Text>
                <TextInput
                  style={s.input}
                  value={line.unit ?? ''}
                  onChangeText={(v) => updateLine(idx, { unit: v || null })}
                  editable={!disabled}
                />
              </View>
              <View style={[s.fieldBlock, { flex: 1 }]}>
                <Text style={s.fieldLabel}>
                  {c.step4LineUnitAmount} ({draft.currency})
                </Text>
                <TextInput
                  style={s.input}
                  value={
                    line.unit_amount_cents == null ? '' : (line.unit_amount_cents / 100).toFixed(2)
                  }
                  onChangeText={(v) => {
                    const n = parseFloat(v.replace(',', '.'));
                    updateLine(idx, {
                      unit_amount_cents: Number.isFinite(n) ? Math.round(n * 100) : 0,
                    });
                  }}
                  editable={!disabled}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={[s.fieldBlock, { flex: 0.7 }]}>
                <Text style={s.fieldLabel}>{c.step4LineTaxRate}</Text>
                <TextInput
                  style={s.input}
                  value={line.tax_rate_percent == null ? '' : String(line.tax_rate_percent)}
                  onChangeText={(v) => {
                    if (v.trim() === '') {
                      updateLine(idx, { tax_rate_percent: null });
                      return;
                    }
                    const n = parseFloat(v.replace(',', '.'));
                    updateLine(idx, {
                      tax_rate_percent: Number.isFinite(n) ? n : null,
                    });
                  }}
                  editable={!disabled}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={s.fieldBlock}>
              <Text style={s.fieldLabel}>{c.step4LineTaxTreatment}</Text>
              <View style={s.pillRow}>
                {[
                  { v: null, label: '—' },
                  { v: 'domestic', label: c.fieldVatTreatmentDomestic },
                  { v: 'reverse_charge', label: c.fieldVatTreatmentReverseCharge },
                  { v: 'zero_rated', label: c.fieldVatTreatmentZeroRated },
                  { v: 'exempt', label: c.fieldVatTreatmentExempt },
                  { v: 'out_of_scope', label: c.fieldVatTreatmentOutOfScope },
                ].map((opt) => {
                  const active = (line.tax_treatment ?? null) === opt.v;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      disabled={disabled}
                      onPress={() => updateLine(idx, { tax_treatment: opt.v as string | null })}
                      style={[
                        s.optionPill,
                        active && s.optionPillActive,
                        disabled && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={[s.optionPillText, active && s.optionPillTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.fieldBlock}>
              <Text style={s.fieldLabel}>{c.step4LineNotes}</Text>
              <TextInput
                style={s.input}
                value={line.notes ?? ''}
                onChangeText={(v) => updateLine(idx, { notes: v || null })}
                editable={!disabled}
              />
            </View>

            <View style={s.lineFooter}>
              <Text style={s.lineNet}>
                {formatMoneyCents(lineNet.net_total_before_service_cents, draft.currency)}
              </Text>
              <View style={s.lineActions}>
                <TouchableOpacity onPress={() => move(idx, -1)} disabled={disabled}>
                  <Text style={s.linkBtn}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => move(idx, +1)} disabled={disabled}>
                  <Text style={s.linkBtn}>↓</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => duplicateLine(idx)} disabled={disabled}>
                  <Text style={s.linkBtn}>{c.step4Duplicate}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeLine(idx)} disabled={disabled}>
                  <Text style={[s.linkBtn, { color: colors.errorDark }]}>{c.step4Remove}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {line.is_expense && <Text style={s.expenseTag}>EXPENSE</Text>}
          </View>
        );
      })}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <TouchableOpacity
          disabled={disabled}
          onPress={() => addLine(false)}
          style={[s.secondaryBtn, { flex: 1 }, disabled && { opacity: 0.5 }]}
        >
          <Text style={s.secondaryBtnText}>{c.step4AddLine}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={disabled}
          onPress={() => addLine(true)}
          style={[s.secondaryBtn, { flex: 1 }, disabled && { opacity: 0.5 }]}
        >
          <Text style={s.secondaryBtnText}>{c.step4AddExpense}</Text>
        </TouchableOpacity>
      </View>

      {/* Live total summary */}
      <View style={s.summaryBox}>
        <Text style={s.fieldLabel}>{c.step5GrandTotal}</Text>
        <Text style={s.summaryValue}>
          {formatMoneyCents(totals.grand_total_cents, draft.currency)}
        </Text>
      </View>
    </View>
  );
};

// ── Step 5 ────────────────────────────────────────────────────────────────

const Step5Totals: React.FC<{
  draft: Draft;
  disabled: boolean;
  totals: ReturnType<typeof computeManualInvoiceTotals>;
  onChange: (updater: (prev: Draft) => Draft) => void;
}> = ({ draft, disabled, totals, onChange }) => {
  const c = uiCopy.manualBilling;

  // Multi-currency warning
  const distinctCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const l of draft.lines) {
      if (l.currency && l.currency.toUpperCase() !== draft.currency.toUpperCase())
        set.add(l.currency.toUpperCase());
    }
    return set;
  }, [draft.lines, draft.currency]);

  return (
    <View style={s.stepCard}>
      <Text style={s.stepTitle}>{c.step5Title}</Text>
      <Text style={s.stepSubtitle}>{c.step5Subtitle}</Text>

      <View style={s.totalsBlock}>
        <TotalsRow
          label={c.step5SubtotalRates}
          value={totals.subtotal_rates_cents}
          currency={draft.currency}
        />
        <TotalsRow
          label={c.step5SubtotalExpenses}
          value={totals.subtotal_expenses_cents}
          currency={draft.currency}
        />

        <View style={s.row}>
          <View style={[s.fieldBlock, { flex: 1 }]}>
            <Text style={s.fieldLabel}>{c.step5ServiceChargeLabel}</Text>
            <TextInput
              style={s.input}
              value={draft.service_charge_pct == null ? '' : String(draft.service_charge_pct)}
              onChangeText={(v) => {
                if (v.trim() === '') {
                  onChange((prev) => ({ ...prev, service_charge_pct: null }));
                  return;
                }
                const n = parseFloat(v.replace(',', '.'));
                onChange((prev) => ({
                  ...prev,
                  service_charge_pct: Number.isFinite(n) ? n : null,
                }));
              }}
              editable={!disabled}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Text style={s.summaryRowValue}>
              {formatMoneyCents(totals.service_charge_cents, draft.currency)}
            </Text>
          </View>
        </View>

        <Text style={s.fieldLabel}>{c.step5VatBreakdown}</Text>
        {totals.vat_breakdown.length === 0 && <Text style={s.fieldHint}>—</Text>}
        {totals.vat_breakdown.map((b, i) => (
          <TotalsRow
            key={`${b.rate_percent}-${b.treatment}-${i}`}
            label={c.step5VatRow(b.rate_percent, b.treatment)}
            value={b.tax_cents}
            currency={draft.currency}
          />
        ))}
        <TotalsRow
          label={c.step5TaxTotal}
          value={totals.tax_total_cents}
          currency={draft.currency}
        />

        <View style={s.divider} />
        <TotalsRow
          label={c.step5GrandTotal}
          value={totals.grand_total_cents}
          currency={draft.currency}
          bold
        />
      </View>

      {distinctCurrencies.size > 0 && (
        <View style={s.warningBox}>
          <Text style={s.warningText}>{c.step5MultiCurrencyWarning}</Text>
        </View>
      )}

      <View style={s.toggleRow}>
        <Switch
          value={draft.reverse_charge_applied}
          onValueChange={(v) => onChange((prev) => ({ ...prev, reverse_charge_applied: v }))}
          disabled={disabled}
          trackColor={{ false: colors.border, true: colors.warning }}
        />
        <Text style={s.toggleLabel}>Mark as Reverse Charge</Text>
      </View>
      {draft.reverse_charge_applied && (
        <View style={s.warningBox}>
          <Text style={s.warningText}>{c.step5ReverseChargeWarning}</Text>
        </View>
      )}

      <View style={s.fieldBlock}>
        <Text style={s.fieldLabel}>{c.step5TaxNote}</Text>
        <TextInput
          style={[s.input, s.inputMultiline]}
          value={draft.tax_note}
          onChangeText={(v) => onChange((prev) => ({ ...prev, tax_note: v }))}
          editable={!disabled}
          multiline
        />
      </View>
      <View style={s.fieldBlock}>
        <Text style={s.fieldLabel}>{c.step5InvoiceNotes}</Text>
        <TextInput
          style={[s.input, s.inputMultiline]}
          value={draft.invoice_notes}
          onChangeText={(v) => onChange((prev) => ({ ...prev, invoice_notes: v }))}
          editable={!disabled}
          multiline
        />
      </View>
      <View style={s.fieldBlock}>
        <Text style={s.fieldLabel}>{c.step5PaymentInstructions}</Text>
        <TextInput
          style={[s.input, s.inputMultiline]}
          value={draft.payment_instructions}
          onChangeText={(v) => onChange((prev) => ({ ...prev, payment_instructions: v }))}
          editable={!disabled}
          multiline
        />
      </View>
      <View style={s.fieldBlock}>
        <Text style={s.fieldLabel}>{c.step5FooterNotes}</Text>
        <TextInput
          style={[s.input, s.inputMultiline]}
          value={draft.footer_notes}
          onChangeText={(v) => onChange((prev) => ({ ...prev, footer_notes: v }))}
          editable={!disabled}
          multiline
        />
      </View>
    </View>
  );
};

const TotalsRow: React.FC<{
  label: string;
  value: number;
  currency: string;
  bold?: boolean;
}> = ({ label, value, currency, bold }) => (
  <View style={s.totalsRow}>
    <Text style={[s.totalsLabel, bold && { fontWeight: '700' as const }]}>{label}</Text>
    <Text style={[s.totalsValue, bold && { fontWeight: '700' as const }]}>
      {formatMoneyCents(value, currency)}
    </Text>
  </View>
);

// ── Step 6 ────────────────────────────────────────────────────────────────

const Step6Preview: React.FC<{
  previewLoading: boolean;
  previewUrl: string | null;
  previewBlob: Blob | null;
  onRebuild: () => void | Promise<void>;
  isGenerated: boolean;
  invoiceNumber: string | null;
  isWeb: boolean;
  onShareNative: () => void | Promise<void>;
}> = ({
  previewLoading,
  previewUrl,
  previewBlob,
  onRebuild,
  isGenerated,
  invoiceNumber,
  isWeb,
  onShareNative,
}) => {
  const c = uiCopy.manualBilling;
  return (
    <View style={s.stepCard}>
      <Text style={s.stepTitle}>{c.step6Title}</Text>
      <Text style={s.stepSubtitle}>{c.step6Subtitle}</Text>

      {previewLoading && (
        <View style={s.loadingBlock}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={s.fieldHint}>{c.step6PreviewLoading}</Text>
        </View>
      )}

      {!previewLoading && isWeb && previewUrl ? (
        <View style={s.previewBox}>
          <iframe
            src={previewUrl}
            title="Invoice preview"
            style={{ width: '100%', height: 700, border: '1px solid #E2E0DB', borderRadius: 8 }}
          />
        </View>
      ) : null}

      {!previewLoading && !isWeb && previewBlob ? (
        <View style={s.nativePreviewFallback}>
          <Text style={s.fieldHint}>{c.step6NativePreviewUnavailable}</Text>
        </View>
      ) : null}

      <View
        style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}
      >
        <TouchableOpacity onPress={onRebuild} style={s.secondaryBtn}>
          <Text style={s.secondaryBtnText}>{c.builderPreview}</Text>
        </TouchableOpacity>
        {previewBlob && isWeb ? (
          <TouchableOpacity
            onPress={() => {
              downloadManualInvoicePdf(
                previewBlob,
                manualInvoicePdfFilename({
                  invoiceNumber,
                  isDraft: !isGenerated,
                }),
              );
            }}
            style={s.secondaryBtn}
          >
            <Text style={s.secondaryBtnText}>{c.step6Download}</Text>
          </TouchableOpacity>
        ) : null}
        {previewBlob && !isWeb ? (
          <TouchableOpacity onPress={() => void onShareNative()} style={s.secondaryBtn}>
            <Text style={s.secondaryBtnText}>{c.step6OpenPdf}</Text>
          </TouchableOpacity>
        ) : null}
        {isWeb && previewUrl ? (
          <TouchableOpacity
            onPress={() => {
              if (typeof window !== 'undefined') window.open(previewUrl, '_blank');
            }}
            style={s.secondaryBtn}
          >
            <Text style={s.secondaryBtnText}>{c.step6OpenInNewTab}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

// ── styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },

  headerBlock: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  backBtn: { marginBottom: spacing.xs },
  backBtnText: { ...typography.body, color: colors.textSecondary },
  title: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  readOnlyBanner: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.warningDark,
  },
  readOnlyBannerTitle: {
    ...typography.body,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  readOnlyBannerText: { ...typography.body, color: colors.textSecondary },

  nativePreviewFallback: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
  },

  stepCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  stepTitle: {
    ...typography.body,
    fontSize: 17,
    fontWeight: '700' as const,
    color: colors.textPrimary,
  },
  stepSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },

  fieldBlock: { marginBottom: spacing.sm },
  fieldLabel: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: 4,
    fontWeight: '500' as const,
  },
  fieldHint: { ...typography.label, color: colors.textSecondary, marginTop: 4 },
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

  choiceCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  choiceCardActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.surfaceWarm,
  },
  choiceTitle: { ...typography.body, fontWeight: '700' as const, color: colors.textPrimary },
  choiceTitleActive: { color: colors.textPrimary },
  choiceHint: { ...typography.body, color: colors.textSecondary, marginTop: 4 },
  choiceHintActive: { color: colors.textSecondary },

  pickerBlock: { marginBottom: spacing.md },
  pickerSearchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    ...typography.body,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  pickerEmptyBlock: {
    paddingVertical: spacing.xs,
  },
  pickerCount: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  sortBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: spacing.sm,
  },
  sortPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sortPillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  sortPillText: {
    ...typography.label,
    color: colors.textPrimary,
  },
  sortPillTextActive: {
    color: colors.background,
    fontWeight: '600' as const,
  },
  profileRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: 4,
    backgroundColor: colors.background,
  },
  profileRowActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  profileRowName: {
    ...typography.body,
    fontWeight: '500' as const,
    color: colors.textPrimary,
  },
  profileRowNameActive: {
    color: colors.background,
    fontWeight: '600' as const,
  },
  profileRowMeta: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: 2,
  },
  profileDefaultBadge: {
    backgroundColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  profileDefaultBadgeText: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
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

  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },

  primaryBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { ...typography.body, color: colors.background, fontWeight: '600' as const },
  secondaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  secondaryBtnText: { ...typography.body, color: colors.textPrimary },

  footerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },

  lineCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  lineFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineNet: { ...typography.body, fontWeight: '700' as const, color: colors.textPrimary },
  lineActions: { flexDirection: 'row', gap: spacing.md },
  linkBtn: { ...typography.body, color: colors.textPrimary, fontWeight: '600' as const },
  expenseTag: {
    ...typography.label,
    color: colors.warningDark,
    marginTop: 4,
  },

  summaryBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryValue: { ...typography.heading, fontSize: 18, color: colors.textPrimary },

  totalsBlock: { paddingVertical: spacing.xs },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalsLabel: { ...typography.body, color: colors.textPrimary },
  totalsValue: { ...typography.body, color: colors.textPrimary },
  summaryRowValue: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },

  warningBox: {
    backgroundColor: '#FFF7E6',
    borderRadius: 8,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    marginTop: spacing.sm,
  },
  warningText: { ...typography.body, color: colors.warningDark },

  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  toggleLabel: { ...typography.body, marginLeft: spacing.sm, color: colors.textPrimary },

  previewBox: { marginTop: spacing.sm },
  loadingBlock: { paddingVertical: spacing.lg, alignItems: 'center' },
});

export default ManualInvoiceBuilderPanel;
