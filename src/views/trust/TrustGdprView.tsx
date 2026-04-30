import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { TrustPageLayout, TrustSection } from './TrustPageLayout';

export const TrustGdprView: React.FC = () => (
  <TrustPageLayout
    title={uiCopy.trust.gdprTitle}
    backTo="/trust"
    backLabel={uiCopy.trust.backToTrust}
  >
    <Text style={styles.intro}>{uiCopy.trust.gdprIntro}</Text>
    <TrustSection heading={uiCopy.trust.gdprAccessTitle} body={uiCopy.trust.gdprAccessBody} />
    <TrustSection
      heading={uiCopy.trust.gdprRectificationTitle}
      body={uiCopy.trust.gdprRectificationBody}
    />
    <TrustSection heading={uiCopy.trust.gdprErasureTitle} body={uiCopy.trust.gdprErasureBody} />
    <TrustSection
      heading={uiCopy.trust.gdprPortabilityTitle}
      body={uiCopy.trust.gdprPortabilityBody}
    />
    <TrustSection heading={uiCopy.trust.gdprObjectTitle} body={uiCopy.trust.gdprObjectBody} />
    <TrustSection
      heading={uiCopy.trust.gdprAiAssistantTitle}
      body={uiCopy.trust.gdprAiAssistantBody}
    />
    <TrustSection heading={uiCopy.trust.gdprMinorsTitle} body={uiCopy.trust.gdprMinorsBody} />
    <TrustSection heading={uiCopy.trust.gdprContactTitle} body={uiCopy.trust.gdprContactBody} />
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
