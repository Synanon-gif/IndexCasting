/**
 * Invoices panel (Owner-only B2B invoicing).
 *
 * Tabs: Drafts | Sent | Paid | Overdue | Received
 * - Outgoing tabs (Drafts/Sent/Paid/Overdue) read invoices issued by the org.
 * - Received tab reads invoices addressed TO the org (recipient_organization_id).
 *
 * Owner-only writes; non-owners see read-only lists (RLS still applies).
 *
 * Mount once per org context (agency or client). Do not mount in model workspace
 * (model billing firewall — see billing-payment-invariants.mdc, I-PAY-10).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { isOrganizationOwner } from '../services/orgRoleTypes';
import { useAuth } from '../context/AuthContext';
import {
  deleteInvoiceDraft,
  listInvoicesForOrganization,
  listInvoicesForRecipient,
  sendInvoiceViaStripe,
} from '../services/invoicesSupabase';
import type { InvoiceRow, InvoiceStatus, InvoiceType } from '../types/billingTypes';
import { showAppAlert, showConfirmAlert } from '../utils/crossPlatformAlert';
import { InvoiceDraftEditor } from './InvoiceDraftEditor';

type Tab = 'drafts' | 'sent' | 'paid' | 'overdue' | 'received';

type Props = {
  organizationId: string | null;
};

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
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

function statusLabel(status: InvoiceStatus): string {
  const inv = uiCopy.invoices;
  switch (status) {
    case 'draft':
      return inv.statusDraft;
    case 'pending_send':
      return inv.statusPendingSend;
    case 'sent':
      return inv.statusSent;
    case 'paid':
      return inv.statusPaid;
    case 'overdue':
      return inv.statusOverdue;
    case 'void':
      return inv.statusVoid;
    case 'uncollectible':
      return inv.statusUncollectible;
    default:
      return status;
  }
}

function typeLabel(t: InvoiceType): string {
  const inv = uiCopy.invoices;
  switch (t) {
    case 'agency_to_client':
      return inv.typeAgencyToClient;
    case 'platform_to_agency':
      return inv.typePlatformToAgency;
    case 'platform_to_client':
      return inv.typePlatformToClient;
    default:
      return t;
  }
}

export const InvoicesPanel: React.FC<Props> = ({ organizationId }) => {
  const { profile } = useAuth();
  const inv = uiCopy.invoices;
  const isOwner = isOrganizationOwner(profile?.org_member_role);

  const [tab, setTab] = useState<Tab>('drafts');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      let data: InvoiceRow[] = [];
      if (tab === 'received') {
        // Match RLS policy invoices_recipient_owner_select: recipient owners may
        // see all non-draft, non-pending_send statuses including void/uncollectible
        // (otherwise voided invoices the recipient previously saw would silently
        // disappear from their UI — audit-trail regression).
        data = await listInvoicesForRecipient(organizationId, {
          statuses: ['sent', 'paid', 'overdue', 'void', 'uncollectible'],
        });
      } else {
        const statusMap: Record<Tab, InvoiceStatus[] | undefined> = {
          drafts: ['draft', 'pending_send'],
          sent: ['sent'],
          paid: ['paid'],
          overdue: ['overdue'],
          received: undefined,
        };
        data = await listInvoicesForOrganization(organizationId, {
          statuses: statusMap[tab],
        });
      }
      setRows(data);
    } catch (e) {
      console.error('[InvoicesPanel] load', e);
      showAppAlert(uiCopy.common.error, inv.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [organizationId, tab, inv.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo<Array<{ id: Tab; label: string }>>(
    () => [
      { id: 'drafts', label: inv.tabDrafts },
      { id: 'sent', label: inv.tabSent },
      { id: 'paid', label: inv.tabPaid },
      { id: 'overdue', label: inv.tabOverdue },
      { id: 'received', label: inv.tabReceived },
    ],
    [inv],
  );

  const onDelete = useCallback(
    (row: InvoiceRow) => {
      if (!isOwner) return;
      const run = async () => {
        const ok = await deleteInvoiceDraft(row.id);
        if (ok) {
          showAppAlert(uiCopy.common.success, inv.deleteSuccess);
          await load();
        } else {
          showAppAlert(uiCopy.common.error, inv.deleteFailed);
        }
      };
      showConfirmAlert(
        inv.deleteConfirmTitle,
        inv.deleteConfirmMessage,
        () => void run(),
        uiCopy.common.delete,
      );
    },
    [isOwner, load, inv],
  );

  // Recovery for invoices stuck in 'pending_send' (Stripe call interrupted before
  // local status was advanced). The send-invoice-via-stripe Edge Function is
  // idempotent on pending_send: it skips the pre-lock and reuses the already
  // assigned invoice_number — no duplicate Stripe invoice / no number gap.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const onRetrySend = useCallback(
    (row: InvoiceRow) => {
      if (!isOwner || row.status !== 'pending_send') return;
      const run = async () => {
        setRetryingId(row.id);
        try {
          const res = await sendInvoiceViaStripe(row.id);
          if (res.ok) {
            showAppAlert(uiCopy.common.success, inv.sendSuccess);
            await load();
          } else {
            showAppAlert(uiCopy.common.error, res.error ?? inv.sendFailed);
          }
        } finally {
          setRetryingId(null);
        }
      };
      showConfirmAlert(
        inv.retrySendConfirmTitle,
        inv.retrySendConfirmMessage,
        () => void run(),
        inv.retrySend,
      );
    },
    [isOwner, load, inv],
  );

  if (!organizationId) return null;

  if (openDraftId || createOpen) {
    return (
      <InvoiceDraftEditor
        organizationId={organizationId}
        invoiceId={openDraftId}
        onClose={() => {
          setOpenDraftId(null);
          setCreateOpen(false);
          void load();
        }}
      />
    );
  }

  const emptyText: Record<Tab, string> = {
    drafts: inv.emptyDrafts,
    sent: inv.emptySent,
    paid: inv.emptyPaid,
    overdue: inv.emptyOverdue,
    received: inv.emptyReceived,
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>{inv.cardTitle}</Text>
        {isOwner && tab === 'drafts' && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setCreateOpen(true)}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>{inv.createDraft}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.intro}>{inv.intro}</Text>
      {!isOwner && <Text style={styles.hint}>{inv.ownerOnlyHint}</Text>}

      <View style={styles.tabsRow}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tab, tab === t.id && styles.tabActive]}
            onPress={() => setTab(t.id)}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.hint}>{inv.loading}</Text>
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>{emptyText[tab]}</Text>
      ) : (
        <View style={styles.list}>
          {rows.map((r) => (
            <View key={r.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTopLine}>
                  <Text style={styles.invoiceNo} numberOfLines={1}>
                    {r.invoice_number ?? inv.invoiceNumberPending}
                  </Text>
                  <Text style={styles.statusPill}>{statusLabel(r.status)}</Text>
                </View>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {typeLabel(r.invoice_type)} · {formatDate(r.created_at)}
                  {r.due_date ? ` · ${inv.listColDue} ${formatDate(r.due_date)}` : ''}
                </Text>
                <Text style={styles.rowAmount}>
                  {formatCents(r.total_amount_cents, r.currency)}
                </Text>
              </View>
              <View style={styles.rowActions}>
                {r.status === 'draft' && isOwner && (
                  <>
                    <TouchableOpacity onPress={() => setOpenDraftId(r.id)}>
                      <Text style={styles.linkAction}>{inv.openDraft}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onDelete(r)}>
                      <Text style={styles.linkDanger}>{inv.delete}</Text>
                    </TouchableOpacity>
                  </>
                )}
                {r.status === 'pending_send' && isOwner && (
                  <TouchableOpacity onPress={() => onRetrySend(r)} disabled={retryingId === r.id}>
                    <Text style={styles.linkAction}>
                      {retryingId === r.id ? inv.sendingViaStripe : inv.retrySend}
                    </Text>
                  </TouchableOpacity>
                )}
                {r.status !== 'draft' && r.stripe_hosted_url && Platform.OS === 'web' && (
                  <TouchableOpacity
                    onPress={() => {
                      if (typeof window !== 'undefined') {
                        window.open(r.stripe_hosted_url!, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    <Text style={styles.linkAction}>{inv.viewHostedStripe}</Text>
                  </TouchableOpacity>
                )}
                {r.status !== 'draft' && r.stripe_pdf_url && Platform.OS === 'web' && (
                  <TouchableOpacity
                    onPress={() => {
                      if (typeof window !== 'undefined') {
                        window.open(r.stripe_pdf_url!, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    <Text style={styles.linkAction}>{inv.viewPdf}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.refreshBtn} onPress={() => void load()} disabled={loading}>
        <Text style={styles.refreshText}>{inv.refresh}</Text>
      </TouchableOpacity>
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
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.textPrimary,
  },
  tabText: { ...typography.label, fontSize: 12, color: colors.textSecondary },
  tabTextActive: { color: colors.textPrimary },
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
  },
  primaryBtnText: { ...typography.label, color: colors.surface, fontSize: 12 },
  refreshBtn: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  refreshText: { ...typography.label, color: colors.textSecondary, fontSize: 12 },
});
