import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useModelAgency } from '../context/ModelAgencyContext';
import { uiCopy } from '../constants/uiCopy';

export const ModelAgencySelector: React.FC = () => {
  const { agencies, switchAgency, loading } = useModelAgency();

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accentBrown} />
        <Text style={{ marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary }}>
          {uiCopy.common.loading}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>{uiCopy.login?.brandTitle ?? 'INDEX CASTING'}</Text>
        <Text style={styles.title}>{uiCopy.model.selectAgencyTitle}</Text>
        <Text style={styles.subtitle}>
          {agencies.length > 0 ? uiCopy.model.selectAgencySubtitle : uiCopy.model.noAgencyProfiles}
        </Text>
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {agencies.map((a) => (
          <TouchableOpacity
            key={a.agencyId}
            style={styles.card}
            onPress={() => switchAgency(a.agencyId)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${a.agencyName}`}
          >
            <Text style={styles.agencyName}>{a.agencyName}</Text>
            <Text style={styles.territory}>{a.territory}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  brand: {
    ...typography.headingCompact,
    marginBottom: spacing.md,
    color: colors.textPrimary,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  agencyName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  territory: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
