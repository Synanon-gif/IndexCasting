import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, TextInput, Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getGuestLink, type GuestLink } from '../services/guestLinksSupabase';
import { getModelByIdFromSupabase, type SupabaseModel } from '../services/modelsSupabase';
import { signInOrCreateGuestWithOtp } from '../services/guestAuthSupabase';
import { uiCopy } from '../constants/uiCopy';

const copy = uiCopy.guestFlow;

type GuestViewProps = {
  linkId: string;
};

type ViewPhase =
  | 'legal'
  | 'browse'
  | 'request_form'
  | 'submitting'
  | 'check_email'
  | 'error';

export const GuestView: React.FC<GuestViewProps> = ({ linkId }) => {
  const [link, setLink] = useState<GuestLink | null>(null);
  const [models, setModels] = useState<SupabaseModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<ViewPhase>('legal');
  const [pageError, setPageError] = useState<string | null>(null);

  // Legal gate
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Request form
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [requestDate, setRequestDate] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const g = await getGuestLink(linkId);
        if (!g) {
          setPageError(copy.invalidOrExpired);
          setLoading(false);
          return;
        }
        setLink(g);
        const results = await Promise.all(
          g.model_ids.map((id) => getModelByIdFromSupabase(id)),
        );
        setModels(results.filter((m): m is SupabaseModel => m !== null));
      } catch (e) {
        console.error('GuestView load error:', e);
        setPageError(copy.loadError);
      } finally {
        setLoading(false);
      }
    })();
  }, [linkId]);

  const toggleModel = (id: string) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmitRequest = async () => {
    setFormError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Please enter a valid email address.');
      return;
    }

    setPhase('submitting');

    // Store the request payload in sessionStorage so GuestChatView can pick it up
    // after the Magic Link auth and create the booking request message.
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(
        'guest_pending_request',
        JSON.stringify({
          link_id: linkId,
          agency_id: link?.agency_id,
          selected_models: Array.from(selectedModelIds),
          requested_date: requestDate.trim() || null,
          message: requestMessage.trim(),
          email: trimmedEmail,
        }),
      );
    }

    const result = await signInOrCreateGuestWithOtp(trimmedEmail);
    if (!result.ok) {
      setFormError(result.reason);
      setPhase('request_form');
      return;
    }

    setPhase('check_email');
  };

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
        <Text style={styles.loadingText}>{copy.loading}</Text>
      </View>
    );
  }

  // ─── Fatal error ────────────────────────────────────────────────────────────
  if (pageError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.errorText}>{pageError}</Text>
      </View>
    );
  }

  // ─── Legal gate ─────────────────────────────────────────────────────────────
  if (phase === 'legal') {
    return (
      <View style={styles.centered}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <View style={styles.guestAccessBanner}>
          <Text style={styles.guestAccessBadge}>{copy.guestAccessBadge}</Text>
          <Text style={styles.guestAccessSubtitle}>{copy.guestAccessSubtitle}</Text>
        </View>
        <Text style={styles.title}>{copy.legalTitle}</Text>
        <Text style={styles.subtitle}>
          {link?.agency_name || 'An agency'} has shared a selection of models with you.
          Please accept the terms to continue.
        </Text>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setTosAccepted(!tosAccepted)}
          accessibilityRole="checkbox"
        >
          <View style={[styles.checkbox, tosAccepted && styles.checkboxChecked]}>
            {tosAccepted && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>{copy.legalTosLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setPrivacyAccepted(!privacyAccepted)}
          accessibilityRole="checkbox"
        >
          <View style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}>
            {privacyAccepted && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>{copy.legalPrivacyLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, (!tosAccepted || !privacyAccepted) && styles.primaryBtnDisabled]}
          disabled={!tosAccepted || !privacyAccepted}
          onPress={() => setPhase('browse')}
        >
          <Text style={styles.primaryBtnLabel}>{copy.legalContinue}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Check email (magic link sent) ──────────────────────────────────────────
  if (phase === 'check_email') {
    return (
      <View style={styles.centered}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>{copy.checkEmail}</Text>
        <Text style={styles.subtitle}>{copy.checkEmailSubtitle}</Text>
        <Text style={styles.subtitleSmall}>
          We sent a link to{' '}
          <Text style={styles.emailHighlight}>{email}</Text>
        </Text>
      </View>
    );
  }

  // ─── Request form ───────────────────────────────────────────────────────────
  if (phase === 'request_form' || phase === 'submitting') {
    const isSubmitting = phase === 'submitting';
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.formContent}>
        <View style={styles.header}>
          <Text style={styles.brand}>INDEX CASTING</Text>
          <TouchableOpacity onPress={() => setPhase('browse')}>
            <Text style={styles.backLink}>← Back to models</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>{copy.selectModels}</Text>
        <Text style={styles.sectionHint}>
          {selectedModelIds.size > 0
            ? `${selectedModelIds.size} model(s) selected`
            : 'Tap a model to select or deselect.'}
        </Text>

        <View style={styles.modelGrid}>
          {models.map((m) => {
            const selected = selectedModelIds.has(m.id);
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.modelCard, selected && styles.modelCardSelected]}
                onPress={() => toggleModel(m.id)}
                activeOpacity={0.8}
              >
                {m.portfolio_images?.[0] ? (
                  <Image
                    source={{ uri: m.portfolio_images[0] }}
                    style={styles.modelImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.modelImagePlaceholder}>
                    <Text style={styles.placeholderText}>{m.name.charAt(0)}</Text>
                  </View>
                )}
                {selected && (
                  <View style={styles.selectedBadge}>
                    <Text style={styles.selectedBadgeText}>✓</Text>
                  </View>
                )}
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName}>{m.name}</Text>
                  <Text style={styles.modelMeta}>
                    {m.height}cm{m.bust ? ` · Bust ${m.bust}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>{copy.dateLabel}</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD (optional)"
          placeholderTextColor={colors.textSecondary}
          value={requestDate}
          onChangeText={setRequestDate}
          editable={!isSubmitting}
        />

        <Text style={styles.fieldLabel}>{copy.messageLabelInput}</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Tell the agency about your project…"
          placeholderTextColor={colors.textSecondary}
          value={requestMessage}
          onChangeText={setRequestMessage}
          multiline
          numberOfLines={4}
          editable={!isSubmitting}
        />

        <Text style={styles.fieldLabel}>{copy.emailLabel}</Text>
        <TextInput
          style={styles.input}
          placeholder={copy.emailPlaceholder}
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSubmitting}
        />

        {formError && <Text style={styles.errorText}>{formError}</Text>}

        <TouchableOpacity
          style={[styles.primaryBtn, isSubmitting && styles.primaryBtnDisabled]}
          disabled={isSubmitting}
          onPress={handleSubmitRequest}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.surface} />
          ) : (
            <Text style={styles.primaryBtnLabel}>{copy.submitRequest}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.legalNote}>
          By submitting, you agree that your email and request will be shared with{' '}
          {link?.agency_name || 'the agency'}.
        </Text>
      </ScrollView>
    );
  }

  // ─── Browse models ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <View style={styles.headerMetaRow}>
          <Text style={styles.headerSub}>
            {copy.browseTitle} · {link?.agency_name || 'Agency'} · {models.length} models
          </Text>
          <View style={styles.guestBadgePill}>
            <Text style={styles.guestBadgePillLabel}>{copy.guestAccessBadge}</Text>
          </View>
        </View>
        <Text style={styles.guestAccessNote}>{copy.guestAccessSubtitle}</Text>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.grid}>
        {models.map((m) => (
          <View key={m.id} style={styles.modelCard}>
            {m.portfolio_images?.[0] ? (
              <Image
                source={{ uri: m.portfolio_images[0] }}
                style={styles.modelImage}
                resizeMode="cover"
              />
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
                {m.sex ? `${m.sex === 'female' ? 'Female' : 'Male'}` : ''}
                {m.hair_color ? `${m.sex ? ' · ' : ''}${m.hair_color}` : ''}
                {m.eye_color ? ` · ${m.eye_color}` : ''}
                {m.city ? ` · ${m.city}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.contactBar}>
        <TouchableOpacity
          style={styles.contactBtn}
          onPress={() => setPhase('request_form')}
        >
          <Text style={styles.contactBtnLabel}>
            {copy.browseSendRequest} {link?.agency_name || 'Agency'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  container: { flex: 1, backgroundColor: colors.background },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontSize: 13,
  },
  /** Guest Access Banner — shown on legal gate and browse views */
  guestAccessBanner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  guestAccessBadge: {
    ...typography.label,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  guestAccessSubtitle: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  /** Browse header inline badge */
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  guestBadgePill: {
    backgroundColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  guestBadgePillLabel: {
    ...typography.label,
    fontSize: 9,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  guestAccessNote: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 14,
  },
  title: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 400,
  },
  subtitleSmall: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 13,
    marginTop: spacing.sm,
  },
  emailHighlight: { color: colors.textPrimary, fontWeight: '600' },
  errorText: { ...typography.body, color: '#C0392B', textAlign: 'center', marginBottom: spacing.sm },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
    maxWidth: 400,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  checkmark: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  checkLabel: { ...typography.body, color: colors.textPrimary },
  primaryBtn: {
    width: '100%',
    maxWidth: 400,
    paddingVertical: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnLabel: { ...typography.label, color: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSub: { ...typography.body, color: colors.textSecondary, fontSize: 12 },
  backLink: { ...typography.body, color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  scrollArea: { flex: 1 },
  grid: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 100 },
  formContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 80,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textPrimary,
    fontSize: 15,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.md,
  },
  modelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  modelCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginBottom: spacing.md,
    overflow: 'hidden',
    flex: 1,
    minWidth: 140,
    maxWidth: 200,
  },
  modelCardSelected: {
    borderColor: colors.textPrimary,
    borderWidth: 2,
  },
  selectedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  modelImage: { width: '100%', height: 200 },
  modelImagePlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { fontSize: 48, color: colors.textSecondary },
  modelInfo: { padding: spacing.sm },
  modelName: {
    ...typography.label,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 2,
  },
  modelMeta: { ...typography.body, color: colors.textSecondary, fontSize: 11, marginBottom: 2 },
  fieldLabel: {
    ...typography.label,
    color: colors.textPrimary,
    fontSize: 13,
    marginBottom: 6,
    marginTop: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  legalNote: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  contactBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  contactBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  contactBtnLabel: { ...typography.label, color: colors.surface },
});
