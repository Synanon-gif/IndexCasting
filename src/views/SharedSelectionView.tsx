/**
 * Open-access view for shared selection links.
 * No login required for browsing. Interactive actions (Chat, Option, Star,
 * Add to Selection) show an auth gate prompt.
 * URL format: ?shared=1&name=...&ids=1,2,3
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  useWindowDimensions,
  Linking,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { StorageImage } from '../components/StorageImage';
import {
  getSharedSelectionModels,
  type SharedSelectionModel,
} from '../services/sharedSelectionSupabase';
import { uiCopy } from '../constants/uiCopy';
import { canonicalDisplayCityForModel } from '../utils/canonicalModelCity';
import { isMobileWidth } from '../theme/breakpoints';
import { PdfExportModal } from '../components/PdfExportModal';
import type { PdfModelInput } from '../utils/pdfExport';

type SharedModel = {
  id: string;
  name: string;
  measurements: {
    height: number | null;
    chest: number | null;
    waist: number | null;
    hips: number | null;
  };
  coverUrl: string;
  imageUrls: string[];
  cityLine: string;
};

type SharedSelectionViewProps = {
  shareName: string;
  modelIds: string[];
  token?: string | null;
  /** When true, the view shows a "Continue to your workspace" CTA instead of the sign-up gate. */
  isAuthenticated?: boolean;
  /** Callback for authenticated users — strip ?shared= params and let App route to the workspace. */
  onContinueToWorkspace?: () => void;
};

export const SharedSelectionView: React.FC<SharedSelectionViewProps> = ({
  shareName,
  modelIds,
  token,
  isAuthenticated = false,
  onContinueToWorkspace,
}) => {
  const { width: windowW } = useWindowDimensions();
  const isMobile = isMobileWidth(windowW);
  const colCount = isMobile ? 2 : windowW >= 960 ? 4 : windowW >= 640 ? 3 : 2;
  const tileGap = spacing.sm;

  const [models, setModels] = useState<SharedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailOpen, setDetailOpen] = useState<SharedModel | null>(null);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [authGateVisible, setAuthGateVisible] = useState(false);
  const modelIdsKey = modelIds.join(',');

  useEffect(() => {
    if (!modelIds.length) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSharedSelectionModels(modelIds, token)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          console.error('[SharedSelectionView] load failed:', result.error);
          setModels([]);
          setLoadError(true);
          return;
        }
        setLoadError(false);
        const list: SharedModel[] = result.data.map((m: SharedSelectionModel) => {
          const chestVal = m.chest ?? m.bust ?? null;
          const cityLine = canonicalDisplayCityForModel({
            effective_city: m.effective_city,
            city: m.city,
          });
          const allUrls = m.portfolio_images ?? [];
          return {
            id: m.id,
            name: m.name ?? '',
            measurements: {
              height: m.height ?? null,
              chest: chestVal,
              waist: m.waist ?? null,
              hips: m.hips ?? null,
            },
            coverUrl: allUrls[0] ?? '',
            imageUrls: allUrls,
            cityLine,
          };
        });
        setModels(list);
      })
      .catch((e) => {
        console.error('[SharedSelectionView] Failed to load models:', e);
        if (!cancelled) {
          setModels([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIdsKey]);

  const openDetail = (m: SharedModel) => {
    setDetailImageIndex(0);
    setDetailOpen(m);
  };

  const showAuthGate = () => {
    if (isAuthenticated && onContinueToWorkspace) {
      onContinueToWorkspace();
      return;
    }
    setAuthGateVisible(true);
  };

  const handleSignUp = () => {
    setAuthGateVisible(false);
    if (isAuthenticated && onContinueToWorkspace) {
      onContinueToWorkspace();
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Persist shared-selection context so the user is restored back here after
      // signing up. App.tsx reads `ic_pending_shared_selection` and re-applies
      // the URL params after the new session bootstraps.
      try {
        const payload = JSON.stringify({
          name: shareName,
          ids: modelIds,
          token: token ?? null,
        });
        localStorage.setItem('ic_pending_shared_selection', payload);
      } catch {
        /* best-effort */
      }
      const u = new URL(window.location.href);
      u.searchParams.delete('shared');
      u.searchParams.delete('name');
      u.searchParams.delete('ids');
      u.searchParams.delete('token');
      u.searchParams.set('signup', '1');
      window.location.href = u.toString();
      return;
    }
    Linking.openURL('https://indexcasting.com').catch(() => {});
  };

  const [pdfExportOpen, setPdfExportOpen] = useState(false);

  const pdfModels: PdfModelInput[] = models.map((m) => ({
    name: m.name,
    city: m.cityLine,
    height: m.measurements.height,
    chest: m.measurements.chest,
    waist: m.measurements.waist,
    hips: m.measurements.hips,
    imageUrls: m.imageUrls,
  }));

  const detailImages = detailOpen?.imageUrls ?? [];
  const detailHasNav = detailImages.length > 1;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>INDEX CASTING</Text>
            <Text style={styles.title}>{uiCopy.sharedSelection.title}</Text>
            <Text style={styles.subtitle}>{shareName}</Text>
          </View>
          {Platform.OS === 'web' && pdfModels.length > 0 ? (
            <TouchableOpacity
              onPress={() => setPdfExportOpen(true)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colors.border,
                marginLeft: spacing.sm,
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
      </View>

      {loading ? (
        <View style={styles.centered}>
          <Text style={styles.metaText}>{uiCopy.common.loading}</Text>
        </View>
      ) : models.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.metaText}>
            {loadError ? uiCopy.sharedSelection.loadFailed : uiCopy.sharedSelection.empty}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <View style={[styles.gridRow, { gap: tileGap }]}>
            {models.map((m) => {
              const tilePct = `${(100 - (colCount - 1) * (tileGap / (windowW || 1)) * 100) / colCount}%`;
              return (
                <View
                  key={m.id}
                  style={{
                    width: tilePct as unknown as number,
                    flexBasis: tilePct as unknown as number,
                    flexGrow: 0,
                    flexShrink: 0,
                    marginBottom: spacing.sm,
                  }}
                >
                  <TouchableOpacity
                    activeOpacity={0.92}
                    onPress={() => openDetail(m)}
                    accessibilityRole="button"
                  >
                    <View style={styles.tileImageWrap}>
                      {m.coverUrl ? (
                        <StorageImage
                          uri={m.coverUrl}
                          style={styles.tileImage}
                          resizeMode="contain"
                        />
                      ) : (
                        <View style={styles.tilePlaceholder}>
                          <Text style={styles.tilePlaceholderText}>{m.name.charAt(0)}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.tileName} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text style={styles.tileMeta} numberOfLines={2}>
                    {uiCopy.discover.detailMeasurementHeight}{' '}
                    {m.measurements.height != null ? `${m.measurements.height} cm` : '—'} ·{' '}
                    {uiCopy.discover.detailMeasurementChest}{' '}
                    {m.measurements.chest != null ? `${m.measurements.chest} cm` : '—'} ·{' '}
                    {uiCopy.discover.detailMeasurementWaist}{' '}
                    {m.measurements.waist != null ? `${m.measurements.waist} cm` : '—'} ·{' '}
                    {uiCopy.discover.detailMeasurementHips}{' '}
                    {m.measurements.hips != null ? `${m.measurements.hips} cm` : '—'}
                  </Text>
                  {m.cityLine ? (
                    <Text style={styles.tileCity} numberOfLines={1}>
                      {m.cityLine}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Persistent CTA footer — adapts to auth state */}
      {!loading && models.length > 0 && (
        <View style={styles.ctaFooter}>
          <TouchableOpacity
            style={styles.ctaFooterBtn}
            onPress={handleSignUp}
            accessibilityRole="button"
          >
            <Text style={styles.ctaFooterLabel}>
              {isAuthenticated
                ? uiCopy.sharedSelection.continueToWorkspace
                : uiCopy.sharedSelection.footerCta}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Detail modal with multi-image navigation */}
      <Modal
        visible={detailOpen !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailOpen(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setDetailOpen(null)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalTopBar}>
              <TouchableOpacity
                onPress={() => setDetailOpen(null)}
                hitSlop={12}
                style={styles.modalBackBtn}
              >
                <Text style={styles.modalBackGlyph}>←</Text>
                <Text style={styles.modalBackLabel}>{uiCopy.discover.backToGallery}</Text>
              </TouchableOpacity>
            </View>
            {detailOpen ? (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} bounces={false}>
                <View style={styles.modalHeroWrap}>
                  {detailImages[detailImageIndex] || detailOpen.coverUrl ? (
                    <StorageImage
                      uri={detailImages[detailImageIndex] || detailOpen.coverUrl}
                      style={styles.modalHero}
                      resizeMode="contain"
                    />
                  ) : null}
                  {detailHasNav && (
                    <>
                      <TouchableOpacity
                        style={[styles.modalArrow, styles.modalArrowLeft]}
                        onPress={() => setDetailImageIndex((i) => Math.max(0, i - 1))}
                        disabled={detailImageIndex <= 0}
                      >
                        <Text
                          style={[
                            styles.modalArrowLabel,
                            detailImageIndex <= 0 && { opacity: 0.3 },
                          ]}
                        >
                          ‹
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalArrow, styles.modalArrowRight]}
                        onPress={() =>
                          setDetailImageIndex((i) => Math.min(detailImages.length - 1, i + 1))
                        }
                        disabled={detailImageIndex >= detailImages.length - 1}
                      >
                        <Text
                          style={[
                            styles.modalArrowLabel,
                            detailImageIndex >= detailImages.length - 1 && { opacity: 0.3 },
                          ]}
                        >
                          ›
                        </Text>
                      </TouchableOpacity>
                      <View style={styles.modalCounter}>
                        <Text style={styles.modalCounterLabel}>
                          {detailImageIndex + 1} / {detailImages.length}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
                <View style={styles.modalMetaBlock}>
                  <Text style={styles.detailName}>{detailOpen.name}</Text>
                  <Text style={styles.detailMeasurements}>
                    {uiCopy.discover.detailMeasurementHeight}{' '}
                    {detailOpen.measurements.height != null
                      ? `${detailOpen.measurements.height} cm`
                      : '—'}{' '}
                    · {uiCopy.discover.detailMeasurementChest}{' '}
                    {detailOpen.measurements.chest != null
                      ? `${detailOpen.measurements.chest} cm`
                      : '—'}{' '}
                    · {uiCopy.discover.detailMeasurementWaist}{' '}
                    {detailOpen.measurements.waist != null
                      ? `${detailOpen.measurements.waist} cm`
                      : '—'}{' '}
                    · {uiCopy.discover.detailMeasurementHips}{' '}
                    {detailOpen.measurements.hips != null
                      ? `${detailOpen.measurements.hips} cm`
                      : '—'}
                  </Text>
                  {detailOpen.cityLine ? (
                    <Text style={styles.detailCity}>{detailOpen.cityLine}</Text>
                  ) : null}
                  <TouchableOpacity style={styles.authGateBtn} onPress={showAuthGate}>
                    <Text style={styles.authGateBtnLabel}>
                      {uiCopy.sharedSelection.signUpToAccess}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Auth gate modal */}
      <Modal
        visible={authGateVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAuthGateVisible(false)}
      >
        <View style={styles.authGateBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setAuthGateVisible(false)}
          />
          <View style={styles.authGateCard}>
            <Text style={styles.authGateBrand}>INDEX CASTING</Text>
            <Text style={styles.authGateTitle}>{uiCopy.sharedSelection.signUpToAccess}</Text>
            <Text style={styles.authGateBody}>{uiCopy.sharedSelection.authGateBody}</Text>
            <TouchableOpacity style={styles.authGatePrimaryBtn} onPress={handleSignUp}>
              <Text style={styles.authGatePrimaryLabel}>
                {uiCopy.sharedSelection.authGateSignUp}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.authGateSecondaryBtn}
              onPress={() => setAuthGateVisible(false)}
            >
              <Text style={styles.authGateSecondaryLabel}>
                {uiCopy.sharedSelection.authGateContinue}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {Platform.OS === 'web' ? (
        <PdfExportModal
          visible={pdfExportOpen}
          onClose={() => setPdfExportOpen(false)}
          models={pdfModels}
          entityName={shareName || 'Shared Selection'}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  brand: {
    ...typography.headingCompact,
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 2,
  },
  title: {
    ...typography.headingCompact,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  metaText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  ctaFooter: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  ctaFooterBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 6,
  },
  ctaFooterLabel: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  tileImageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tilePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D5D0C8',
  },
  tilePlaceholderText: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tileName: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 6,
  },
  tileMeta: {
    ...typography.body,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 14,
  },
  tileCity: {
    ...typography.body,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '94%',
    zIndex: 1,
    elevation: 4,
    backgroundColor: colors.background,
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modalBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  modalBackGlyph: {
    fontSize: 22,
    color: colors.textPrimary,
  },
  modalBackLabel: {
    ...typography.body,
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
  },
  modalHeroWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: colors.surfaceAlt,
  },
  modalHero: {
    width: '100%',
    height: '100%',
  },
  modalArrow: {
    position: 'absolute',
    top: '42%',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 8,
  },
  modalArrowLeft: { left: 8 },
  modalArrowRight: { right: 8 },
  modalArrowLabel: {
    fontSize: 26,
    color: '#fff',
    lineHeight: 30,
  },
  modalCounter: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modalCounterLabel: {
    ...typography.label,
    fontSize: 12,
    color: '#fff',
  },
  modalMetaBlock: {
    padding: spacing.md,
  },
  detailName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  detailMeasurements: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  detailCity: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  authGateBtn: {
    marginTop: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: colors.textPrimary,
    borderRadius: 8,
    alignItems: 'center',
  },
  authGateBtnLabel: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
    color: colors.surface,
  },
  authGateBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  authGateCard: {
    width: '100%',
    maxWidth: 380,
    zIndex: 1,
    elevation: 4,
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
  },
  authGateBrand: {
    ...typography.headingCompact,
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  authGateTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  authGateBody: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  authGatePrimaryBtn: {
    width: '100%',
    paddingVertical: 12,
    backgroundColor: colors.textPrimary,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  authGatePrimaryLabel: {
    ...typography.label,
    fontSize: 15,
    fontWeight: '700',
    color: colors.surface,
  },
  authGateSecondaryBtn: {
    paddingVertical: 8,
  },
  authGateSecondaryLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
