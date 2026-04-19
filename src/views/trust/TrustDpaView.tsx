import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { TrustPageLayout, TrustSection } from './TrustPageLayout';

export const TrustDpaView: React.FC = () => (
  <TrustPageLayout
    title={uiCopy.trust.dpaTitle}
    backTo="/trust"
    backLabel={uiCopy.trust.backToTrust}
  >
    <Text style={styles.intro}>{uiCopy.trust.dpaIntro}</Text>
    <TrustSection heading={uiCopy.trust.dpaPartiesTitle} body={uiCopy.trust.dpaPartiesBody} />
    <TrustSection heading={uiCopy.trust.dpaScopeTitle} body={uiCopy.trust.dpaScopeBody} />
    <TrustSection heading={uiCopy.trust.dpaCategoriesTitle} body={uiCopy.trust.dpaCategoriesBody} />
    <TrustSection heading={uiCopy.trust.dpaDataTitle} body={uiCopy.trust.dpaDataBody} />
    <TrustSection heading={uiCopy.trust.dpaPurposesTitle} body={uiCopy.trust.dpaPurposesBody} />
    <TrustSection heading={uiCopy.trust.dpaRetentionTitle} body={uiCopy.trust.dpaRetentionBody} />
    <TrustSection heading={uiCopy.trust.dpaTomTitle} body={uiCopy.trust.dpaTomBody} />
    <TrustSection heading={uiCopy.trust.dpaTransfersTitle} body={uiCopy.trust.dpaTransfersBody} />
    <TrustSection
      heading={uiCopy.trust.dpaSubprocessorsTitle}
      body={uiCopy.trust.dpaSubprocessorsBody}
    />
    <TrustSection heading={uiCopy.trust.dpaRightsTitle} body={uiCopy.trust.dpaRightsBody} />
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
