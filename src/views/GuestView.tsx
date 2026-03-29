import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, TextInput, Platform, Modal,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getGuestLink, getGuestLinkModels, type GuestLink, type GuestLinkModel } from '../services/guestLinksSupabase';
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
  const [models, setModels] = useState<GuestLinkModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<ViewPhase>('legal');
  const [pageError, setPageError] = useState<string | null>(null);

  // Legal gate
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Gallery lightbox
  const [galleryModel, setGalleryModel] = useState<GuestLinkModel | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

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
        const results = await getGuestLinkModels(linkId);
        setModels(results);
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
                {getCoverImage(m) ? (
                  <Image
                    source={{ uri: getCoverImage(m)! }}
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

  // ─── Gallery lightbox helper ────────────────────────────────────────────────
  // Images are strictly separated by package type — never mixed.
  const getGalleryImages = (m: GuestLinkModel): string[] =>
    link?.type === 'polaroid'
      ? (m.polaroids ?? [])
      : (m.portfolio_images ?? []);

  const getCoverImage = (m: GuestLinkModel): string | undefined =>
    link?.type === 'polaroid' ? m.polaroids?.[0] : m.portfolio_images?.[0];

  const openGallery = (m: GuestLinkModel, startIndex = 0) => {
    setGalleryModel(m);
    setGalleryIndex(startIndex);
  };

  const closeGallery = () => {
    setGalleryModel(null);
    setGalleryIndex(0);
  };

  const galleryImages = galleryModel ? getGalleryImages(galleryModel) : [];

  // ─── Browse models ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* ── Gallery lightbox ── */}
      <Modal
        visible={!!galleryModel}
        transparent
        animationType="fade"
        onRequestClose={closeGallery}
      >
        <View style={styles.galleryOverlay}>
          {/* Close */}
          <TouchableOpacity style={styles.galleryClose} onPress={closeGallery}>
            <Text style={styles.galleryCloseLabel}>✕</Text>
          </TouchableOpacity>

          {/* Counter */}
          <Text style={styles.galleryCounter}>
            {galleryIndex + 1} / {galleryImages.length}
          </Text>

          {/* Main image */}
          {galleryImages[galleryIndex] ? (
            <Image
              source={{ uri: galleryImages[galleryIndex] }}
              style={styles.galleryImage}
              resizeMode="contain"
            />
          ) : null}

          {/* Navigation */}
          <View style={styles.galleryNav}>
            <TouchableOpacity
              onPress={() => setGalleryIndex((i) => Math.max(0, i - 1))}
              disabled={galleryIndex === 0}
              style={[styles.galleryNavBtn, galleryIndex === 0 && { opacity: 0.3 }]}
            >
              <Text style={styles.galleryNavLabel}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setGalleryIndex((i) => Math.min(galleryImages.length - 1, i + 1))}
              disabled={galleryIndex === galleryImages.length - 1}
              style={[styles.galleryNavBtn, galleryIndex === galleryImages.length - 1 && { opacity: 0.3 }]}
            >
              <Text style={styles.galleryNavLabel}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Model info overlay */}
          {galleryModel && (
            <View style={styles.galleryModelInfo}>
              <Text style={styles.galleryModelName}>{galleryModel.name}</Text>
              <Text style={styles.galleryModelMeta}>
                {galleryModel.height}cm
                {galleryModel.bust ? ` · Bust ${galleryModel.bust}` : ''}
                {galleryModel.waist ? ` · Waist ${galleryModel.waist}` : ''}
                {galleryModel.hips ? ` · Hips ${galleryModel.hips}` : ''}
              </Text>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <View style={styles.headerMetaRow}>
          <Text style={styles.headerSub}>
            {link?.type === 'polaroid' ? 'Polaroid Package' : 'Portfolio Package'} · {link?.agency_name || 'Agency'} · {models.length} models
          </Text>
          <View style={styles.guestBadgePill}>
            <Text style={styles.guestBadgePillLabel}>{copy.guestAccessBadge}</Text>
          </View>
        </View>
        <Text style={styles.guestAccessNote}>{copy.guestAccessSubtitle}</Text>
      </View>

      {/* ── Model grid ── */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.grid}>
        {models.map((m) => {
          const allImages = getGalleryImages(m);
          const imageCount = allImages.length;
          return (
            <View key={m.id} style={styles.modelCard}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => imageCount > 0 ? openGallery(m, 0) : undefined}
                disabled={imageCount === 0}
              >
                {getCoverImage(m) ? (
                  <View>
                    <Image
                      source={{ uri: getCoverImage(m)! }}
                      style={styles.modelImage}
                      resizeMode="cover"
                    />
                    {imageCount > 1 && (
                      <View style={styles.imageCountBadge}>
                        <Text style={styles.imageCountLabel}>{imageCount}</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.modelImagePlaceholder}>
                    <Text style={styles.placeholderText}>{m.name.charAt(0)}</Text>
                  </View>
                )}
              </TouchableOpacity>
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
          );
        })}
      </ScrollView>

      {/* ── Contact bar ── */}
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
  // Image count badge on model card
  imageCountBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  imageCountLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  // Gallery lightbox
  galleryOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.93)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryClose: {
    position: 'absolute',
    top: 48,
    right: 24,
    zIndex: 10,
    padding: 8,
  },
  galleryCloseLabel: {
    color: '#fff',
    fontSize: 26,
  },
  galleryCounter: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  galleryImage: {
    width: '100%',
    height: '70%',
  },
  galleryNav: {
    flexDirection: 'row',
    gap: 48,
    marginTop: 24,
  },
  galleryNavBtn: {
    padding: 12,
  },
  galleryNavLabel: {
    color: '#fff',
    fontSize: 42,
    lineHeight: 44,
  },
  galleryModelInfo: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  galleryModelName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  galleryModelMeta: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
});
