import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { TrustPageLayout } from './TrustPageLayout';
import { navigatePublicPath } from '../../utils/publicLegalRoutes';

type CardProps = {
  title: string;
  body: string;
  onPress: () => void;
};

const TrustCard: React.FC<CardProps> = ({ title, body, onPress }) => (
  <TouchableOpacity
    style={styles.card}
    onPress={onPress}
    accessibilityRole="link"
    accessibilityLabel={title}
  >
    <Text style={styles.cardTitle}>{title}</Text>
    <Text style={styles.cardBody}>{body}</Text>
  </TouchableOpacity>
);

/**
 * Public Trust Center landing page (/trust). Lists the four documentation pillars,
 * a status-page link, and a contact line. Renders without authentication.
 */
export const TrustCenterView: React.FC = () => (
  <TrustPageLayout title={uiCopy.trust.centerTitle}>
    <Text style={styles.subtitle}>{uiCopy.trust.centerSubtitle}</Text>
    <Text style={styles.intro}>{uiCopy.trust.centerIntro}</Text>

    <View style={styles.grid}>
      <TrustCard
        title={uiCopy.trust.cardSecurityTitle}
        body={uiCopy.trust.cardSecurityBody}
        onPress={() => navigatePublicPath('/trust/security')}
      />
      <TrustCard
        title={uiCopy.trust.cardDpaTitle}
        body={uiCopy.trust.cardDpaBody}
        onPress={() => navigatePublicPath('/trust/dpa')}
      />
      <TrustCard
        title={uiCopy.trust.cardSubprocessorsTitle}
        body={uiCopy.trust.cardSubprocessorsBody}
        onPress={() => navigatePublicPath('/trust/subprocessors')}
      />
      <TrustCard
        title={uiCopy.trust.cardGdprTitle}
        body={uiCopy.trust.cardGdprBody}
        onPress={() => navigatePublicPath('/trust/gdpr')}
      />
      <TrustCard
        title={uiCopy.trust.cardIncidentTitle}
        body={uiCopy.trust.cardIncidentBody}
        onPress={() => navigatePublicPath('/trust/incident-response')}
      />
      <TrustCard
        title={uiCopy.trust.cardStatusTitle}
        body={uiCopy.trust.cardStatusBody}
        onPress={() => navigatePublicPath('/status')}
      />
    </View>

    <View style={styles.contactRow}>
      <Text style={styles.contactLabel}>{uiCopy.trust.contactLabel}</Text>
      <Text style={styles.contactValue}>{uiCopy.trust.contactEmail}</Text>
    </View>
  </TrustPageLayout>
);

const styles = StyleSheet.create({
  subtitle: {
    ...typography.body,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  card: {
    flexBasis: '100%',
    minWidth: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: 6,
  },
  cardTitle: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  cardBody: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  contactRow: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  contactLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  contactValue: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
