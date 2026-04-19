import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { TrustPageLayout, TrustSection } from './TrustPageLayout';

export const TrustIncidentResponseView: React.FC = () => (
  <TrustPageLayout
    title={uiCopy.trust.incidentTitle}
    backTo="/trust"
    backLabel={uiCopy.trust.backToTrust}
  >
    <Text style={styles.intro}>{uiCopy.trust.incidentIntro}</Text>
    <TrustSection
      heading={uiCopy.trust.incidentDetectionTitle}
      body={uiCopy.trust.incidentDetectionBody}
    />
    <TrustSection
      heading={uiCopy.trust.incidentTriageTitle}
      body={uiCopy.trust.incidentTriageBody}
    />
    <TrustSection
      heading={uiCopy.trust.incidentContainTitle}
      body={uiCopy.trust.incidentContainBody}
    />
    <TrustSection heading={uiCopy.trust.incidentCommsTitle} body={uiCopy.trust.incidentCommsBody} />
    <TrustSection
      heading={uiCopy.trust.incidentReviewTitle}
      body={uiCopy.trust.incidentReviewBody}
    />
    <TrustSection
      heading={uiCopy.trust.incidentBreachTitle}
      body={uiCopy.trust.incidentBreachBody}
    />
    <TrustSection
      heading={uiCopy.trust.incidentReportTitle}
      body={uiCopy.trust.incidentReportBody}
    />
  </TrustPageLayout>
);

const styles = StyleSheet.create({
  intro: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
});
