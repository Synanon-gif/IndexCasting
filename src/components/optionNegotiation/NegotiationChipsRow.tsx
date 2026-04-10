import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import type { DisplayStatus } from '../../utils/statusHelpers';
import { statusBgColor, statusColor } from '../../utils/statusHelpers';
import { workflowLabelFromDisplayStatus } from '../../utils/negotiationWorkflowLabel';
import { formatOptionMoneyAmount } from '../../utils/optionMoneyFormat';
import { getCanonicalAgreedPrice } from '../../utils/canonicalOptionPrice';

export type NegotiationChipsRowProps = {
  displayStatus: DisplayStatus;
  attentionLabel: string | null;
  proposedPrice: number | undefined;
  agencyCounterPrice: number | undefined;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  finalStatus?: 'option_pending' | 'option_confirmed' | 'job_confirmed' | null;
  currency: string | undefined;
};

export const NegotiationChipsRow: React.FC<NegotiationChipsRowProps> = ({
  displayStatus,
  attentionLabel,
  proposedPrice,
  agencyCounterPrice,
  clientPriceStatus,
  finalStatus,
  currency,
}) => {
  const agreed = getCanonicalAgreedPrice({
    proposed_price: proposedPrice ?? null,
    agency_counter_price: agencyCounterPrice ?? null,
    client_price_status: clientPriceStatus ?? null,
    final_status: finalStatus ?? null,
  });
  const wfLabel = workflowLabelFromDisplayStatus(displayStatus);
  const wfColor = statusColor(displayStatus);
  const wfBg = statusBgColor(displayStatus);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.chip, { backgroundColor: wfBg, borderColor: wfColor }]}>
          <Text style={[styles.chipText, { color: wfColor }]} numberOfLines={1}>
            {wfLabel}
          </Text>
        </View>
        {attentionLabel ? (
          <View style={[styles.chip, styles.attentionChip]}>
            <Text style={styles.attentionText} numberOfLines={2}>
              {attentionLabel}
            </Text>
          </View>
        ) : null}
      </View>
      {(agreed != null || proposedPrice != null || agencyCounterPrice != null) && (
        <View style={styles.priceCol}>
          {agreed != null ? (
            <Text style={styles.priceLineAgreed}>
              {uiCopy.optionNegotiationChat.agreedPriceLabel}: {formatOptionMoneyAmount(agreed, currency)}
            </Text>
          ) : null}
          {proposedPrice != null ? (
            <Text style={styles.priceLine}>
              {uiCopy.optionNegotiationChat.proposedPriceLabel}: {formatOptionMoneyAmount(proposedPrice, currency)}
            </Text>
          ) : null}
          {agencyCounterPrice != null ? (
            <Text style={styles.priceLine}>
              {uiCopy.optionNegotiationChat.counterPriceLabel}: {formatOptionMoneyAmount(agencyCounterPrice, currency)}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  chipText: {
    ...typography.label,
    fontSize: 11,
    textTransform: 'none',
    letterSpacing: 0,
    fontWeight: '600',
  },
  attentionChip: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderColor: 'rgba(59, 130, 246, 0.35)',
  },
  attentionText: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
    textTransform: 'none',
    letterSpacing: 0,
    maxWidth: 220,
  },
  priceCol: {
    gap: 2,
  },
  priceLine: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'none',
    letterSpacing: 0,
  },
  priceLineAgreed: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '700',
    textTransform: 'none',
    letterSpacing: 0,
  },
});
