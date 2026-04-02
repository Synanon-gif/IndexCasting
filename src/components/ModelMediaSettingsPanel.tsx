/**
 * ModelMediaSettingsPanel
 *
 * Self-contained 3-section media manager for a model:
 *   1. Portfolio   – visible to clients by default, first image = cover
 *   2. Polaroids   – optional client visibility, included in packages when agency opts in
 *   3. Private Folder – agency-only, NEVER visible to clients, stored in private bucket
 *
 * Each action (upload, delete, visibility toggle, reorder) is persisted immediately to
 * Supabase — no external "Save" button needed. After portfolio / polaroid changes the
 * parent models.portfolio_images / models.polaroids columns are kept in sync so that
 * discovery and the swipe card always show the correct cover.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { uiCopy } from '../constants/uiCopy';
import { resolveStorageUrl } from '../storage/storageUrl';
import {
  addPhoto,
  deletePhoto,
  getPhotosForModel,
  ModelPhoto,
  reorderPhotos,
  syncPolaroidsToModel,
  syncPortfolioToModel,
  updatePhoto,
  uploadModelPhoto,
  uploadPrivateModelPhoto,
} from '../services/modelPhotosSupabase';
import { colors, spacing, typography } from '../theme/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResolvedPhoto = ModelPhoto & { displayUrl: string };

type Props = {
  modelId: string;
  agencyId: string;
  /** Called whenever visible portfolio photos change so parent can track cover availability. */
  onHasVisiblePortfolioChange?: (hasVisible: boolean) => void;
};

const copy = uiCopy.modelMedia;

// ---------------------------------------------------------------------------
// Helper: resolve storage URLs to signed URLs for all photo types.
// M-3 fix: portfolio and polaroid photos now live in a private bucket and
// require signed URL resolution, identical to private photos.
// ---------------------------------------------------------------------------
async function resolveDisplayUrl(photo: ModelPhoto): Promise<ResolvedPhoto> {
  const displayUrl = await resolveStorageUrl(photo.url, 3_600);
  return { ...photo, displayUrl };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ModelMediaSettingsPanel: React.FC<Props> = ({
  modelId,
  agencyId,
  onHasVisiblePortfolioChange,
}) => {
  const [portfolio, setPortfolio] = useState<ResolvedPhoto[]>([]);
  const [polaroids, setPolaroids] = useState<ResolvedPhoto[]>([]);
  const [privatePhotos, setPrivatePhotos] = useState<ResolvedPhoto[]>([]);

  const [uploading, setUploading] = useState<'portfolio' | 'polaroid' | 'private' | null>(null);
  const [newPortfolioUrl, setNewPortfolioUrl] = useState('');
  const [newPolaroidUrl, setNewPolaroidUrl] = useState('');

  const portfolioInputRef = useRef<HTMLInputElement | null>(null);
  const polaroidInputRef = useRef<HTMLInputElement | null>(null);
  const privateInputRef = useRef<HTMLInputElement | null>(null);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const loadPhotos = useCallback(async () => {
    const [port, pola, priv] = await Promise.all([
      getPhotosForModel(modelId, 'portfolio'),
      getPhotosForModel(modelId, 'polaroid'),
      getPhotosForModel(modelId, 'private'),
    ]);
    const [resolvedPort, resolvedPola, resolvedPriv] = await Promise.all([
      Promise.all(port.map(resolveDisplayUrl)),
      Promise.all(pola.map(resolveDisplayUrl)),
      Promise.all(priv.map(resolveDisplayUrl)),
    ]);
    setPortfolio(resolvedPort);
    setPolaroids(resolvedPola);
    setPrivatePhotos(resolvedPriv);
    onHasVisiblePortfolioChange?.(resolvedPort.some((p) => p.is_visible_to_clients));
  }, [modelId, onHasVisiblePortfolioChange]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  // ---------------------------------------------------------------------------
  // Sync helpers — keep models.portfolio_images and models.polaroids in sync
  // ---------------------------------------------------------------------------

  const syncPortfolio = useCallback(async (photos: ResolvedPhoto[]) => {
    const visibleUrls = photos.filter((p) => p.is_visible_to_clients).map((p) => p.url);
    await syncPortfolioToModel(modelId, visibleUrls);
    onHasVisiblePortfolioChange?.(visibleUrls.length > 0);
  }, [modelId, onHasVisiblePortfolioChange]);

  const syncPolaroids = useCallback(async (photos: ResolvedPhoto[]) => {
    const visibleUrls = photos.filter((p) => p.is_visible_to_clients).map((p) => p.url);
    await syncPolaroidsToModel(modelId, visibleUrls);
  }, [modelId]);

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  const handleUploadFiles = async (
    files: File[],
    section: 'portfolio' | 'polaroid' | 'private',
  ) => {
    if (!files.length) return;
    setUploading(section);
    try {
      for (const file of files) {
        const uploadResult = section === 'private'
          ? await uploadPrivateModelPhoto(modelId, file)
          : await uploadModelPhoto(modelId, file);
        if (!uploadResult) continue;
        const { url, fileSizeBytes } = uploadResult;
        const newRecord = await addPhoto(modelId, url, section, fileSizeBytes);
        if (!newRecord) continue;
        const resolved = await resolveDisplayUrl(newRecord);
        if (section === 'portfolio') {
          setPortfolio((prev) => {
            const next = [...prev, resolved];
            void syncPortfolio(next);
            return next;
          });
        } else if (section === 'polaroid') {
          setPolaroids((prev) => {
            const next = [...prev, resolved];
            void syncPolaroids(next);
            return next;
          });
        } else {
          setPrivatePhotos((prev) => [...prev, resolved]);
        }
      }
    } catch (e) {
      console.error('handleUploadFiles error:', e);
      Alert.alert(uiCopy.common.error, copy.uploadError);
    } finally {
      setUploading(null);
    }
  };

  const handleWebFileInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    section: 'portfolio' | 'polaroid' | 'private',
  ) => {
    const files = Array.from(e.target?.files ?? []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (files.length) void handleUploadFiles(files, section);
  };

  // ---------------------------------------------------------------------------
  // Add via URL (portfolio + polaroid only)
  // ---------------------------------------------------------------------------

  const handleAddUrl = async (
    urlValue: string,
    section: 'portfolio' | 'polaroid',
    clearFn: () => void,
  ) => {
    const trimmed = urlValue.trim();
    if (!trimmed) return;
    const newRecord = await addPhoto(modelId, trimmed, section);
    if (!newRecord) { Alert.alert(uiCopy.common.error, copy.uploadError); return; }
    const resolved = await resolveDisplayUrl(newRecord);
    if (section === 'portfolio') {
      setPortfolio((prev) => { const next = [...prev, resolved]; void syncPortfolio(next); return next; });
    } else {
      setPolaroids((prev) => { const next = [...prev, resolved]; void syncPolaroids(next); return next; });
    }
    clearFn();
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const confirmDelete = (photo: ResolvedPhoto, section: 'portfolio' | 'polaroid' | 'private') => {
    if (Platform.OS === 'web') {
      // window.confirm works reliably on web; Alert.alert callback does not.
      if (typeof window !== 'undefined' && window.confirm(copy.confirmDeleteMessage)) {
        void handleDelete(photo, section);
      }
      return;
    }
    Alert.alert(copy.confirmDeleteTitle, copy.confirmDeleteMessage, [
      { text: copy.deleteCancel, style: 'cancel' },
      {
        text: copy.deleteConfirm,
        style: 'destructive',
        onPress: () => void handleDelete(photo, section),
      },
    ]);
  };

  const handleDelete = async (photo: ResolvedPhoto, section: 'portfolio' | 'polaroid' | 'private') => {
    if (!photo.id) return;
    try {
      const ok = await deletePhoto(photo.id, photo.url);
      if (!ok) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(copy.deleteError);
        } else {
          Alert.alert(uiCopy.common.error, copy.deleteError);
        }
        return;
      }
      if (section === 'portfolio') {
        setPortfolio((prev) => { const next = prev.filter((p) => p.id !== photo.id); void syncPortfolio(next); return next; });
      } else if (section === 'polaroid') {
        setPolaroids((prev) => { const next = prev.filter((p) => p.id !== photo.id); void syncPolaroids(next); return next; });
      } else {
        setPrivatePhotos((prev) => prev.filter((p) => p.id !== photo.id));
      }
    } catch (e) {
      console.error('handleDelete error:', e);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(copy.deleteError);
      } else {
        Alert.alert(uiCopy.common.error, copy.deleteError);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Visibility toggle (portfolio + polaroid only)
  // ---------------------------------------------------------------------------

  const handleToggleVisibility = async (
    photo: ResolvedPhoto,
    section: 'portfolio' | 'polaroid',
  ) => {
    if (!photo.id) return;
    const next = !photo.is_visible_to_clients;
    try {
      const ok = await updatePhoto(photo.id, { is_visible_to_clients: next, visible: next });
      if (!ok) { Alert.alert(uiCopy.common.error, copy.toggleError); return; }
      const update = (prev: ResolvedPhoto[]) =>
        prev.map((p) =>
          p.id === photo.id ? { ...p, visible: next, is_visible_to_clients: next } : p,
        );
      if (section === 'portfolio') {
        setPortfolio((prev) => { const next2 = update(prev); void syncPortfolio(next2); return next2; });
      } else {
        setPolaroids((prev) => { const next2 = update(prev); void syncPolaroids(next2); return next2; });
      }
    } catch (e) {
      console.error('handleToggleVisibility error:', e);
      Alert.alert(uiCopy.common.error, copy.toggleError);
    }
  };

  // ---------------------------------------------------------------------------
  // Reorder (move up / down)
  // ---------------------------------------------------------------------------

  const moveItem = async (
    idx: number,
    dir: -1 | 1,
    list: ResolvedPhoto[],
    setList: React.Dispatch<React.SetStateAction<ResolvedPhoto[]>>,
    syncFn?: (photos: ResolvedPhoto[]) => Promise<void>,
  ) => {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[idx], next[target]] = [next[target], next[idx]];
    setList(next);
    void reorderPhotos(modelId, next.map((p) => p.id!));
    if (syncFn) void syncFn(next);
  };

  // ---------------------------------------------------------------------------
  // Set cover (portfolio only — moves to index 0)
  // ---------------------------------------------------------------------------

  const setCover = async (idx: number) => {
    if (idx === 0) return;
    const next = [...portfolio];
    const [item] = next.splice(idx, 1);
    next.unshift(item);
    setPortfolio(next);
    void reorderPhotos(modelId, next.map((p) => p.id!));
    void syncPortfolio(next);
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderPhotoRow = (
    photo: ResolvedPhoto,
    idx: number,
    list: ResolvedPhoto[],
    section: 'portfolio' | 'polaroid' | 'private',
    setList: React.Dispatch<React.SetStateAction<ResolvedPhoto[]>>,
    syncFn?: (photos: ResolvedPhoto[]) => Promise<void>,
  ) => {
    const isFirst = idx === 0;
    const isLast = idx === list.length - 1;
    const showCoverBadge = section === 'portfolio' && isFirst;
    const showCoverBtn = section === 'portfolio' && !isFirst;

    return (
      <View key={photo.id ?? `${section}-${idx}`} style={s.photoRow}>
        {/* Thumbnail */}
        <Image
          source={{ uri: photo.displayUrl }}
          style={s.thumbnail}
          resizeMode="cover"
        />

        {/* Label */}
        <View style={s.photoInfo}>
          <Text style={s.photoLabel} numberOfLines={1}>
            {photo.displayUrl
              ? photo.displayUrl.length > 42
                ? photo.displayUrl.slice(0, 39) + '…'
                : photo.displayUrl
              : `${section} ${idx + 1}`}
          </Text>
          {section !== 'private' && (
            <Text
              style={[
                s.visibilityBadge,
                { color: photo.is_visible_to_clients ? colors.buttonOptionGreen : colors.textSecondary },
              ]}
            >
              {copy.showToClients}: {photo.is_visible_to_clients ? 'Yes' : 'No'}
            </Text>
          )}
          {section === 'private' && (
            <Text style={[s.visibilityBadge, { color: colors.textSecondary }]}>
              {copy.privateSubtitle}
            </Text>
          )}
        </View>

        {/* Actions */}
        <View style={s.photoActions}>
          {showCoverBadge && (
            <Text style={s.coverBadge}>{copy.coverLabel}</Text>
          )}
          {showCoverBtn && (
            <TouchableOpacity
              onPress={() => void setCover(idx)}
              style={s.actionPill}
            >
              <Text style={s.actionPillLabel}>{copy.setCover}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => void moveItem(idx, -1, list, setList, syncFn)}
            disabled={isFirst}
          >
            <Text style={[s.arrowBtn, isFirst && s.arrowDisabled]}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void moveItem(idx, 1, list, setList, syncFn)}
            disabled={isLast}
          >
            <Text style={[s.arrowBtn, isLast && s.arrowDisabled]}>↓</Text>
          </TouchableOpacity>
          {section !== 'private' && (
            <TouchableOpacity
              onPress={() => void handleToggleVisibility(photo, section as 'portfolio' | 'polaroid')}
            >
              <Text style={s.arrowBtn}>{photo.is_visible_to_clients ? '👁' : '🚫'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => confirmDelete(photo, section)}>
            <Text style={s.deleteBtn}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderUploadRow = (section: 'portfolio' | 'polaroid' | 'private') => {
    const isUploading = uploading === section;
    const ref =
      section === 'portfolio'
        ? portfolioInputRef
        : section === 'polaroid'
        ? polaroidInputRef
        : privateInputRef;

    return (
      <View style={s.uploadRow}>
        {typeof window !== 'undefined' && (
          <>
            {/* Hidden native file input for web */}
            <input
              type="file"
              accept="image/*"
              multiple
              ref={ref as React.RefObject<HTMLInputElement>}
              onChange={(e) => handleWebFileInput(e, section)}
              style={{ display: 'none' }}
            />
            <TouchableOpacity
              style={[s.uploadBtn, isUploading && { opacity: 0.5 }]}
              onPress={() => ref.current?.click()}
              disabled={isUploading}
            >
              <Text style={s.uploadBtnLabel}>
                {isUploading ? copy.uploading : `+ ${copy.uploadPhotos}`}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  const renderUrlInput = (
    section: 'portfolio' | 'polaroid',
    value: string,
    onChange: (v: string) => void,
    clearFn: () => void,
  ) => (
    <View style={{ marginTop: spacing.xs }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={copy.orPasteUrl}
        placeholderTextColor={colors.textSecondary}
        style={s.urlInput}
      />
      <TouchableOpacity
        onPress={() => void handleAddUrl(value, section, clearFn)}
        style={s.addUrlBtn}
      >
        <Text style={s.uploadBtnLabel}>{copy.addUrl}</Text>
      </TouchableOpacity>
    </View>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* ── PORTFOLIO ───────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>{copy.portfolioTitle}</Text>
        <Text style={s.sectionHint}>{copy.portfolioHint}</Text>

        {portfolio.length === 0 && (
          <Text style={s.emptyLabel}>{copy.noPhotos}</Text>
        )}
        {portfolio.map((photo, idx) =>
          renderPhotoRow(photo, idx, portfolio, 'portfolio', setPortfolio, syncPortfolio),
        )}
        {renderUploadRow('portfolio')}
        {renderUrlInput(
          'portfolio',
          newPortfolioUrl,
          setNewPortfolioUrl,
          () => setNewPortfolioUrl(''),
        )}
      </View>

      {/* ── POLAROIDS ───────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>{copy.polaroidsTitle}</Text>
        <Text style={s.sectionHint}>{copy.polaroidsHint}</Text>

        {polaroids.length === 0 && (
          <Text style={s.emptyLabel}>{copy.noPhotos}</Text>
        )}
        {polaroids.map((photo, idx) =>
          renderPhotoRow(photo, idx, polaroids, 'polaroid', setPolaroids, syncPolaroids),
        )}
        {renderUploadRow('polaroid')}
        {renderUrlInput(
          'polaroid',
          newPolaroidUrl,
          setNewPolaroidUrl,
          () => setNewPolaroidUrl(''),
        )}
      </View>

      {/* ── PRIVATE FOLDER ──────────────────────────────────────────────── */}
      <View style={[s.section, s.privateSection]}>
        <View style={s.privateHeader}>
          <Text style={[s.sectionTitle, s.privateSectionTitle]}>{copy.privateTitle}</Text>
          <Text style={s.privateSectionSubtitle}>{copy.privateSubtitle}</Text>
        </View>

        {privatePhotos.length === 0 && (
          <Text style={[s.emptyLabel, { color: colors.textSecondary }]}>{copy.noPhotos}</Text>
        )}
        {privatePhotos.map((photo, idx) =>
          renderPhotoRow(photo, idx, privatePhotos, 'private', setPrivatePhotos),
        )}
        {renderUploadRow('private')}
      </View>
    </ScrollView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  privateSection: {
    backgroundColor: '#F3F1EC',
    borderRadius: 8,
    padding: spacing.md,
    borderTopWidth: 0,
  },
  privateHeader: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  privateSectionTitle: {
    color: colors.accentBrown,
  },
  sectionHint: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  privateSectionSubtitle: {
    ...typography.body,
    fontSize: 11,
    color: colors.accentBrown,
    marginBottom: spacing.sm,
  },
  emptyLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 4,
    marginRight: spacing.sm,
    backgroundColor: colors.border,
  },
  photoInfo: {
    flex: 1,
  },
  photoLabel: {
    ...typography.body,
    fontSize: 11,
  },
  visibilityBadge: {
    ...typography.label,
    fontSize: 9,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  coverBadge: {
    ...typography.label,
    fontSize: 9,
    color: colors.buttonOptionGreen,
  },
  actionPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  actionPillLabel: {
    ...typography.label,
    fontSize: 9,
    color: colors.textPrimary,
  },
  arrowBtn: {
    fontSize: 15,
    color: colors.textPrimary,
    paddingHorizontal: 2,
  },
  arrowDisabled: {
    color: colors.textSecondary,
  },
  deleteBtn: {
    fontSize: 14,
    color: colors.buttonSkipRed,
    paddingHorizontal: 4,
  },
  uploadRow: {
    marginTop: spacing.sm,
  },
  uploadBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  uploadBtnLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  urlInput: {
    ...typography.body,
    fontSize: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    height: 36,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  addUrlBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
});
