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
  useWindowDimensions,
  View,
} from 'react-native';
import { showConfirmAlert } from '../utils/crossPlatformAlert';

import { StorageImage } from './StorageImage';

import { supabase } from '../../lib/supabase';
import { isImageFile } from '../../lib/validation/file';
import { uiCopy } from '../constants/uiCopy';
import {
  confirmImageRights,
  guardImageUpload,
  hasRecentImageRightsConfirmation,
  IMAGE_RIGHTS_WINDOW_MINUTES,
} from '../services/gdprComplianceSupabase';
import { resolveStorageUrl } from '../storage/storageUrl';
import { convertHeicToJpegWithStatus } from '../services/imageUtils';
import {
  addPhoto,
  deletePhoto,
  getPhotosForModel,
  migrateModelPhotoBucket,
  ModelPhoto,
  reorderPhotos,
  rebuildPolaroidsFromModelPhotos,
  rebuildPortfolioImagesFromModelPhotos,
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

type ResolvedPhoto = ModelPhoto & { displayUrl: string | null };

type Props = {
  modelId: string;
  /** `public.organizations.id` for GDPR audit (`image_rights_confirmations.org_id`). Never pass `agencies.id`. */
  organizationId?: string | null;
  /** Called whenever visible portfolio photos change so parent can track cover availability. */
  onHasVisiblePortfolioChange?: (hasVisible: boolean) => void;
  /** After aligning models.portfolio_images / polaroids with model_photos — refresh parent roster. */
  onReconcileComplete?: () => void;
};

const copy = uiCopy.modelMedia;
const legalCopy = uiCopy.legal;

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
  organizationId,
  onHasVisiblePortfolioChange,
  onReconcileComplete,
}) => {
  const [portfolio, setPortfolio] = useState<ResolvedPhoto[]>([]);
  const [polaroids, setPolaroids] = useState<ResolvedPhoto[]>([]);
  const [privatePhotos, setPrivatePhotos] = useState<ResolvedPhoto[]>([]);

  const [mediaViewMode, setMediaViewMode] = useState<'manage' | 'gallery'>('manage');
  const { width: _mediaPanelWidth } = useWindowDimensions();

  const [uploading, setUploading] = useState<'portfolio' | 'polaroid' | 'private' | null>(null);
  const [imageRightsConfirmed, setImageRightsConfirmed] = useState(false);
  /** True when audit row exists within IMAGE_RIGHTS_WINDOW_MINUTES — upload allowed even if checkbox was reset. */
  const [rightsAuditWindowActive, setRightsAuditWindowActive] = useState(false);
  const [newPortfolioUrl, setNewPortfolioUrl] = useState('');
  const [newPolaroidUrl, setNewPolaroidUrl] = useState('');
  /** Mutex to prevent parallel reorder / setCover / delete / toggle operations. */
  const operationInProgress = useRef(false);

  // ---------------------------------------------------------------------------
  // Move private → portfolio / polaroid (button + HTML5 drag-and-drop on web).
  // The actual storage work runs in `migrateModelPhotoBucket` (re-uploads the
  // file into the public `documentspictures` bucket and rewrites model_photos).
  // We keep a tiny per-photo lock so a double-click / double-drop cannot fire
  // two parallel migrations on the same row.
  // ---------------------------------------------------------------------------
  const [movingPhotoId, setMovingPhotoId] = useState<string | null>(null);
  /** Web-only: id of the private row currently being dragged, or `null`. */
  const [draggedPrivateId, setDraggedPrivateId] = useState<string | null>(null);
  /** Web-only: which target section is currently a hot drop zone, or `null`. */
  const [dragOverTarget, setDragOverTarget] = useState<'portfolio' | 'polaroid' | null>(null);
  const isWeb = Platform.OS === 'web';

  const portfolioInputRef = useRef<HTMLInputElement | null>(null);
  const polaroidInputRef = useRef<HTMLInputElement | null>(null);
  const privateInputRef = useRef<HTMLInputElement | null>(null);

  // ---------------------------------------------------------------------------
  // Stable callback refs — prevent re-creating loadPhotos when parent re-renders
  // with new inline function references (which would cause an infinite fetch loop:
  // parent re-render → new prop ref → new loadPhotos → useEffect → fetch →
  // onReconcileComplete → refreshAgencyModelLists → parent re-render → …).
  // ---------------------------------------------------------------------------
  const onHasVisiblePortfolioChangeRef = useRef(onHasVisiblePortfolioChange);
  const onReconcileCompleteRef = useRef(onReconcileComplete);

  useEffect(() => {
    onHasVisiblePortfolioChangeRef.current = onHasVisiblePortfolioChange;
  }, [onHasVisiblePortfolioChange]);
  useEffect(() => {
    onReconcileCompleteRef.current = onReconcileComplete;
  }, [onReconcileComplete]);

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
    onHasVisiblePortfolioChangeRef.current?.(resolvedPort.some((p) => p.is_visible_to_clients));
    // Align models.portfolio_images / models.polaroids with model_photos (fixes roster & client drift).
    const okPort = await rebuildPortfolioImagesFromModelPhotos(modelId);
    const okPol = await rebuildPolaroidsFromModelPhotos(modelId);
    if (!okPort) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(copy.portfolioColumnSyncFailed);
      } else {
        Alert.alert(uiCopy.common.error, copy.portfolioColumnSyncFailed);
      }
    }
    if (!okPol) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(copy.polaroidColumnSyncFailed);
      } else {
        Alert.alert(uiCopy.common.error, copy.polaroidColumnSyncFailed);
      }
    }
    onReconcileCompleteRef.current?.();
    // Only modelId in deps — callbacks are accessed via stable refs to avoid
    // re-creating this function (and re-triggering the useEffect) on every parent render.
  }, [modelId]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  // ---------------------------------------------------------------------------
  // Move a private row into Portfolio or Polaroids. Triggered both by the
  // explicit per-row buttons (mobile + web) and by drag-and-drop (web).
  // After success we just reload everything from the server so portfolio /
  // polaroid / private and the mirror columns stay perfectly in sync.
  // ---------------------------------------------------------------------------
  const handleMovePrivateToTarget = useCallback(
    async (photoId: string, targetType: 'portfolio' | 'polaroid') => {
      if (!photoId || movingPhotoId) return;
      setMovingPhotoId(photoId);
      try {
        const result = await migrateModelPhotoBucket(photoId, targetType);
        if (!result.ok) {
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.alert(copy.movePhotoFailed);
          } else {
            Alert.alert(uiCopy.common.error, copy.movePhotoFailed);
          }
          return;
        }
        await loadPhotos();
      } catch (e) {
        console.error('handleMovePrivateToTarget error:', e);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(copy.movePhotoFailed);
        } else {
          Alert.alert(uiCopy.common.error, copy.movePhotoFailed);
        }
      } finally {
        setMovingPhotoId(null);
      }
    },
    [movingPhotoId, loadPhotos],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        if (!cancelled) setRightsAuditWindowActive(false);
        return;
      }
      const active = await hasRecentImageRightsConfirmation(
        user.id,
        modelId,
        IMAGE_RIGHTS_WINDOW_MINUTES,
      );
      if (!cancelled) setRightsAuditWindowActive(active);
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  // ---------------------------------------------------------------------------
  // Sync helpers — keep models.portfolio_images and models.polaroids in sync
  // ---------------------------------------------------------------------------

  const syncPortfolio = useCallback(
    async (photos: ResolvedPhoto[]) => {
      const visibleUrls = photos.filter((p) => p.is_visible_to_clients).map((p) => p.url);
      const ok = await syncPortfolioToModel(modelId, visibleUrls);
      if (!ok) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(copy.portfolioColumnSyncFailed);
        } else {
          Alert.alert(uiCopy.common.error, copy.portfolioColumnSyncFailed);
        }
      }
      onHasVisiblePortfolioChangeRef.current?.(visibleUrls.length > 0);
    },
    [modelId],
  );

  const syncPolaroids = useCallback(
    async (photos: ResolvedPhoto[]) => {
      const visibleUrls = photos.filter((p) => p.is_visible_to_clients).map((p) => p.url);
      const ok = await syncPolaroidsToModel(modelId, visibleUrls);
      if (!ok) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(copy.polaroidColumnSyncFailed);
        } else {
          Alert.alert(uiCopy.common.error, copy.polaroidColumnSyncFailed);
        }
      }
    },
    [modelId],
  );

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  const handleUploadFiles = async (
    files: File[],
    section: 'portfolio' | 'polaroid' | 'private',
  ) => {
    if (!files.length) return;

    if (!imageRightsConfirmed && !rightsAuditWindowActive) {
      Alert.alert(copy.imageRightsRequiredTitle, copy.holdRightsBeforeUpload);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert(uiCopy.common.error, copy.signInToUploadPhotos);
      setUploading(null);
      return;
    }

    const rightsOk = await confirmImageRights({
      userId: user.id,
      modelId,
      orgId: organizationId ?? undefined,
    });
    if (!rightsOk.ok) {
      Alert.alert(copy.imageRightsRequiredTitle, legalCopy.imageRightsConfirmationFailed);
      setUploading(null);
      return;
    }
    const guard = await guardImageUpload(user.id, modelId);
    if (!guard.ok) {
      Alert.alert(copy.imageRightsRequiredTitle, legalCopy.imageRightsGuardVerificationFailed);
      setUploading(null);
      return;
    }

    setRightsAuditWindowActive(true);
    setUploading(section);
    try {
      for (const file of files) {
        const { file: prepared, conversionFailed } = await convertHeicToJpegWithStatus(file);
        if (conversionFailed) {
          Alert.alert(uiCopy.common.error, copy.heicConversionFailed);
          continue;
        }
        const uploadResult =
          section === 'private'
            ? await uploadPrivateModelPhoto(modelId, prepared)
            : await uploadModelPhoto(modelId, prepared);
        if (!uploadResult) {
          Alert.alert(uiCopy.common.error, copy.uploadError);
          continue;
        }
        const { url, fileSizeBytes } = uploadResult;
        const newRecord = await addPhoto(modelId, url, section, fileSizeBytes);
        if (!newRecord) {
          Alert.alert(uiCopy.common.error, copy.uploadError);
          continue;
        }
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
    const files = Array.from(e.target?.files ?? []).filter((f) => isImageFile(f));
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

    if (!imageRightsConfirmed && !rightsAuditWindowActive) {
      Alert.alert(copy.imageRightsRequiredTitle, copy.holdRightsBeforeAddUrl);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert(uiCopy.common.error, copy.signInToAddPhotos);
      return;
    }

    const rightsOk = await confirmImageRights({
      userId: user.id,
      modelId,
      orgId: organizationId ?? undefined,
    });
    if (!rightsOk.ok) {
      Alert.alert(copy.imageRightsRequiredTitle, legalCopy.imageRightsConfirmationFailed);
      return;
    }
    const guard = await guardImageUpload(user.id, modelId);
    if (!guard.ok) {
      Alert.alert(copy.imageRightsRequiredTitle, legalCopy.imageRightsGuardVerificationFailed);
      return;
    }

    setRightsAuditWindowActive(true);
    const newRecord = await addPhoto(modelId, trimmed, section);
    if (!newRecord) {
      Alert.alert(uiCopy.common.error, copy.uploadError);
      return;
    }
    const resolved = await resolveDisplayUrl(newRecord);
    if (section === 'portfolio') {
      setPortfolio((prev) => {
        const next = [...prev, resolved];
        void syncPortfolio(next);
        return next;
      });
    } else {
      setPolaroids((prev) => {
        const next = [...prev, resolved];
        void syncPolaroids(next);
        return next;
      });
    }
    clearFn();
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const confirmDelete = (photo: ResolvedPhoto, section: 'portfolio' | 'polaroid' | 'private') => {
    showConfirmAlert(
      copy.confirmDeleteTitle,
      copy.confirmDeleteMessage,
      () => void handleDelete(photo, section),
      copy.deleteConfirm,
      undefined,
      copy.deleteCancel,
    );
  };

  const handleDelete = async (
    photo: ResolvedPhoto,
    section: 'portfolio' | 'polaroid' | 'private',
  ) => {
    if (!photo.id || operationInProgress.current) return;
    operationInProgress.current = true;
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
        setPortfolio((prev) => {
          const next = prev.filter((p) => p.id !== photo.id);
          void syncPortfolio(next);
          return next;
        });
      } else if (section === 'polaroid') {
        setPolaroids((prev) => {
          const next = prev.filter((p) => p.id !== photo.id);
          void syncPolaroids(next);
          return next;
        });
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
    } finally {
      operationInProgress.current = false;
    }
  };

  // ---------------------------------------------------------------------------
  // Visibility toggle (portfolio + polaroid only)
  // ---------------------------------------------------------------------------

  const handleToggleVisibility = async (
    photo: ResolvedPhoto,
    section: 'portfolio' | 'polaroid',
  ) => {
    if (!photo.id || operationInProgress.current) return;
    operationInProgress.current = true;
    const next = !photo.is_visible_to_clients;
    try {
      const ok = await updatePhoto(photo.id, { is_visible_to_clients: next, visible: next });
      if (!ok) {
        Alert.alert(uiCopy.common.error, copy.toggleError);
        return;
      }
      const update = (prev: ResolvedPhoto[]) =>
        prev.map((p) =>
          p.id === photo.id ? { ...p, visible: next, is_visible_to_clients: next } : p,
        );
      if (section === 'portfolio') {
        setPortfolio((prev) => {
          const next2 = update(prev);
          void syncPortfolio(next2);
          return next2;
        });
      } else {
        setPolaroids((prev) => {
          const next2 = update(prev);
          void syncPolaroids(next2);
          return next2;
        });
      }
    } catch (e) {
      console.error('handleToggleVisibility error:', e);
      Alert.alert(uiCopy.common.error, copy.toggleError);
    } finally {
      operationInProgress.current = false;
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
    if (target < 0 || target >= list.length || operationInProgress.current) return;
    operationInProgress.current = true;
    const next = [...list];
    [next[idx], next[target]] = [next[target], next[idx]];
    setList(next);
    try {
      await reorderPhotos(
        modelId,
        next.map((p) => p.id!),
      );
      if (syncFn) await syncFn(next);
    } finally {
      operationInProgress.current = false;
    }
  };

  // ---------------------------------------------------------------------------
  // Set cover (portfolio only — moves to index 0)
  // ---------------------------------------------------------------------------

  const setCover = async (idx: number) => {
    if (idx === 0 || operationInProgress.current) return;
    operationInProgress.current = true;
    const next = [...portfolio];
    const [item] = next.splice(idx, 1);
    next.unshift(item);
    setPortfolio(next);
    try {
      await reorderPhotos(
        modelId,
        next.map((p) => p.id!),
      );
      await syncPortfolio(next);
    } finally {
      operationInProgress.current = false;
    }
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
    const isPrivate = section === 'private';
    const photoId = photo.id ?? null;
    const isMoving = isPrivate && photoId != null && movingPhotoId === photoId;
    const isDragging = isPrivate && photoId != null && draggedPrivateId === photoId;

    /* On web: make the private row draggable so the agency can drop it onto
     * the Portfolio / Polaroids sections (HTML5 DnD). On native we still
     * expose the explicit "→ Portfolio / → Polaroid" buttons below. RN-Web
     * forwards unknown props to the underlying <div>, so we can attach DnD
     * handlers via a typed cast. */
    const dndProps =
      isWeb && isPrivate && photoId != null
        ? ({
            draggable: true,
            onDragStart: (e: {
              dataTransfer?: { setData: (t: string, v: string) => void; effectAllowed?: string };
            }) => {
              try {
                e.dataTransfer?.setData('text/plain', photoId);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              } catch {
                /* no-op — some browsers reject custom mime types */
              }
              setDraggedPrivateId(photoId);
            },
            onDragEnd: () => {
              setDraggedPrivateId(null);
              setDragOverTarget(null);
            },
          } as Record<string, unknown>)
        : {};

    return (
      <View
        key={photo.id ?? `${section}-${idx}`}
        style={[s.photoRow, isDragging && s.photoRowDragging, isMoving && s.photoRowMoving]}
        {...dndProps}
      >
        {/* Thumbnail */}
        <Image
          source={{ uri: photo.displayUrl ?? undefined }}
          style={s.thumbnail}
          resizeMode="contain"
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
                {
                  color: photo.is_visible_to_clients
                    ? colors.buttonOptionGreen
                    : colors.textSecondary,
                },
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
          {showCoverBadge && <Text style={s.coverBadge}>{copy.coverLabel}</Text>}
          {showCoverBtn && (
            <TouchableOpacity onPress={() => void setCover(idx)} style={s.actionPill}>
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
              onPress={() =>
                void handleToggleVisibility(photo, section as 'portfolio' | 'polaroid')
              }
            >
              <Text style={s.arrowBtn}>{photo.is_visible_to_clients ? '👁' : '🚫'}</Text>
            </TouchableOpacity>
          )}
          {isPrivate && photoId != null && (
            <>
              <TouchableOpacity
                onPress={() => void handleMovePrivateToTarget(photoId, 'portfolio')}
                disabled={isMoving || movingPhotoId !== null}
                style={[s.movePill, (isMoving || movingPhotoId !== null) && s.movePillDisabled]}
              >
                <Text style={s.movePillLabel}>
                  {isMoving ? copy.movePhotoInProgress : copy.movePrivateToPortfolio}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void handleMovePrivateToTarget(photoId, 'polaroid')}
                disabled={isMoving || movingPhotoId !== null}
                style={[s.movePill, (isMoving || movingPhotoId !== null) && s.movePillDisabled]}
              >
                <Text style={s.movePillLabel}>
                  {isMoving ? copy.movePhotoInProgress : copy.movePrivateToPolaroid}
                </Text>
              </TouchableOpacity>
            </>
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
              accept="image/*,.heic,.heif"
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

  // ---------------------------------------------------------------------------
  // Gallery grid helper
  // ---------------------------------------------------------------------------
  const renderGalleryGrid = (photos: ResolvedPhoto[]) => {
    if (photos.length === 0) {
      return <Text style={s.emptyLabel}>{copy.noPhotos}</Text>;
    }
    const galColCount = _mediaPanelWidth >= 960 ? 4 : _mediaPanelWidth >= 640 ? 3 : 2;
    const galTileW =
      (_mediaPanelWidth - (galColCount - 1) * spacing.sm - spacing.md * 2) / galColCount;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {photos.map((photo) => (
          <View key={photo.id ?? photo.url} style={{ width: galTileW, marginBottom: spacing.xs }}>
            <View
              style={{
                width: '100%',
                aspectRatio: 3 / 4,
                borderRadius: 8,
                overflow: 'hidden',
                backgroundColor: colors.surfaceAlt ?? colors.border,
              }}
            >
              {photo.displayUrl ? (
                <StorageImage
                  uri={photo.displayUrl}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 22, color: colors.textSecondary }}>◻</Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderGallerySection = (title: string, hint: string, photos: ResolvedPhoto[]) => (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionHint}>{hint}</Text>
      {renderGalleryGrid(photos)}
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* ── View mode toggle: Manage / Gallery ──────────────────── */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {(['manage', 'gallery'] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            onPress={() => setMediaViewMode(mode)}
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: mediaViewMode === mode ? colors.textPrimary : colors.border,
              backgroundColor: mediaViewMode === mode ? colors.textPrimary : 'transparent',
            }}
          >
            <Text
              style={{
                ...typography.label,
                fontSize: 11,
                color: mediaViewMode === mode ? colors.surface : colors.textSecondary,
              }}
            >
              {mode === 'manage' ? copy.viewManage : copy.viewGallery}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Gallery mode ───────────────────────────────────────── */}
      {mediaViewMode === 'gallery' && (
        <>
          {renderGallerySection(copy.portfolioTitle, copy.portfolioHint, portfolio)}
          {renderGallerySection(copy.polaroidsTitle, copy.polaroidsHint, polaroids)}
          <View style={[s.privateSection, { marginBottom: spacing.lg }]}>
            <View style={s.privateHeader}>
              <Text style={[s.sectionTitle, s.privateSectionTitle]}>{copy.privateTitle}</Text>
              <Text style={s.privateSectionSubtitle}>{copy.privateSubtitle}</Text>
            </View>
            {renderGalleryGrid(privatePhotos)}
          </View>
        </>
      )}

      {/* ── Manage mode (existing) ─────────────────────────────── */}
      {mediaViewMode === 'manage' && (
        <>
          {/* ── IMAGE RIGHTS CONFIRMATION (required before any upload) ────── */}
          <TouchableOpacity
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              marginBottom: spacing.md,
              paddingTop: spacing.sm,
            }}
            onPress={() => setImageRightsConfirmed((v) => !v)}
            activeOpacity={0.8}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 3,
                borderWidth: 1.5,
                borderColor: imageRightsConfirmed ? colors.accentGreen : colors.buttonSkipRed,
                backgroundColor: imageRightsConfirmed ? colors.accentGreen : 'transparent',
                marginRight: 8,
                marginTop: 2,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {imageRightsConfirmed && (
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>✓</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  ...typography.body,
                  fontSize: 12,
                  color: imageRightsConfirmed ? colors.textSecondary : colors.buttonSkipRed,
                  fontWeight: imageRightsConfirmed ? '400' : '600',
                }}
              >
                {legalCopy.chatFileRightsCheckbox}
              </Text>
              <Text
                style={{ fontSize: 10, color: colors.textSecondary, marginTop: 4, lineHeight: 14 }}
              >
                {copy.imageRightsCheckboxSessionHint}
              </Text>
              {rightsAuditWindowActive ? (
                <Text
                  style={{
                    fontSize: 10,
                    color: colors.accentGreen ?? colors.success,
                    marginTop: 4,
                    lineHeight: 14,
                  }}
                >
                  {copy.imageRightsSessionActiveHint}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>

          {/* ── PORTFOLIO ───────────────────────────────────────────────────── */}
          <View
            style={[s.section, dragOverTarget === 'portfolio' && s.sectionDropActive]}
            {...(isWeb && draggedPrivateId
              ? ({
                  onDragOver: (e: {
                    preventDefault: () => void;
                    dataTransfer?: { dropEffect?: string };
                  }) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    if (dragOverTarget !== 'portfolio') setDragOverTarget('portfolio');
                  },
                  onDragLeave: () => {
                    if (dragOverTarget === 'portfolio') setDragOverTarget(null);
                  },
                  onDrop: (e: {
                    preventDefault: () => void;
                    dataTransfer?: { getData: (t: string) => string };
                  }) => {
                    e.preventDefault();
                    const id = e.dataTransfer?.getData('text/plain') || draggedPrivateId;
                    setDragOverTarget(null);
                    setDraggedPrivateId(null);
                    if (id) void handleMovePrivateToTarget(id, 'portfolio');
                  },
                } as Record<string, unknown>)
              : {})}
          >
            <Text style={s.sectionTitle}>{copy.portfolioTitle}</Text>
            <Text style={s.sectionHint}>{copy.portfolioHint}</Text>
            {isWeb && draggedPrivateId && (
              <Text style={s.dropHint}>{copy.dropToMoveToPortfolio}</Text>
            )}

            {portfolio.length === 0 && <Text style={s.emptyLabel}>{copy.noPhotos}</Text>}
            {portfolio.map((photo, idx) =>
              renderPhotoRow(photo, idx, portfolio, 'portfolio', setPortfolio, syncPortfolio),
            )}
            {renderUploadRow('portfolio')}
            {renderUrlInput('portfolio', newPortfolioUrl, setNewPortfolioUrl, () =>
              setNewPortfolioUrl(''),
            )}
          </View>

          {/* ── POLAROIDS ───────────────────────────────────────────────────── */}
          <View
            style={[s.section, dragOverTarget === 'polaroid' && s.sectionDropActive]}
            {...(isWeb && draggedPrivateId
              ? ({
                  onDragOver: (e: {
                    preventDefault: () => void;
                    dataTransfer?: { dropEffect?: string };
                  }) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    if (dragOverTarget !== 'polaroid') setDragOverTarget('polaroid');
                  },
                  onDragLeave: () => {
                    if (dragOverTarget === 'polaroid') setDragOverTarget(null);
                  },
                  onDrop: (e: {
                    preventDefault: () => void;
                    dataTransfer?: { getData: (t: string) => string };
                  }) => {
                    e.preventDefault();
                    const id = e.dataTransfer?.getData('text/plain') || draggedPrivateId;
                    setDragOverTarget(null);
                    setDraggedPrivateId(null);
                    if (id) void handleMovePrivateToTarget(id, 'polaroid');
                  },
                } as Record<string, unknown>)
              : {})}
          >
            <Text style={s.sectionTitle}>{copy.polaroidsTitle}</Text>
            <Text style={s.sectionHint}>{copy.polaroidsHint}</Text>
            {isWeb && draggedPrivateId && (
              <Text style={s.dropHint}>{copy.dropToMoveToPolaroid}</Text>
            )}

            {polaroids.length === 0 && <Text style={s.emptyLabel}>{copy.noPhotos}</Text>}
            {polaroids.map((photo, idx) =>
              renderPhotoRow(photo, idx, polaroids, 'polaroid', setPolaroids, syncPolaroids),
            )}
            {renderUploadRow('polaroid')}
            {renderUrlInput('polaroid', newPolaroidUrl, setNewPolaroidUrl, () =>
              setNewPolaroidUrl(''),
            )}
          </View>

          {/* ── PRIVATE FOLDER ──────────────────────────────────────────────── */}
          <View style={[s.section, s.privateSection]}>
            <View style={s.privateHeader}>
              <Text style={[s.sectionTitle, s.privateSectionTitle]}>{copy.privateTitle}</Text>
              <Text style={s.privateSectionSubtitle}>{copy.privateSubtitle}</Text>
              {isWeb && privatePhotos.length > 0 && (
                <Text style={s.privateDragHint}>{copy.privateDragHint}</Text>
              )}
            </View>

            {privatePhotos.length === 0 && (
              <Text style={[s.emptyLabel, { color: colors.textSecondary }]}>{copy.noPhotos}</Text>
            )}
            {privatePhotos.map((photo, idx) =>
              renderPhotoRow(photo, idx, privatePhotos, 'private', setPrivatePhotos),
            )}
            {renderUploadRow('private')}
          </View>
        </>
      )}
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
  photoRowDragging: {
    opacity: 0.5,
  },
  photoRowMoving: {
    opacity: 0.6,
  },
  sectionDropActive: {
    backgroundColor: '#EAF6EC',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.buttonOptionGreen,
    borderStyle: 'dashed',
    paddingHorizontal: spacing.sm,
  },
  dropHint: {
    ...typography.label,
    fontSize: 11,
    color: colors.buttonOptionGreen,
    marginBottom: spacing.sm,
  },
  privateDragHint: {
    ...typography.body,
    fontSize: 10,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  movePill: {
    borderWidth: 1,
    borderColor: colors.accentBrown,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginHorizontal: 2,
  },
  movePillDisabled: {
    opacity: 0.5,
  },
  movePillLabel: {
    ...typography.label,
    fontSize: 9,
    color: colors.accentBrown,
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
