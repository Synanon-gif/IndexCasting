/**
 * BillingAttentionWidget — compact dashboard card showing billing Smart Attention
 * for the current org.
 *
 * Shares its data source with the Billing tab badge via `useBillingTabBadge` so
 * derivation stays canonical. Renders nothing when there are no signals visible
 * to the role (mirrors Messages tab dot semantics — no noise when clean).
 *
 * Surfaces:
 *   - Title with severity color
 *   - Up to 4 top signals (severity-sorted)
 *   - "+N more" footer when overflow
 *   - Press → opens Billing tab via `onOpenBilling`
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { useBillingTabBadge } from '../../hooks/useBillingTabBadge';
import {
  type BillingAttentionCategory,
  type BillingAttentionRole,
  type BillingAttentionSeverity,
  filterBillingAttentionForRole,
} from '../../utils/billingAttention';

export type BillingAttentionWidgetProps = {
  organizationId: string | null | undefined;
  variant: 'agency' | 'client';
  role: BillingAttentionRole;
  onOpenBilling: () => void;
};

const SEVERITY_COLOR: Record<BillingAttentionSeverity, string> = {
  critical: colors.errorDark,
  high: colors.warningDark,
  medium: colors.warning,
  low: colors.textSecondary,
};

const SEVERITY_RANK: Record<BillingAttentionSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function labelForCategory(category: BillingAttentionCategory): string {
  const hub = uiCopy.billingHub;
  switch (category) {
    case 'invoice_overdue':
      return hub.attentionCategoryInvoiceOverdue;
    case 'invoice_unpaid':
      return hub.attentionCategoryInvoiceUnpaid;
    case 'invoice_draft_pending':
      return hub.attentionCategoryInvoiceDraftPending;
    case 'invoice_pending_send':
      return hub.attentionCategoryInvoicePendingSend;
    case 'invoice_payment_failed':
      return hub.attentionCategoryInvoicePaymentFailed;
    case 'invoice_missing_recipient_data':
      return hub.attentionCategoryInvoiceMissingRecipientData;
    case 'invoice_received_unpaid':
      return hub.attentionCategoryInvoiceReceivedUnpaid;
    case 'invoice_received_overdue':
      return hub.attentionCategoryInvoiceReceivedOverdue;
    case 'settlement_draft_pending':
      return hub.attentionCategorySettlementDraftPending;
    case 'settlement_recorded_unpaid':
      return hub.attentionCategorySettlementRecordedUnpaid;
    case 'billing_profile_missing':
      return hub.attentionCategoryBillingProfileMissing;
  }
}

export const BillingAttentionWidget: React.FC<BillingAttentionWidgetProps> = ({
  organizationId,
  variant,
  role,
  onOpenBilling,
}) => {
  const { signals, topSeverity, hasBadge } = useBillingTabBadge({
    organizationId,
    variant,
    role,
  });

  if (!hasBadge || !topSeverity) return null;

  // Filter to role-visible signals and sort by severity (critical first).
  const visible = filterBillingAttentionForRole(signals, role).sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  const top = visible.slice(0, 4);
  const overflow = visible.length - top.length;
  const accent = SEVERITY_COLOR[topSeverity];
  const hub = uiCopy.billingHub;

  return (
    <TouchableOpacity
      onPress={onOpenBilling}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={hub.attentionBannerTitle}
      style={[s.card, { borderLeftColor: accent }]}
    >
      <View style={s.headerRow}>
        <Text style={[s.title, { color: accent }]}>{hub.attentionBannerTitle}</Text>
        <Text style={s.cta}>{hub.tabLabel} ›</Text>
      </View>
      {top.map((sig) => (
        <Text
          key={`${sig.category}:${sig.sourceId}`}
          style={s.row}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          • {labelForCategory(sig.category)}
          {sig.displayNumber ? ` — ${sig.displayNumber}` : ''}
        </Text>
      ))}
      {overflow > 0 && <Text style={s.more}>+{overflow} more</Text>}
    </TouchableOpacity>
  );
};

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cta: {
    fontSize: 12,
    color: colors.accentBrown,
    fontWeight: '600',
  },
  row: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    marginTop: 2,
  },
  more: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
});

export default BillingAttentionWidget;
