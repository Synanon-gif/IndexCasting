import React, { useEffect, useRef, useState } from 'react';
import { canonicalDisplayCityForModel } from '../utils/canonicalModelCity';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  TextInput,
  Platform,
  Linking,
  Modal,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { isMobileWidth } from '../theme/breakpoints';
import { StorageImage } from '../components/StorageImage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, typography } from '../theme/theme';
import { supabase } from '../../lib/supabase';
import {
  getGuestLink,
  getGuestLinkModels,
  acceptGuestLinkTos,
  type GuestLinkInfo,
  type GuestLinkModel,
} from '../services/guestLinksSupabase';
import { signInOrCreateGuestWithOtp } from '../services/guestAuthSupabase';
import { uiCopy } from '../constants/uiCopy';
import {
  defaultDisplayModeForPackage,
  getPackageCoverRawRef,
  getPackageDisplayImages,
  normalizePackageType,
  packageHasBothBuckets,
  type PackageDisplayMode,
} from '../utils/packageDisplayMedia';
import { TermsScreen } from '../screens/TermsScreen';
import { PrivacyScreen } from '../screens/PrivacyScreen';
import { PdfExportModal } from '../components/PdfExportModal';
import type { PdfModelInput } from '../utils/pdfExport';

const copy = uiCopy.guestFlow;

type GuestViewProps = {
  linkId: string;
};

type ViewPhase = 'legal' | 'browse' | 'request_form' | 'submitting' | 'check_email' | 'error';

const GUEST_PENDING_KEY = 'guest_pending_request';
const getChestValue = (m: GuestLinkModel): number | null => {
  const withChest = m as GuestLinkModel & { chest?: number | null };
  return withChest.chest ?? m.bust ?? null;
};

export const GuestView: React.FC<GuestViewProps> = ({ linkId }) => {
  const { width: windowW } = useWindowDimensions();
  const numCols = isMobileWidth(windowW) ? 2 : windowW >= 960 ? 4 : windowW >= 640 ? 3 : 2;
  const [link, setLink] = useState<GuestLinkInfo | null>(null);
  const [models, setModels] = useState<GuestLinkModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<ViewPhase>('legal');
  const [pageError, setPageError] = useState<string | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const loadingRef = useRef(false);

  // Legal gate
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [guestPrivacyVisible, setGuestPrivacyVisible] = useState(false);

  // Gallery lightbox
  const [galleryModel, setGalleryModel] = useState<GuestLinkModel | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  /**
   * Sign-up gate prompt — shown when an unauthenticated guest taps an action
   * (Chat / Option / Add to selection) inside the gallery. Confirming persists
   * the current package linkId so post-signup the package auto-reopens (see
   * `App.tsx` `ic_pending_guest_link` recovery effect) and the user can use
   * the same buttons natively in `ClientWebApp` package mode.
   */
  const [signupGateOpen, setSignupGateOpen] = useState(false);
  const triggerGuestActionSignupGate = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        localStorage.setItem('ic_pending_guest_link', linkId);
      } catch {
        /* best-effort */
      }
    }
    setSignupGateOpen(true);
  };
  const handleSignupGateContinue = () => {
    setSignupGateOpen(false);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        localStorage.setItem('ic_pending_guest_link', linkId);
      } catch {
        /* best-effort */
      }
      const u = new URL(window.location.href);
      u.searchParams.delete('guest');
      u.searchParams.set('signup', '1');
      window.location.href = u.toString();
    } else {
      Linking.openURL('https://indexcasting.com').catch(() => {});
    }
  };
  /** Local-only favorites (sessionStorage on web) — no backend. */
  const GUEST_FAV_KEY = 'ic_guest_gallery_favorite_ids';
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(GUEST_FAV_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) {
        setFavoriteIds(new Set(arr));
      }
    } catch {
      /* ignore */
    }
  }, []);
  const toggleGuestFavorite = (id: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          sessionStorage.setItem(GUEST_FAV_KEY, JSON.stringify([...next]));
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // PDF export
  const [pdfExportOpen, setPdfExportOpen] = useState(false);

  // Request form
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [requestDate, setRequestDate] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadLinkData = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const g = await getGuestLink(linkId);
      if (!g) {
        setPageError(copy.invalidOrExpired);
        setLoading(false);
        return;
      }
      setLink(g);
      const modelsRes = await getGuestLinkModels(linkId);
      if (!modelsRes.ok) {
        console.warn('[GuestView] getGuestLinkModels failed', {
          linkId: linkId.slice(0, 8),
          error: modelsRes.error,
        });
        setPageError(copy.modelsLoadFailed);
        return;
      }
      console.info('[GuestView] models loaded', {
        linkId: linkId.slice(0, 8),
        type: g.type,
        modelCount: modelsRes.data.length,
        firstModel: modelsRes.data[0]
          ? {
              id: modelsRes.data[0].id.slice(0, 8),
              name: modelsRes.data[0].name,
              portfolioCount: modelsRes.data[0].portfolio_images?.length ?? 0,
              polaroidsCount: modelsRes.data[0].polaroids?.length ?? 0,
              firstPortfolioPrefix:
                modelsRes.data[0].portfolio_images?.[0]?.slice(0, 80) ?? '(none)',
            }
          : null,
      });
      setModels(modelsRes.data);
    } catch (e) {
      console.error('GuestView load error:', e);
      setPageError(copy.loadError);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    loadLinkData();

    // M-5: Subscribe to Realtime changes on this specific guest link so that
    // deactivation or model-list changes during an active session are reflected
    // without requiring a manual page reload.
    const channel = supabase
      .channel(`guest_link_watch_${linkId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'guest_links',
          filter: `id=eq.${linkId}`,
        },
        () => {
          // Re-fetch link metadata and models when the link is updated.
          loadLinkData();
        },
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
    // loadLinkData is defined inside the component; eslint-disable below prevents
    // the exhaustive-deps warning from requiring it in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  // Polling fallback: anon users have no RLS-based SELECT on guest_links, so
  // Supabase Realtime delivers no events to unauthenticated guests (C-3 fix
  // removed the broad anon SELECT policy). Poll every 60 s as a safety net so
  // that deactivation / expiry is always detected within one poll cycle — even
  // when the Realtime channel is silent.
  useEffect(() => {
    const POLL_INTERVAL_MS = 60_000;

    const id = setInterval(async () => {
      try {
        const g = await getGuestLink(linkId);
        if (!g) {
          setPageError(copy.invalidOrExpired);
          clearInterval(id);
        }
      } catch {
        // Silently ignore network errors — the next poll cycle will retry.
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [linkId]);

  // Auto-refresh signed image URLs every 6 hours for long-lived sessions.
  // Signed URLs have a 7-day TTL (matching the access window), so this is a
  // safety net for edge cases — e.g. a user leaving a tab open for days.
  // Only re-fetches if the link is still active (getGuestLink succeeds).
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours

    const id = setInterval(async () => {
      try {
        // Verify the link is still active before re-fetching (may have been deactivated)
        const g = await getGuestLink(linkId);
        if (!g) {
          setPageError(copy.invalidOrExpired);
          clearInterval(id);
          return;
        }
        // Refresh signed URLs by re-fetching models
        const modelsRes = await getGuestLinkModels(linkId);
        if (modelsRes.ok && modelsRes.data.length > 0) {
          setModels(modelsRes.data);
        }
      } catch {
        // Non-fatal: images stay valid for 7 days — next interval will retry.
      }
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [linkId]);

  const pkgType = normalizePackageType(link?.type);

  // For 'mixed' packages, the viewer can toggle between portfolio and polaroid.
  // Default follows the canonical helper (mixed → 'portfolio'). Reset whenever
  // the package type changes (e.g. realtime update from agency).
  const [displayMode, setDisplayMode] = useState<PackageDisplayMode>(() =>
    defaultDisplayModeForPackage(pkgType),
  );
  useEffect(() => {
    setDisplayMode(defaultDisplayModeForPackage(pkgType));
  }, [pkgType]);

  // The toggle is only meaningful for mixed packages where at least one model
  // actually has images in both buckets. Otherwise the second mode is empty.
  const showDisplayToggle =
    pkgType === 'mixed' && models.some((m) => packageHasBothBuckets(m, pkgType));

  const getGalleryImages = (m: GuestLinkModel): string[] =>
    getPackageDisplayImages(m, pkgType, displayMode);
  const getCoverImage = (m: GuestLinkModel): string | undefined => {
    const raw = getPackageCoverRawRef(m, pkgType, displayMode);
    return raw || undefined;
  };

  const pdfModels: PdfModelInput[] = models.map((m) => ({
    name: m.name ?? '',
    city: canonicalDisplayCityForModel(m),
    height: m.height ?? null,
    chest: getChestValue(m),
    waist: m.waist ?? null,
    hips: m.hips ?? null,
    imageUrls: getGalleryImages(m),
  }));

  // For mixed packages, the PDF reflects the currently chosen display mode so
  // the export matches what the viewer sees on screen.
  const effectivePdfMode: PackageDisplayMode =
    pkgType === 'mixed' ? displayMode : (pkgType as PackageDisplayMode);
  const pdfEntityName =
    link?.label || (effectivePdfMode === 'polaroid' ? 'Polaroid Package' : 'Portfolio Package');

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
      setFormError(copy.invalidEmail);
      return;
    }

    setPhase('submitting');

    // M-5/M-6: Persist the request payload so GuestChatView can pick it up after
    // Magic Link auth. Use sessionStorage on web, AsyncStorage on native.
    const pendingPayload = JSON.stringify({
      link_id: linkId,
      selected_models: Array.from(selectedModelIds),
      requested_date: requestDate.trim() || null,
      message: requestMessage.trim(),
      email: trimmedEmail,
    });
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(GUEST_PENDING_KEY, pendingPayload);
    } else {
      // Native platforms (iOS / Android) — AsyncStorage persists across app restarts.
      AsyncStorage.setItem(GUEST_PENDING_KEY, pendingPayload).catch((err) => {
        console.warn('GuestView: AsyncStorage write failed', err);
      });
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
        <Modal
          visible={termsVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setTermsVisible(false)}
        >
          <TermsScreen onClose={() => setTermsVisible(false)} />
        </Modal>
        <Modal
          visible={guestPrivacyVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setGuestPrivacyVisible(false)}
        >
          <PrivacyScreen onClose={() => setGuestPrivacyVisible(false)} />
        </Modal>

        <Text style={styles.brand}>INDEX CASTING</Text>
        <View style={styles.guestAccessBanner}>
          <Text style={styles.guestAccessBadge}>{copy.guestAccessBadge}</Text>
          <Text style={styles.guestAccessSubtitle}>{copy.guestAccessSubtitle}</Text>
        </View>
        <Text style={styles.title}>{copy.legalTitle}</Text>
        <Text style={styles.subtitle}>
          {copy.legalPackageIntro.replace(
            '{agencyName}',
            (link?.agency_name && link.agency_name.trim()) || copy.legalPackageIntroFallbackAgency,
          )}
        </Text>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setTosAccepted(!tosAccepted)}
          accessibilityRole="checkbox"
        >
          <View style={[styles.checkbox, tosAccepted && styles.checkboxChecked]}>
            {tosAccepted && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            {copy.legalTosLabel}{' '}
            <Text style={styles.legalLinkInline} onPress={() => setTermsVisible(true)}>
              {uiCopy.legal.tosLabel}
            </Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setPrivacyAccepted(!privacyAccepted)}
          accessibilityRole="checkbox"
        >
          <View style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}>
            {privacyAccepted && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            {copy.legalPrivacyLabel}{' '}
            <Text style={styles.legalLinkInline} onPress={() => setGuestPrivacyVisible(true)}>
              {uiCopy.legal.privacyLabel}
            </Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (!tosAccepted || !privacyAccepted) && styles.primaryBtnDisabled,
          ]}
          disabled={!tosAccepted || !privacyAccepted}
          onPress={async () => {
            // Persist ToS acceptance to guest_links.tos_accepted_by_guest for the audit trail.
            // Non-fatal: if the RPC fails the guest can still browse; the in-memory
            // state is set. The next successful call will update the DB record.
            if (link?.id) {
              void acceptGuestLinkTos(link.id);
            }
            setPhase('browse');
          }}
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
          {copy.checkEmailSentToPrefix} <Text style={styles.emailHighlight}>{email}</Text>
        </Text>
        <View style={styles.checkEmailActions}>
          <TouchableOpacity
            style={styles.checkEmailResendBtn}
            onPress={() => {
              void signInOrCreateGuestWithOtp(email.trim().toLowerCase());
            }}
          >
            <Text style={styles.checkEmailResendLabel}>{copy.checkEmailResend}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.checkEmailBackBtn} onPress={() => setPhase('browse')}>
            <Text style={styles.checkEmailBackLabel}>{copy.checkEmailBackToModels}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Request form ───────────────────────────────────────────────────────────
  if (phase === 'request_form' || phase === 'submitting') {
    const isSubmitting = phase === 'submitting';
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <Text style={styles.brand}>INDEX CASTING</Text>
          <TouchableOpacity onPress={() => setPhase('browse')}>
            <Text style={styles.backLink}>{copy.backToModels}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>{copy.selectModels}</Text>
        <Text style={styles.sectionHint}>
          {selectedModelIds.size > 0
            ? copy.requestFormSelectHintCount.replace('{count}', String(selectedModelIds.size))
            : copy.requestFormSelectHintEmpty}
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
                  <StorageImage
                    uri={getCoverImage(m)!}
                    style={styles.modelImage}
                    resizeMode="contain"
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
                    {m.height != null ? `${m.height}cm` : '—'}
                    {getChestValue(m) != null ? ` · Chest ${getChestValue(m)} cm` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>{copy.dateLabel}</Text>
        <TextInput
          style={styles.input}
          placeholder={copy.datePlaceholderOptional}
          placeholderTextColor={colors.textSecondary}
          value={requestDate}
          onChangeText={setRequestDate}
          editable={!isSubmitting}
        />

        <Text style={styles.fieldLabel}>{copy.messageLabelInput}</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder={copy.messagePlaceholderProject}
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
          {copy.submitRequestLegalNote.replace(
            '{agencyName}',
            (link?.agency_name && link.agency_name.trim()) || copy.submitRequestAgencyFallback,
          )}
        </Text>
      </ScrollView>
    );
  }

  // ─── Gallery lightbox ───────────────────────────────────────────────────────
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
          <TouchableOpacity
            style={styles.galleryBack}
            onPress={closeGallery}
            accessibilityRole="button"
          >
            <Text style={styles.galleryBackGlyph}>←</Text>
            <Text style={styles.galleryBackLabel}>{uiCopy.discover.backToGallery}</Text>
          </TouchableOpacity>

          {/* Counter */}
          <Text style={styles.galleryCounter}>
            {galleryIndex + 1} / {galleryImages.length}
          </Text>

          {/* Main image */}
          {galleryImages[galleryIndex] ? (
            <View
              style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}
            >
              <StorageImage
                uri={galleryImages[galleryIndex]}
                style={styles.galleryImage}
                resizeMode="contain"
              />
            </View>
          ) : null}

          {/* Navigation */}
          <View style={styles.galleryNav}>
            <TouchableOpacity
              onPress={() => setGalleryIndex((i) => Math.max(0, i - 1))}
              disabled={galleryIndex === 0}
              hitSlop={16}
              accessibilityRole="button"
              style={[styles.galleryNavBtn, galleryIndex === 0 && { opacity: 0.3 }]}
            >
              <Text style={styles.galleryNavLabel}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setGalleryIndex((i) => Math.min(galleryImages.length - 1, i + 1))}
              disabled={galleryIndex === galleryImages.length - 1}
              hitSlop={16}
              accessibilityRole="button"
              style={[
                styles.galleryNavBtn,
                galleryIndex === galleryImages.length - 1 && { opacity: 0.3 },
              ]}
            >
              <Text style={styles.galleryNavLabel}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Model info overlay */}
          {galleryModel && (
            <View style={styles.galleryModelInfo}>
              <Text style={styles.galleryModelName}>{galleryModel.name}</Text>
              <Text style={styles.galleryModelMeta}>
                {galleryModel.height != null ? `${galleryModel.height}cm` : '—'}
                {getChestValue(galleryModel) != null
                  ? ` · Chest ${getChestValue(galleryModel)} cm`
                  : ''}
                {galleryModel.waist ? ` · Waist ${galleryModel.waist} cm` : ''}
                {galleryModel.hips ? ` · Hips ${galleryModel.hips} cm` : ''}
              </Text>
              {/* Action CTAs — same as authenticated Discover detail. For
                  unauthenticated guests, every tap routes to the sign-up gate;
                  after sign-up the package auto-reopens and the user can use
                  the buttons natively in `ClientWebApp`. */}
              <View style={styles.galleryActionRow}>
                <TouchableOpacity
                  style={styles.galleryActionBtn}
                  onPress={triggerGuestActionSignupGate}
                  accessibilityRole="button"
                >
                  <Text style={styles.galleryActionBtnLabel}>{copy.galleryActionChat}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.galleryActionBtn}
                  onPress={triggerGuestActionSignupGate}
                  accessibilityRole="button"
                >
                  <Text style={styles.galleryActionBtnLabel}>{copy.galleryActionOption}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.galleryActionBtn}
                  onPress={triggerGuestActionSignupGate}
                  accessibilityRole="button"
                >
                  <Text style={styles.galleryActionBtnLabel}>{copy.galleryActionAdd}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Sign-up gate prompt for unauthenticated guests — shown over the gallery */}
      <Modal
        visible={signupGateOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSignupGateOpen(false)}
      >
        <View style={styles.signupGateOverlay}>
          <View style={styles.signupGateCard}>
            <Text style={styles.signupGateTitle}>{copy.signupGatePromptTitle}</Text>
            <Text style={styles.signupGateBody}>{copy.signupGatePromptBody}</Text>
            <TouchableOpacity style={styles.signupGatePrimary} onPress={handleSignupGateContinue}>
              <Text style={styles.signupGatePrimaryLabel}>{copy.signupGateContinue}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.signupGateSecondary}
              onPress={() => setSignupGateOpen(false)}
            >
              <Text style={styles.signupGateSecondaryLabel}>{copy.signupGateCancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={styles.brand}>INDEX CASTING</Text>
          {Platform.OS === 'web' && pdfModels.length > 0 ? (
            <TouchableOpacity
              onPress={() => setPdfExportOpen(true)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{
                  ...typography.body,
                  fontSize: 12,
                  fontWeight: '600',
                  color: colors.textPrimary,
                }}
              >
                {uiCopy.pdfExport.buttonLabel}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.headerMetaRow}>
          <Text style={styles.headerSub}>
            {/* For mixed packages the label follows the chosen mode so the */}
            {/* header matches the displayed content. */}
            {(pkgType === 'mixed' ? displayMode : pkgType) === 'polaroid'
              ? copy.packageTypePolaroidLabel
              : copy.packageTypePortfolioLabel}
            {' · '}
            {link?.agency_name || copy.browseHeaderAgencyFallback}
            {' · '}
            {copy.modelsCountInHeader.replace('{count}', String(models.length))}
          </Text>
          <View style={styles.guestBadgePill}>
            <Text style={styles.guestBadgePillLabel}>{copy.guestAccessBadge}</Text>
          </View>
        </View>
        {showDisplayToggle ? (
          <View style={styles.displayToggleRow}>
            {(['portfolio', 'polaroid'] as const).map((mode) => {
              const active = displayMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => setDisplayMode(mode)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={[styles.displayTogglePill, active && styles.displayTogglePillActive]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.displayTogglePillLabel,
                      active && styles.displayTogglePillLabelActive,
                    ]}
                  >
                    {mode === 'polaroid'
                      ? copy.packageTypePolaroidLabel
                      : copy.packageTypePortfolioLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        <Text style={styles.guestAccessNote}>{copy.guestAccessSubtitle}</Text>
      </View>

      {/* ── Model grid (FlatList for virtualised / lazy rendering) ── */}
      <FlatList
        key={`guest-grid-${numCols}`}
        style={styles.scrollArea}
        contentContainerStyle={styles.grid}
        data={models}
        keyExtractor={(m) => m.id}
        numColumns={numCols}
        columnWrapperStyle={styles.gridRow}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        ListEmptyComponent={
          <View style={{ padding: spacing.lg, alignItems: 'center' }}>
            <Text style={{ ...typography.body, color: colors.textSecondary }}>
              {uiCopy.guestFlow.noModelsInPackage}
            </Text>
          </View>
        }
        renderItem={({ item: m }: ListRenderItemInfo<GuestLinkModel>) => {
          const allImages = getGalleryImages(m);
          const imageCount = allImages.length;
          const coverImage = getCoverImage(m);
          const displayCity = canonicalDisplayCityForModel(m);
          return (
            <View style={styles.modelCardBrowse}>
              <View style={styles.guestImageArea}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => (imageCount > 0 ? openGallery(m, 0) : undefined)}
                  disabled={imageCount === 0}
                  style={styles.guestImageTouchable}
                >
                  {coverImage ? (
                    <View style={styles.guestImageInner}>
                      <StorageImage
                        uri={coverImage}
                        style={styles.modelImageBrowse}
                        resizeMode="contain"
                      />
                      {imageCount > 1 && (
                        <View style={styles.imageCountBadge}>
                          <Text style={styles.imageCountLabel}>{imageCount}</Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View
                      style={[styles.modelImagePlaceholder, styles.modelImageBrowsePlaceholder]}
                    >
                      <Text style={styles.placeholderText}>{m.name.charAt(0)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.guestStarBtn}
                  onPress={() => toggleGuestFavorite(m.id)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    favoriteIds.has(m.id)
                      ? uiCopy.discover.toggleUnfavoriteA11y
                      : uiCopy.discover.toggleFavoriteA11y
                  }
                >
                  <Text style={styles.guestStarGlyph}>{favoriteIds.has(m.id) ? '★' : '☆'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.modelInfo}>
                <Text style={styles.modelName}>{m.name}</Text>
                <Text style={styles.modelMeta}>
                  {m.height != null ? `${m.height}cm` : '—'}
                  {getChestValue(m) != null ? ` · Chest ${getChestValue(m)} cm` : ''}
                  {m.waist ? ` · Waist ${m.waist} cm` : ''}
                  {m.hips ? ` · Hips ${m.hips} cm` : ''}
                </Text>
                <Text style={styles.modelMeta}>
                  {m.sex ? (m.sex === 'female' ? copy.sexFemale : copy.sexMale) : ''}
                  {m.hair_color ? `${m.sex ? ' · ' : ''}${m.hair_color}` : ''}
                  {m.eye_color ? ` · ${m.eye_color}` : ''}
                  {displayCity ? ` · ${displayCity}` : ''}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {/* ── Contact bar ── */}
      <View style={styles.contactBar}>
        <TouchableOpacity style={styles.contactBtn} onPress={() => setPhase('request_form')}>
          <Text style={styles.contactBtnLabel}>
            {copy.browseSendRequest} {link?.agency_name || copy.browseHeaderAgencyFallback}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.createAccountBtn}
          onPress={() => {
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
              try {
                localStorage.setItem('ic_pending_guest_link', linkId);
              } catch {
                /* best-effort */
              }
              const u = new URL(window.location.href);
              u.searchParams.delete('guest');
              u.searchParams.set('signup', '1');
              window.location.href = u.toString();
            } else {
              Linking.openURL('https://indexcasting.com').catch(() => {});
            }
          }}
        >
          <Text style={styles.createAccountBtnLabel}>{copy.browseCreateAccount}</Text>
        </TouchableOpacity>
      </View>
      {Platform.OS === 'web' ? (
        <PdfExportModal
          visible={pdfExportOpen}
          onClose={() => setPdfExportOpen(false)}
          models={pdfModels}
          entityName={pdfEntityName}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
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
  /** Mixed-package display-mode toggle (Portfolio / Polaroid). */
  displayToggleRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    padding: 2,
    backgroundColor: colors.surface,
  },
  displayTogglePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  displayTogglePillActive: {
    backgroundColor: colors.textPrimary,
  },
  displayTogglePillLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  displayTogglePillLabelActive: {
    color: colors.surface,
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
  checkEmailActions: {
    marginTop: spacing.lg,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  checkEmailResendBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    borderRadius: 6,
  },
  checkEmailResendLabel: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600' as const,
  },
  checkEmailBackBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  checkEmailBackLabel: {
    ...typography.body,
    color: colors.textSecondary,
    textDecorationLine: 'underline' as const,
  },
  errorText: {
    ...typography.body,
    color: colors.errorDark,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
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
  legalLinkInline: {
    ...typography.body,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerSub: { ...typography.body, color: colors.textSecondary, fontSize: 12 },
  backLink: { ...typography.body, color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  scrollArea: { flex: 1 },
  grid: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 140 },
  gridRow: {
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  modelCardBrowse: {
    flex: 1,
    minWidth: 0,
    marginBottom: spacing.sm,
    backgroundColor: 'transparent',
  },
  guestImageArea: {
    position: 'relative',
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  guestImageTouchable: {
    width: '100%',
    height: '100%',
  },
  guestImageInner: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  guestStarBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 20,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestStarGlyph: {
    fontSize: 15,
    color: '#fff',
    lineHeight: 17,
  },
  formContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl * 3,
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
  modelImageBrowse: { width: '100%', height: '100%', backgroundColor: colors.surfaceAlt },
  modelImagePlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelImageBrowsePlaceholder: {
    height: '100%',
  },
  placeholderText: { fontSize: 48, color: colors.textSecondary },
  modelInfo: { paddingTop: 6, paddingBottom: spacing.sm },
  modelName: {
    ...typography.label,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  modelMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 1,
  },
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
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  contactBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  contactBtnLabel: { ...typography.label, color: colors.surface },
  createAccountBtn: {
    paddingVertical: spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  createAccountBtnLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
  },
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
  galleryBack: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 44,
    left: 16,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  galleryBackGlyph: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
  },
  galleryBackLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  galleryCounter: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 48,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    zIndex: 10,
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
  /** Action CTAs row inside gallery model info overlay (Chat / Option / Add). */
  galleryActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  galleryActionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  galleryActionBtnLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  /** Sign-up gate modal (rendered above the gallery for unauthenticated guests). */
  signupGateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  signupGateCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: 'stretch',
  },
  signupGateTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  signupGateBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  signupGatePrimary: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  signupGatePrimaryLabel: {
    ...typography.label,
    color: colors.surface,
  },
  signupGateSecondary: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  signupGateSecondaryLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
});
