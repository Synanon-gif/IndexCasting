/**
 * ManualInvoiceListPanel — drafts + generated manual invoices.
 *
 * Filterable by status. Re-opens drafts in the builder. Generated invoices
 * are read-only here (Phase 1) — re-export PDF lives inside the builder's
 * preview screen, reachable via "edit / view".
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, spacing, typography } from '../../../theme/theme';
import { uiCopy } from '../../../constants/uiCopy';
import { showAppAlert, showConfirmAlert } from '../../../utils/crossPlatformAlert';
import {
  deleteManualInvoiceDraft,
  listManualInvoices,
} from '../../../services/manualInvoicesSupabase';
import { formatMoneyCents } from '../../../utils/manualInvoiceTotals';
import type { ManualInvoiceRow, ManualInvoiceStatus } from '../../../types/manualBillingTypes';

type Props = {
  agencyOrganizationId: string;
  onBack: () => void;
  onCreateNew: () => void;
  onEdit: (invoiceId: string) => void;
};

type Filter = 'all' | ManualInvoiceStatus;

export const ManualInvoiceListPanel: React.FC<Props> = ({
  agencyOrganizationId,
  onBack,
  onCreateNew,
  onEdit,
}) => {
  const c = uiCopy.manualBilling;

  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ManualInvoiceRow[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listManualInvoices(agencyOrganizationId);
      setRows(r);
    } finally {
      setLoading(false);
    }
  }, [agencyOrganizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={s.headerBlock}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" style={s.backBtn}>
          <Text style={s.backBtnText}>‹ {c.backToBilling}</Text>
        </TouchableOpacity>
        <Text style={s.title}>{c.invoicesScreenTitle}</Text>
        <Text style={s.subtitle}>{c.invoicesScreenSubtitle}</Text>
      </View>

      <View style={s.filterRow}>
        {(
          [
            { v: 'all', label: c.invoicesFilterAll },
            { v: 'draft', label: c.invoicesFilterDraft },
            { v: 'generated', label: c.invoicesFilterGenerated },
          ] as Array<{ v: Filter; label: string }>
        ).map((opt) => {
          const active = filter === opt.v;
          return (
            <TouchableOpacity
              key={opt.v}
              onPress={() => setFilter(opt.v)}
              style={[s.filterPill, active && s.filterPillActive]}
            >
              <Text style={[s.filterPillText, active && s.filterPillTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={s.primaryBtn} onPress={onCreateNew}>
          <Text style={s.primaryBtnText}>{c.invoicesNew}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.loadingBlock}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : filtered.length === 0 ? (
        <Text style={s.emptyText}>{c.invoicesEmpty}</Text>
      ) : (
        filtered.map((row) => (
          <Card
            key={row.id}
            row={row}
            onEdit={() => onEdit(row.id)}
            onDelete={() => {
              if (row.status !== 'draft') {
                showAppAlert(c.invoiceCannotDeleteGenerated);
                return;
              }
              showConfirmAlert(
                c.invoiceDeleteDraftConfirmTitle,
                c.invoiceDeleteDraftConfirmBody,
                async () => {
                  const ok = await deleteManualInvoiceDraft(agencyOrganizationId, row.id);
                  if (!ok) showAppAlert(c.errorBuilderSaveFailed);
                  else await reload();
                },
                c.invoiceDeleteDraft,
              );
            }}
          />
        ))
      )}
    </ScrollView>
  );
};

const Card: React.FC<{
  row: ManualInvoiceRow;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ row, onEdit, onDelete }) => {
  const c = uiCopy.manualBilling;
  const directionLabel =
    row.direction === 'agency_to_client'
      ? c.invoiceDirectionAgencyClient
      : row.direction === 'agency_to_model'
        ? c.invoiceDirectionAgencyModel
        : c.invoiceDirectionModelAgency;
  const statusLabel =
    row.status === 'draft'
      ? c.invoiceStatusDraft
      : row.status === 'generated'
        ? c.invoiceStatusGenerated
        : c.invoiceStatusVoid;
  const recipientName = recipientFromRow(row);
  return (
    <View style={s.card}>
      <TouchableOpacity onPress={onEdit} accessibilityRole="button">
        <View style={s.cardHeaderRow}>
          <Text style={s.cardTitle}>{row.invoice_number ?? '— no number yet —'}</Text>
          <View style={[s.statusBadge, statusBadgeStyle(row.status)]}>
            <Text style={s.statusBadgeText}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={s.cardSub}>
          {directionLabel}
          {recipientName ? ` • ${recipientName}` : ''}
        </Text>
        <Text style={s.cardMeta}>
          {[
            row.issue_date ? formatDateOnly(row.issue_date) : null,
            formatMoneyCents(row.grand_total_cents, row.currency),
          ]
            .filter(Boolean)
            .join(' • ')}
        </Text>
      </TouchableOpacity>
      <View style={s.cardActions}>
        <TouchableOpacity onPress={onEdit}>
          <Text style={s.linkBtn}>{row.status === 'draft' ? 'Open draft' : 'Open invoice'}</Text>
        </TouchableOpacity>
        {row.status === 'draft' && (
          <TouchableOpacity onPress={onDelete}>
            <Text style={[s.linkBtn, { color: colors.errorDark }]}>{c.invoiceDeleteDraft}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

function recipientFromRow(row: ManualInvoiceRow): string | null {
  const snap = row.recipient_snapshot as Record<string, unknown> | null;
  if (!snap) return null;
  const legal = (snap.legal_name as string | undefined) ?? null;
  const display = (snap.display_name as string | undefined) ?? null;
  return display ?? legal;
}

function statusBadgeStyle(status: ManualInvoiceStatus): { backgroundColor: string } {
  switch (status) {
    case 'generated':
      return { backgroundColor: colors.success };
    case 'draft':
      return { backgroundColor: colors.warning };
    case 'void':
      return { backgroundColor: colors.borderLight };
  }
}

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : String(iso);
}

const s = StyleSheet.create({
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

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterPillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  filterPillText: { ...typography.body, color: colors.textPrimary },
  filterPillTextActive: { color: colors.background, fontWeight: '600' as const },

  primaryBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  primaryBtnText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600' as const,
  },

  loadingBlock: { paddingVertical: spacing.lg, alignItems: 'center' },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

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
    alignItems: 'center',
  },
  cardTitle: {
    ...typography.body,
    fontWeight: '700' as const,
    color: colors.textPrimary,
  },
  cardSub: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  cardMeta: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  linkBtn: { ...typography.body, color: colors.textPrimary, fontWeight: '600' as const },

  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: {
    ...typography.label,
    fontSize: 10,
    color: colors.background,
  },
});

export default ManualInvoiceListPanel;
