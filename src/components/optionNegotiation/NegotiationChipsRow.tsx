import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import type { DisplayStatus } from '../../utils/statusHelpers';
import { statusBgColor, statusColor } from '../../utils/statusHelpers';
import { workflowLabelFromDisplayStatus } from '../../utils/negotiationWorkflowLabel';
import { formatOptionMoneyAmount } from '../../utils/optionMoneyFormat';

export type NegotiationChipsRowProps = {
  displayStatus: DisplayStatus;
  attentionLabel: string | null;
  proposedPrice: number | undefined;
  agencyCounterPrice: number | undefined;
  currency: string | undefined;
};

export const NegotiationChipsRow: React.FC<NegotiationChipsRowProps> = ({
  displayStatus,
  attentionLabel,
  proposedPrice,
  agencyCounterPrice,
  currency,
}) => {
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
      {(proposedPrice != null || agencyCounterPrice != null) && (
        <View style={styles.priceCol}>
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
});
