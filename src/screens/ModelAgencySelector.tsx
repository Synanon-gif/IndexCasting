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
import { useAuth } from '../context/AuthContext';
import { uiCopy } from '../constants/uiCopy';
import { makeModelAgencyKey } from '../utils/modelAgencyKey';

export const ModelAgencySelector: React.FC = () => {
  const { agencies, switchRepresentation, loading } = useModelAgency();
  const { signOut } = useAuth();

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
        <Text style={styles.brand}>{uiCopy.login.brandTitle}</Text>
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
            key={makeModelAgencyKey(a.agencyId, a.territory)}
            style={styles.card}
            onPress={() => switchRepresentation(a)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${a.agencyName} ${a.territory}`}
          >
            <Text style={styles.agencyName}>{a.agencyName}</Text>
            <Text style={styles.territory}>{a.territory}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.signOutBtn} onPress={() => void signOut()}>
          <Text style={styles.signOutLabel}>{uiCopy.common.logout}</Text>
        </TouchableOpacity>
      </View>
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
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  signOutBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  signOutLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
});
