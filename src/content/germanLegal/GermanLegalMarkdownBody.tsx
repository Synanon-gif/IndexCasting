import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import type { GermanLegalBlock } from './parseGermanLegalMarkdown';

type Props = {
  blocks: GermanLegalBlock[];
};

export const GermanLegalMarkdownBody: React.FC<Props> = ({ blocks }) => (
  <>
    {blocks.map((block, index) => {
      const key = `${block.type}-${index}`;
      if (block.type === 'h2') {
        return (
          <Text key={key} style={styles.h2}>
            {block.text}
          </Text>
        );
      }
      if (block.type === 'h3') {
        return (
          <Text key={key} style={styles.h3}>
            {block.text}
          </Text>
        );
      }
      if (block.type === 'ul') {
        return (
          <View key={key} style={styles.ul}>
            {block.items.map((item, itemIndex) => (
              <Text key={`${index}-${itemIndex}`} style={styles.li}>
                {'\u2022 '}
                {item}
              </Text>
            ))}
          </View>
        );
      }
      return (
        <Text key={key} style={styles.p}>
          {block.text}
        </Text>
      );
    })}
  </>
);

const styles = StyleSheet.create({
  h2: {
    ...typography.label,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  h3: {
    ...typography.label,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  p: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  ul: {
    marginBottom: spacing.sm,
    paddingLeft: spacing.sm,
  },
  li: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
});
