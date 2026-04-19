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
 *
 * Search / filter / pagination model
 * ----------------------------------
 *  - Server: cursor (keyset) pagination — `created_at DESC, id DESC`. Page size
 *    `PAGE_SIZE`. „Load more“ uses the last loaded row's `created_at`/`id` as
 *    the next cursor (see `listInvoicesForOrganization` / `listInvoicesForRecipient`).
 *  - Server status filter: still tied to the active tab (drafts/sent/paid/overdue/received).
 *  - Client: free-text search (number/recipient/notes) + type-filter (multi) +
 *    currency-filter (single) + year-grouping. Filters apply to the rows that
 *    have already been loaded — older matches require `Load more`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

const PAGE_SIZE = 50;

const ALL_TYPES: InvoiceType[] = [
  'agency_to_client',
  'agency_to_agency',
  'platform_to_agency',
  'platform_to_client',
];

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

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
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
    case 'agency_to_agency':
      return inv.typeAgencyToAgency;
    case 'platform_to_agency':
      return inv.typePlatformToAgency;
    case 'platform_to_client':
      return inv.typePlatformToClient;
    default:
      return t;
  }
}

function recipientHaystack(r: InvoiceRow): string {
  // Recipient profile snapshot is jsonb — pull common fields safely.
  const snap = (r as unknown as { recipient_profile_snapshot?: Record<string, unknown> })
    .recipient_profile_snapshot;
  if (!snap || typeof snap !== 'object') return '';
  const parts: string[] = [];
  for (const key of ['legal_name', 'display_name', 'company_name', 'name']) {
    const v = snap[key];
    if (typeof v === 'string') parts.push(v);
  }
  return parts.join(' ');
}

export const InvoicesPanel: React.FC<Props> = ({ organizationId }) => {
  const { profile } = useAuth();
  const inv = uiCopy.invoices;
  const isOwner = isOrganizationOwner(profile?.org_member_role);

  const [tab, setTab] = useState<Tab>('drafts');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Client-side filters — apply to loaded rows.
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<InvoiceType>>(new Set());
  const [currencyFilter, setCurrencyFilter] = useState<string | null>(null);

  const statusesForTab = useCallback((t: Tab): InvoiceStatus[] | undefined => {
    if (t === 'received') {
      // Match RLS policy invoices_recipient_owner_select: recipient owners may
      // see all non-draft, non-pending_send statuses including void/uncollectible
      // (otherwise voided invoices the recipient previously saw would silently
      // disappear from their UI — audit-trail regression).
      return ['sent', 'paid', 'overdue', 'void', 'uncollectible'];
    }
    const map: Record<Exclude<Tab, 'received'>, InvoiceStatus[] | undefined> = {
      drafts: ['draft', 'pending_send'],
      sent: ['sent'],
      paid: ['paid'],
      overdue: ['overdue'],
    };
    return map[t];
  }, []);

  const fetchPage = useCallback(
    async (
      orgId: string,
      activeTab: Tab,
      cursor?: { createdAt: string; id: string } | null,
    ): Promise<InvoiceRow[]> => {
      const opts = {
        statuses: statusesForTab(activeTab),
        limit: PAGE_SIZE,
        cursorCreatedAt: cursor?.createdAt ?? null,
        cursorId: cursor?.id ?? null,
      };
      if (activeTab === 'received') {
        return await listInvoicesForRecipient(orgId, opts);
      }
      return await listInvoicesForOrganization(orgId, opts);
    },
    [statusesForTab],
  );

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const data = await fetchPage(organizationId, tab, null);
      setRows(data);
      setHasMore(data.length >= PAGE_SIZE);
    } catch (e) {
      console.error('[InvoicesPanel] load', e);
      showAppAlert(uiCopy.common.error, inv.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [organizationId, tab, fetchPage, inv.loadFailed]);

  const loadMore = useCallback(async () => {
    if (!organizationId || loadingMore || loading || !hasMore) return;
    const last = rows[rows.length - 1];
    if (!last || !last.created_at) {
      setHasMore(false);
      return;
    }
    setLoadingMore(true);
    try {
      const more = await fetchPage(organizationId, tab, {
        createdAt: last.created_at,
        id: last.id,
      });
      // Defensive dedupe in case of cursor edge cases (identical created_at + id).
      const seen = new Set(rows.map((r) => r.id));
      const fresh = more.filter((r) => !seen.has(r.id));
      setRows((prev) => [...prev, ...fresh]);
      setHasMore(more.length >= PAGE_SIZE);
    } catch (e) {
      console.error('[InvoicesPanel] loadMore', e);
      showAppAlert(uiCopy.common.error, inv.loadFailed);
    } finally {
      setLoadingMore(false);
    }
  }, [organizationId, tab, fetchPage, rows, hasMore, loadingMore, loading, inv.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset filters/cursor when the tab changes — `load` already resets `rows`.
  useEffect(() => {
    setSearchQuery('');
    setTypeFilter(new Set());
    setCurrencyFilter(null);
  }, [tab]);

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

  // ── Filter + Group ────────────────────────────────────────────────────────
  const availableCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.currency);
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter.size > 0 && !typeFilter.has(r.invoice_type)) return false;
      if (currencyFilter && r.currency !== currencyFilter) return false;
      if (q) {
        const hay = [r.invoice_number ?? '', r.notes ?? '', recipientHaystack(r)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, searchQuery, typeFilter, currencyFilter]);

  const groupedByYear = useMemo(() => {
    const groups = new Map<number | 'unknown', InvoiceRow[]>();
    for (const r of filteredRows) {
      const y = yearOf(r.created_at) ?? 'unknown';
      const list = groups.get(y) ?? [];
      list.push(r);
      groups.set(y, list);
    }
    // Sort year keys descending; 'unknown' last.
    const entries = Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === 'unknown') return 1;
      if (b[0] === 'unknown') return -1;
      return (b[0] as number) - (a[0] as number);
    });
    return entries;
  }, [filteredRows]);

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

  const filtersActive =
    searchQuery.trim().length > 0 || typeFilter.size > 0 || currencyFilter !== null;

  const toggleType = (t: InvoiceType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const clearFilters = () => {
    setSearchQuery('');
    setTypeFilter(new Set());
    setCurrencyFilter(null);
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

      {/* Search + filters — visible once initial load is finished. */}
      {!loading && rows.length > 0 && (
        <View style={styles.filtersWrap}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={inv.searchPlaceholder}
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
          />
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>{inv.filterTypeLabel}</Text>
            <View style={styles.filterPills}>
              {ALL_TYPES.map((t) => {
                const active = typeFilter.has(t);
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.filterPill, active && styles.filterPillActive]}
                    onPress={() => toggleType(t)}
                  >
                    <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                      {typeLabel(t)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          {availableCurrencies.length > 1 && (
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>{inv.filterCurrencyLabel}</Text>
              <View style={styles.filterPills}>
                <TouchableOpacity
                  style={[styles.filterPill, currencyFilter === null && styles.filterPillActive]}
                  onPress={() => setCurrencyFilter(null)}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      currencyFilter === null && styles.filterPillTextActive,
                    ]}
                  >
                    {inv.filterAllCurrencies}
                  </Text>
                </TouchableOpacity>
                {availableCurrencies.map((c) => {
                  const active = currencyFilter === c;
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.filterPill, active && styles.filterPillActive]}
                      onPress={() => setCurrencyFilter(active ? null : c)}
                    >
                      <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                        {c}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
          {filtersActive && (
            <TouchableOpacity style={styles.clearFiltersBtn} onPress={clearFilters}>
              <Text style={styles.clearFiltersText}>{inv.filterClear}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.hint}>{inv.loading}</Text>
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>{emptyText[tab]}</Text>
      ) : filteredRows.length === 0 ? (
        <Text style={styles.empty}>{inv.emptyFiltered}</Text>
      ) : (
        <View style={styles.list}>
          {groupedByYear.map(([year, group]) => (
            <View key={String(year)} style={styles.yearGroup}>
              <Text style={styles.yearHeader}>{inv.yearGroupLabel(year)}</Text>
              {group.map((r) => (
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
                      <TouchableOpacity
                        onPress={() => onRetrySend(r)}
                        disabled={retryingId === r.id}
                      >
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
          ))}

          {/* Load more — visible only when the server signals more pages exist. */}
          {hasMore && (
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={() => void loadMore()}
              disabled={loadingMore}
            >
              <Text style={styles.loadMoreText}>
                {loadingMore ? inv.loadingMore : inv.loadMore}
              </Text>
            </TouchableOpacity>
          )}
          {!hasMore && rows.length > PAGE_SIZE && (
            <Text style={styles.noMoreText}>{inv.noMore}</Text>
          )}
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
  filtersWrap: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  filterLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  filterPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flexShrink: 1,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterPillActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.textPrimary,
  },
  filterPillText: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  filterPillTextActive: { color: colors.textPrimary },
  clearFiltersBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  clearFiltersText: { ...typography.label, fontSize: 11, color: colors.accentGreen },
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
  yearGroup: { gap: 4 },
  yearHeader: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
    paddingTop: spacing.xs,
    paddingBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
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
  loadMoreBtn: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  loadMoreText: { ...typography.label, fontSize: 12, color: colors.textPrimary },
  noMoreText: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  refreshBtn: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  refreshText: { ...typography.label, color: colors.textSecondary, fontSize: 12 },
});
