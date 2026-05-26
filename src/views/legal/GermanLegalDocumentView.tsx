import React, { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { TrustPageLayout } from '../trust/TrustPageLayout';
import { GermanLegalMarkdownBody } from '../../content/germanLegal/GermanLegalMarkdownBody';
import { parseGermanLegalMarkdown } from '../../content/germanLegal/parseGermanLegalMarkdown';
import type { GermanLegalDocumentSpec } from '../../content/germanLegal/documents';

type Props = {
  document: GermanLegalDocumentSpec;
};

export const GermanLegalDocumentView: React.FC<Props> = ({ document }) => {
  const blocks = useMemo(() => parseGermanLegalMarkdown(document.markdown), [document.markdown]);

  return (
    <TrustPageLayout
      title={document.title}
      backTo={document.backTo ?? '/legal'}
      backLabel={document.backLabel}
    >
      {document.stand ? <Text style={styles.stand}>{document.stand}</Text> : null}
      <GermanLegalMarkdownBody blocks={blocks} />
    </TrustPageLayout>
  );
};

const styles = StyleSheet.create({
  stand: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.lg,
  },
});
