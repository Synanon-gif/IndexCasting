import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { TrustPageLayout, TrustSection } from './TrustPageLayout';

export const TrustSecurityView: React.FC = () => (
  <TrustPageLayout
    title={uiCopy.trust.securityTitle}
    backTo="/trust"
    backLabel={uiCopy.trust.backToTrust}
  >
    <Text style={styles.intro}>{uiCopy.trust.securityIntro}</Text>
    <TrustSection heading={uiCopy.trust.securityArchTitle} body={uiCopy.trust.securityArchBody} />
    <TrustSection heading={uiCopy.trust.securityRlsTitle} body={uiCopy.trust.securityRlsBody} />
    <TrustSection heading={uiCopy.trust.securityAdminTitle} body={uiCopy.trust.securityAdminBody} />
    <TrustSection heading={uiCopy.trust.securityAuthTitle} body={uiCopy.trust.securityAuthBody} />
    <TrustSection
      heading={uiCopy.trust.securitySecretsTitle}
      body={uiCopy.trust.securitySecretsBody}
    />
    <TrustSection
      heading={uiCopy.trust.securityUploadsTitle}
      body={uiCopy.trust.securityUploadsBody}
    />
    <TrustSection heading={uiCopy.trust.securityVulnTitle} body={uiCopy.trust.securityVulnBody} />
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
