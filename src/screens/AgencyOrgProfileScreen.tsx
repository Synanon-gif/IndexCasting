/**
 * AgencyOrgProfileScreen — Phase 2A/2C.1/2C.2 (internal)
 *
 * Shows the agency organization's profile:
 *  - Logo, name, description, contact info
 *  - Women / Men segmented model roster
 *  - 3-column alphabetical grid with model cover + name
 *
 * Access: agency owner + booker (RLS enforced server-side).
 * Phase 2C.1: owner can edit text/contact fields via OrgProfileEditModal.
 * Phase 2C.2: owner can upload/replace/delete the organization logo.
 * No public access in this phase.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { StorageImage } from '../components/StorageImage';
import {
  getOrganizationProfile,
  type OrganizationProfile,
} from '../services/organizationProfilesSupabase';
import { OrgProfileEditModal } from '../components/OrgProfileEditModal';
import {
  uploadOrganizationLogo,
  deleteOrganizationLogo,
} from '../services/organizationLogoSupabase';
import {
  getModelsForAgencyFromSupabase,
  type SupabaseModel,
} from '../services/modelsSupabase';
import {
  filterAndSortModelsBySegment,
  type ModelSegment,
} from '../utils/orgProfileHelpers';

// ─── Types ────────────────────────────────────────────────────────────────────

type Segment = ModelSegment;

export interface AgencyOrgProfileScreenProps {
  organizationId: string | null;
  agencyId: string | null;
  /** Display name of the organisation (from profile.company_name). */
  orgName: string | null;
  /** 'owner' | 'booker' | null */
  orgMemberRole: string | null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function AgencyOrgProfileScreen({
  organizationId,
  agencyId,
  orgName,
  orgMemberRole,
}: AgencyOrgProfileScreenProps): React.ReactElement {
  const [orgProfile, setOrgProfile] = useState<OrganizationProfile | null>(null);
  const [models, setModels] = useState<SupabaseModel[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);
  const [segment, setSegment] = useState<Segment>('women');
  const [editOpen, setEditOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { width } = useWindowDimensions();
  const CELL_GAP = spacing.xs;
  const H_PAD = spacing.md * 2;
  const cellWidth = Math.floor((width - H_PAD - CELL_GAP * 2) / 3);

  const isOwner = orgMemberRole === 'owner';
  const loading = loadingProfile || loadingModels;

  // Load org profile
  useEffect(() => {
    if (!organizationId) {
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    void getOrganizationProfile(organizationId).then((p) => {
      setOrgProfile(p);
      setLoadingProfile(false);
    });
  }, [organizationId]);

  // Load agency models
  useEffect(() => {
    if (!agencyId) {
      setLoadingModels(false);
      return;
    }
    setLoadingModels(true);
    void getModelsForAgencyFromSupabase(agencyId).then((m) => {
      setModels(m);
      setLoadingModels(false);
    });
  }, [agencyId]);

  const filteredModels = useMemo(
    () => filterAndSortModelsBySegment(models, segment),
    [models, segment],
  );

  // ── Logo upload handlers (owner-only, web file input pattern) ──

  const handleLogoPress = useCallback(() => {
    if (!isOwner || logoUploading) return;
    fileInputRef.current?.click();
  }, [isOwner, logoUploading]);

  const handleLogoFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !organizationId) return;
      // Reset so the same file can be re-selected after an error
      e.target.value = '';

      setLogoUploading(true);
      const result = await uploadOrganizationLogo(organizationId, file);
      setLogoUploading(false);

      if (result.ok && result.url) {
        setOrgProfile((prev) => (prev ? { ...prev, logo_url: result.url! } : prev));
      } else {
        Alert.alert('Upload failed', result.error ?? 'Could not upload logo. Please try again.');
      }
    },
    [organizationId],
  );

  const handleLogoDelete = useCallback(async () => {
    if (!organizationId || !orgProfile?.logo_url) return;
    Alert.alert('Remove logo', 'Remove the current logo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setLogoUploading(true);
          const ok = await deleteOrganizationLogo(organizationId, orgProfile.logo_url);
          setLogoUploading(false);
          if (ok) {
            setOrgProfile((prev) => (prev ? { ...prev, logo_url: null } : prev));
          } else {
            Alert.alert('Error', 'Could not remove logo. Please try again.');
          }
        },
      },
    ]);
  }, [organizationId, orgProfile?.logo_url]);

  const renderModel = useCallback(
    ({ item }: ListRenderItemInfo<SupabaseModel>) => {
      const coverUri = item.portfolio_images?.[0] ?? null;
      const imgH = Math.floor(cellWidth * 1.35);
      return (
        <View style={[s.cell, { width: cellWidth }]}>
          {coverUri ? (
            <StorageImage
              uri={coverUri}
              style={{ width: cellWidth, height: imgH, borderRadius: 4 }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                s.cellPlaceholder,
                { width: cellWidth, height: imgH, borderRadius: 4 },
              ]}
            >
              <Text style={s.cellInitial}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={s.cellName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
      );
    },
    [cellWidth],
  );

  const renderHeader = useCallback(() => {
    const addr = [orgProfile?.address_line_1, orgProfile?.city, orgProfile?.country]
      .filter(Boolean)
      .join(', ');

    return (
      <View>
        {/* ── Profile header ── */}
        <View style={s.headerSection}>
          {/* Logo — tappable for owner to upload/replace */}
          <TouchableOpacity
            style={s.logoWrap}
            onPress={handleLogoPress}
            onLongPress={isOwner && orgProfile?.logo_url ? handleLogoDelete : undefined}
            disabled={!isOwner || logoUploading}
            accessibilityLabel={isOwner ? 'Change logo' : undefined}
            accessibilityRole={isOwner ? 'button' : 'image'}
            activeOpacity={isOwner ? 0.7 : 1}
          >
            {orgProfile?.logo_url ? (
              <StorageImage uri={orgProfile.logo_url} style={s.logo} resizeMode="cover" />
            ) : (
              <View style={[s.logo, s.logoPlaceholder]}>
                {logoUploading ? (
                  <ActivityIndicator color={colors.textSecondary} />
                ) : (
                  <Text style={s.logoInitial}>
                    {(orgName ?? '?').charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
            )}
            {/* Edit overlay badge — visible to owner only */}
            {isOwner && !logoUploading && (
              <View style={s.logoEditBadge}>
                <Text style={s.logoEditBadgeText}>✎</Text>
              </View>
            )}
            {logoUploading && orgProfile?.logo_url ? (
              <View style={s.logoUploadingOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </TouchableOpacity>
          {/* Hidden file input for web */}
          {isOwner && (
            // @ts-ignore — input element only exists on web; ignored on native
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleLogoFileChange}
            />
          )}

          <Text style={s.orgName}>{orgName ?? '—'}</Text>

          {/* Owner-only Edit CTA (Phase 2C.1) */}
          {isOwner && (
            <TouchableOpacity
              style={s.editCta}
              onPress={() => setEditOpen(true)}
              accessibilityLabel="Edit profile"
              accessibilityRole="button"
            >
              <Text style={s.editCtaText}>Edit Profile</Text>
            </TouchableOpacity>
          )}

          {orgProfile?.description ? (
            <Text style={s.description}>{orgProfile.description}</Text>
          ) : null}

          {addr ? <Text style={s.meta}>{addr}</Text> : null}
          {orgProfile?.website_url ? (
            <Text style={s.meta}>{orgProfile.website_url}</Text>
          ) : null}
          {orgProfile?.contact_email ? (
            <Text style={s.meta}>{orgProfile.contact_email}</Text>
          ) : null}
          {orgProfile?.contact_phone ? (
            <Text style={s.meta}>{orgProfile.contact_phone}</Text>
          ) : null}

          {/* Empty profile hint for owner */}
          {isOwner && !orgProfile?.description && !addr && !orgProfile?.website_url && (
            <Text style={s.emptyHint}>
              Add a description, address and contact info to complete your profile.
            </Text>
          )}
        </View>

        {/* ── Segment bar ── */}
        <View style={s.segmentBar}>
          {(['women', 'men'] as Segment[]).map((seg) => (
            <TouchableOpacity
              key={seg}
              onPress={() => setSegment(seg)}
              style={s.segmentItem}
            >
              <Text
                style={[s.segmentLabel, segment === seg && s.segmentLabelActive]}
              >
                {seg === 'women' ? 'Women' : 'Men'}
              </Text>
              {segment === seg && <View style={s.segmentUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Empty state — no models in this segment */}
        {!loading && filteredModels.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>
              No {segment === 'women' ? 'women' : 'men'} models in this roster yet.
            </Text>
          </View>
        )}
      </View>
    );
  }, [
    orgProfile,
    orgName,
    isOwner,
    segment,
    filteredModels.length,
    loading,
    logoUploading,
    handleLogoPress,
    handleLogoDelete,
    handleLogoFileChange,
  ]);

  if (loading) {
    return (
      <View style={s.loaderWrap}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList<SupabaseModel>
        // key forces re-mount when segment changes to reset scroll position
        key={segment}
        data={filteredModels}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={renderModel}
        ListHeaderComponent={renderHeader}
        columnWrapperStyle={s.row}
        contentContainerStyle={s.listContent}
        style={{ flex: 1, backgroundColor: colors.background }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={9}
        maxToRenderPerBatch={9}
      />
      {isOwner && organizationId && editOpen && (
        <OrgProfileEditModal
          visible
          onClose={() => setEditOpen(false)}
          organizationId={organizationId}
          initialValues={{
            description: orgProfile?.description ?? null,
            address_line_1: orgProfile?.address_line_1 ?? null,
            city: orgProfile?.city ?? null,
            postal_code: orgProfile?.postal_code ?? null,
            country: orgProfile?.country ?? null,
            website_url: orgProfile?.website_url ?? null,
            contact_email: orgProfile?.contact_email ?? null,
            contact_phone: orgProfile?.contact_phone ?? null,
          }}
          onSaved={(updated) => {
            setOrgProfile((prev) => (prev ? { ...prev, ...updated } : prev));
            setEditOpen(false);
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const LOGO_SIZE = 72;

const s = StyleSheet.create({
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 120,
  },
  headerSection: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  logoWrap: {
    marginBottom: spacing.sm,
    position: 'relative',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    overflow: 'hidden',
  },
  logoPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitial: {
    ...typography.heading,
    fontSize: 28,
    color: colors.textSecondary,
  },
  logoEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEditBadgeText: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 14,
  },
  logoUploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  editCta: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  editCtaText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
  },
  description: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  meta: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  // Segment bar
  segmentBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  segmentLabel: {
    ...typography.label,
    fontSize: 13,
    color: colors.textSecondary,
  },
  segmentLabelActive: {
    color: colors.textPrimary,
  },
  segmentUnderline: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 2,
    backgroundColor: colors.textPrimary,
    borderRadius: 1,
  },
  // Grid
  row: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cell: {
    alignItems: 'center',
  },
  cellPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInitial: {
    fontSize: 22,
    color: colors.textSecondary,
  },
  cellName: {
    ...typography.body,
    fontSize: 11,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 2,
  },
  // Empty state
  emptyState: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
