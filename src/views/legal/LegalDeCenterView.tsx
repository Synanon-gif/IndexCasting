import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { TrustPageLayout } from '../trust/TrustPageLayout';
import { navigatePublicPath } from '../../utils/publicLegalRoutes';
import { GERMAN_LEGAL_DOC_LIST } from '../../content/germanLegal/documents';

type CardProps = {
  title: string;
  description: string;
  path: string;
};

const LegalDeCard: React.FC<CardProps> = ({ title, description, path }) => (
  <TouchableOpacity
    style={styles.card}
    onPress={() => navigatePublicPath(path)}
    accessibilityRole="link"
    accessibilityLabel={title}
  >
    <Text style={styles.cardTitle}>{title}</Text>
    <Text style={styles.cardBody}>{description}</Text>
  </TouchableOpacity>
);

/** Public index for German operational legal documents (/legal). */
export const LegalDeCenterView: React.FC = () => (
  <TrustPageLayout title="Rechtliche Dokumente" backTo="/">
    <Text style={styles.intro}>
      Betriebs- und Compliance-Dokumente der Plattform Index Casting (Deutsch). Die Produkt-UI
      bleibt englisch; diese Texte sind die kanonischen deutschen Fassungen.
    </Text>
    <View style={styles.grid}>
      {GERMAN_LEGAL_DOC_LIST.map((doc) => (
        <LegalDeCard key={doc.id} title={doc.title} description={doc.description} path={doc.path} />
      ))}
    </View>
  </TrustPageLayout>
);

const styles = StyleSheet.create({
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  grid: {
    gap: spacing.md,
  },
  card: {
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
});
