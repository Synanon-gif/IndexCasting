import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Linking, ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getGuestLink, type GuestLink } from '../services/guestLinksSupabase';
import { getModelByIdFromSupabase, type SupabaseModel } from '../services/modelsSupabase';

type GuestViewProps = {
  linkId: string;
};

export const GuestView: React.FC<GuestViewProps> = ({ linkId }) => {
  const [link, setLink] = useState<GuestLink | null>(null);
  const [models, setModels] = useState<SupabaseModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [legalDone, setLegalDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const g = await getGuestLink(linkId);
      if (!g) { setError('This link is invalid or has expired.'); setLoading(false); return; }
      setLink(g);
      const modelPromises = g.model_ids.map((id) => getModelByIdFromSupabase(id));
      const results = await Promise.all(modelPromises);
      setModels(results.filter((m): m is SupabaseModel => m !== null));
      setLoading(false);
    })();
  }, [linkId]);

  const handleContactAgency = () => {
    if (!link?.agency_email) return;
    const subject = encodeURIComponent('Inquiry via Casting Index');
    const body = encodeURIComponent(
      `Hello ${link.agency_name || 'Agency'},\n\n` +
      `I am reaching out regarding models from your portfolio.\n\n` +
      `Guest Link: ${linkId}\n\nBest regards`
    );
    Linking.openURL(`mailto:${link.agency_email}?subject=${subject}&body=${body}`);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!legalDone) {
    return (
      <View style={styles.centered}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>Guest Access</Text>
        <Text style={styles.subtitle}>
          {link?.agency_name || 'An agency'} has shared a selection of models with you.
          Please accept the terms to continue.
        </Text>

        <TouchableOpacity style={styles.checkRow} onPress={() => setTosAccepted(!tosAccepted)}>
          <View style={[styles.checkbox, tosAccepted && styles.checkboxChecked]}>
            {tosAccepted && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>I accept the Terms of Service</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.checkRow} onPress={() => setPrivacyAccepted(!privacyAccepted)}>
          <View style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}>
            {privacyAccepted && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>I accept the Privacy Policy</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, (!tosAccepted || !privacyAccepted) && styles.primaryBtnDisabled]}
          disabled={!tosAccepted || !privacyAccepted}
          onPress={() => setLegalDone(true)}
        >
          <Text style={styles.primaryBtnLabel}>View Models</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.headerSub}>
          Shared by {link?.agency_name || 'Agency'} · {models.length} Models
        </Text>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.grid}>
        {models.map((m) => (
          <View key={m.id} style={styles.modelCard}>
            {m.portfolio_images?.[0] ? (
              <Image source={{ uri: m.portfolio_images[0] }} style={styles.modelImage} resizeMode="cover" />
            ) : (
              <View style={styles.modelImagePlaceholder}>
                <Text style={styles.placeholderText}>{m.name.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.modelInfo}>
              <Text style={styles.modelName}>{m.name}</Text>
              <Text style={styles.modelMeta}>
                {m.height}cm{m.bust ? ` · Bust ${m.bust}` : ''}
                {m.waist ? ` · Waist ${m.waist}` : ''}
                {m.hips ? ` · Hips ${m.hips}` : ''}
              </Text>
              <Text style={styles.modelMeta}>
                {m.hair_color || ''}{m.eye_color ? ` · ${m.eye_color}` : ''}
                {m.city ? ` · ${m.city}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {link?.agency_email && (
        <View style={styles.contactBar}>
          <TouchableOpacity style={styles.contactBtn} onPress={handleContactAgency}>
            <Text style={styles.contactBtnLabel}>Contact {link.agency_name || 'Agency'} via Email</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  container: { flex: 1, backgroundColor: colors.background },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.heading, fontSize: 20, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl, maxWidth: 400 },
  errorText: { ...typography.body, color: '#C0392B', textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, width: '100%', maxWidth: 400 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  checkmark: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  checkLabel: { ...typography.body, color: colors.textPrimary },
  primaryBtn: { width: '100%', maxWidth: 400, paddingVertical: spacing.md, borderRadius: 8, backgroundColor: colors.textPrimary, alignItems: 'center', marginTop: spacing.md },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnLabel: { ...typography.label, color: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerSub: { ...typography.body, color: colors.textSecondary, fontSize: 12 },
  scrollArea: { flex: 1 },
  grid: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 100 },
  modelCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginBottom: spacing.md, overflow: 'hidden' },
  modelImage: { width: '100%', height: 300 },
  modelImagePlaceholder: { width: '100%', height: 200, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 48, color: colors.textSecondary },
  modelInfo: { padding: spacing.md },
  modelName: { ...typography.label, color: colors.textPrimary, fontSize: 16, marginBottom: 4 },
  modelMeta: { ...typography.body, color: colors.textSecondary, fontSize: 12, marginBottom: 2 },
  contactBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.md, backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  contactBtn: { backgroundColor: colors.textPrimary, paddingVertical: spacing.md, borderRadius: 8, alignItems: 'center' },
  contactBtnLabel: { ...typography.label, color: colors.surface },
});
