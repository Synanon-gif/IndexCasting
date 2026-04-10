import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import type { DisplayStatus } from '../../utils/statusHelpers';
import { workflowLabelFromDisplayStatus } from '../../utils/negotiationWorkflowLabel';
import { formatOptionMoneyAmount } from '../../utils/optionMoneyFormat';
import { getCanonicalAgreedPrice } from '../../utils/canonicalOptionPrice';

export type NegotiationSummaryCardProps = {
  modelName: string;
  clientName?: string;
  isAgency: boolean;
  dateLine: string;
  displayStatus: DisplayStatus;
  attentionLabel: string | null;
  proposedPrice: number | undefined;
  agencyCounterPrice: number | undefined;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  finalStatus?: 'option_pending' | 'option_confirmed' | 'job_confirmed' | null;
  currency: string | undefined;
  requestTypeLabel: string;
  finalStatusLine: string | null;
  /** Optional: model availability / pre-approval context (agency); client sees null or shorter line. */
  confirmationSummaryLine?: string | null;
};

export const NegotiationSummaryCard: React.FC<NegotiationSummaryCardProps> = ({
  modelName,
  clientName,
  isAgency,
  dateLine,
  displayStatus,
  attentionLabel,
  proposedPrice,
  agencyCounterPrice,
  clientPriceStatus,
  finalStatus,
  currency,
  requestTypeLabel,
  finalStatusLine,
  confirmationSummaryLine,
}) => {
  const agreed = getCanonicalAgreedPrice({
    proposed_price: proposedPrice ?? null,
    agency_counter_price: agencyCounterPrice ?? null,
    client_price_status: clientPriceStatus ?? null,
    final_status: finalStatus ?? null,
  });
  return (
  <View style={styles.card}>
    <Text style={styles.title} numberOfLines={2}>
      {isAgency && clientName ? `${clientName} · ${modelName}` : modelName}
    </Text>
    <Text style={styles.meta}>{dateLine}</Text>
    <View style={styles.row}>
      <Text style={styles.badge}>{workflowLabelFromDisplayStatus(displayStatus)}</Text>
      {attentionLabel ? <Text style={styles.attention}>{attentionLabel}</Text> : null}
    </View>
    {finalStatusLine ? <Text style={styles.final}>{finalStatusLine}</Text> : null}
    {confirmationSummaryLine ? <Text style={styles.confirmationHint}>{confirmationSummaryLine}</Text> : null}
    <View style={styles.priceBlock}>
      {agreed != null ? (
        <Text style={styles.priceAgreed}>
          {uiCopy.optionNegotiationChat.agreedPriceLabel}: {formatOptionMoneyAmount(agreed, currency)}
        </Text>
      ) : null}
      {proposedPrice != null ? (
        <Text style={styles.price}>
          {uiCopy.optionNegotiationChat.proposedPriceLabel}: {formatOptionMoneyAmount(proposedPrice, currency)}
        </Text>
      ) : null}
      {agencyCounterPrice != null ? (
        <Text style={styles.price}>
          {uiCopy.optionNegotiationChat.counterPriceLabel}: {formatOptionMoneyAmount(agencyCounterPrice, currency)}
        </Text>
      ) : null}
    </View>
    <Text style={styles.type}>{requestTypeLabel}</Text>
  </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    textTransform: 'none',
    letterSpacing: 0,
    marginBottom: spacing.xs,
  },
  meta: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  badge: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
    backgroundColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
    textTransform: 'none',
    letterSpacing: 0,
  },
  attention: {
    ...typography.label,
    fontSize: 11,
    color: colors.accentBrown,
    textTransform: 'none',
    letterSpacing: 0,
  },
  final: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'none',
    letterSpacing: 0,
  },
  confirmationHint: {
    ...typography.label,
    fontSize: 11,
    color: colors.accentBrown,
    marginBottom: spacing.xs,
    textTransform: 'none',
    letterSpacing: 0,
  },
  priceBlock: {
    gap: 4,
    marginTop: spacing.xs,
  },
  priceAgreed: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  price: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  type: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textTransform: 'none',
    letterSpacing: 0,
  },
});
