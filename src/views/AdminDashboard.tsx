import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import {
  getAllProfiles,
  activateAccount,
  deactivateAccount,
  adminUpdateProfileFull,
  adminPurgeUserData,
  adminListOrgMemberships,
  adminSetOrganizationMemberRole,
  getAdminLogs,
  adminListOrganizations,
  adminSetOrgActive,
  adminUpdateOrgDetails,
  adminListAllModels,
  adminSetModelActive,
  adminUpdateModelNotes,
  adminGetAgencyUsageLimits,
  adminSetAgencySwipeLimit,
  adminResetAgencySwipeCount,
  type AdminProfile,
  type AdminLogEntry,
  type AdminOrgMembership,
  type AdminOrganization,
  type AdminModel,
  type AdminAgencyUsageLimits,
} from '../services/adminSupabase';
import { supabase } from '../../lib/supabase';

type AdminTab = 'accounts' | 'organizations' | 'models' | 'logs' | 'edit';
type AccountFilter = 'all' | 'inactive' | 'active' | 'client' | 'agent' | 'model';

export const AdminDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const [tab, setTab] = useState<AdminTab>('accounts');
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [migrationApplied, setMigrationApplied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [search, setSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [deactivateReason, setDeactivateReason] = useState('');
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [editingProfile, setEditingProfile] = useState<AdminProfile | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [modelData, setModelData] = useState<Record<string, unknown> | null>(null);
  const [agencyData, setAgencyData] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [orgMemberships, setOrgMemberships] = useState<AdminOrgMembership[]>([]);
  const [orgRoleBusyId, setOrgRoleBusyId] = useState<string | null>(null);

  // Organization editing
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [orgEditDraft, setOrgEditDraft] = useState<Record<string, string>>({});
  const [orgMembers, setOrgMembers] = useState<Array<AdminOrgMembership & { user_id?: string; display_name?: string; email?: string }>>([]);
  const [orgSavingId, setOrgSavingId] = useState<string | null>(null);
  const [orgTogglingId, setOrgTogglingId] = useState<string | null>(null);

  // Model editing
  const [modelNotesDraft, setModelNotesDraft] = useState<Record<string, string>>({});
  const [modelSavingId, setModelSavingId] = useState<string | null>(null);
  const [modelTogglingId, setModelTogglingId] = useState<string | null>(null);

  // Owner display names, populated on org expand (keyed by org id)
  const [orgOwnerNames, setOrgOwnerNames] = useState<Record<string, string>>({});

  // Org membership per user (keyed by user_id), loaded eagerly for Accounts tab
  const [profileOrgMap, setProfileOrgMap] = useState<Record<string, { orgId: string; orgName: string; orgRole: string }>>({});

  // Agency swipe limit editing (per org id)
  const [orgSwipeLimits, setOrgSwipeLimits] = useState<Record<string, AdminAgencyUsageLimits | null>>({});
  const [orgSwipeLimitDraft, setOrgSwipeLimitDraft] = useState<Record<string, string>>({});
  const [orgSwipeSavingId, setOrgSwipeSavingId] = useState<string | null>(null);
  const [orgSwipeResettingId, setOrgSwipeResettingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // Each call has its own .catch so one failure never blocks the others.
      const [p, l, orgResult, modelResult] = await Promise.all([
        getAllProfiles().catch((e) => { console.error('[Admin] getAllProfiles threw:', e); return [] as AdminProfile[]; }),
        getAdminLogs(200).catch((e) => { console.error('[Admin] getAdminLogs threw:', e); return [] as AdminLogEntry[]; }),
        adminListOrganizations().catch((e) => { console.error('[Admin] adminListOrganizations threw:', e); return { migrationApplied: false, data: [] as AdminOrganization[] }; }),
        adminListAllModels().catch((e) => { console.error('[Admin] adminListAllModels threw:', e); return { migrationApplied: false, data: [] as AdminModel[] }; }),
      ]);
      setProfiles(p);
      setLogs(l);
      setOrganizations(orgResult.data);
      setModels(modelResult.data);
      setMigrationApplied(orgResult.migrationApplied || modelResult.migrationApplied);

      // Load org memberships separately so a failure never blocks the main data.
      try {
        const { data: memRows } = await supabase
          .from('organization_members')
          .select('user_id, organization_id, role');
        if (memRows) {
          const orgLookup: Record<string, { orgId: string; orgName: string; orgRole: string }> = {};
          for (const m of memRows as Array<{ user_id: string; organization_id: string; role: string }>) {
            const org = orgResult.data.find((o) => o.id === m.organization_id);
            if (org) {
              orgLookup[m.user_id] = { orgId: m.organization_id, orgName: org.name, orgRole: m.role };
            }
          }
          setProfileOrgMap(orgLookup);
          console.log(`[Admin] org memberships loaded: ${memRows.length}`);
        }
      } catch (memErr) {
        console.warn('[Admin] org_members bulk fetch failed (RLS policy may be missing):', memErr);
      }

      console.log(`[Admin] loaded: ${p.length} profiles, ${orgResult.data.length} orgs (migrationApplied=${orgResult.migrationApplied}), ${modelResult.data.length} models`);
    } catch (err) {
      console.error('[Admin] loadData fatal error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const showFeedback = (msg: string, ok = true) => setFeedback({ msg, ok });

  // ── Accounts ────────────────────────────────────────────────────────────────

  const filteredProfiles = profiles.filter((p) => {
    if (filter === 'inactive' && p.is_active) return false;
    if (filter === 'active' && !p.is_active) return false;
    if (filter === 'client' && p.role !== 'client') return false;
    if (filter === 'agent' && p.role !== 'agent') return false;
    if (filter === 'model' && p.role !== 'model') return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (p.email || '').toLowerCase().includes(q) ||
        (p.display_name || '').toLowerCase().includes(q) ||
        (p.company_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleActivate = async (userId: string) => {
    const ok = await activateAccount(userId);
    if (ok) { showFeedback('Account activated'); await loadData(); }
    else showFeedback('Activation failed.', false);
  };

  const handleDeactivate = async (userId: string) => {
    const ok = await deactivateAccount(userId, deactivateReason || undefined);
    if (ok) {
      showFeedback('Account deactivated');
      setDeactivateReason('');
      setActionTarget(null);
      await loadData();
    } else {
      showFeedback('Deactivation failed.', false);
    }
  };

  const runAdminPurge = async (userId: string) => {
    const result = await adminPurgeUserData(userId);
    if (result.ok) {
      showFeedback(uiCopy.adminDashboard.purgeSuccess);
      await loadData();
    } else {
      showFeedback(uiCopy.adminDashboard.purgeFailedWithDetails.replace('{details}', result.error), false);
    }
  };

  const confirmAdminPurge = (p: AdminProfile) => {
    const title = uiCopy.adminDashboard.deletePermanentlyTitle;
    const message = uiCopy.adminDashboard.deletePermanentlyMessage;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`${title}\n\n${message}`)) void runAdminPurge(p.id);
      return;
    }
    Alert.alert(title, message, [
      { text: uiCopy.common.cancel, style: 'cancel' },
      { text: uiCopy.adminDashboard.deleteData, style: 'destructive', onPress: () => void runAdminPurge(p.id) },
    ]);
  };

  const handleEditProfile = async (profile: AdminProfile) => {
    const { data: fullProfile } = await supabase
      .from('profiles').select('*').eq('id', profile.id).maybeSingle();

    setEditingProfile(profile);
    setEditFields({
      display_name: fullProfile?.display_name || profile.display_name || '',
      email: fullProfile?.email || profile.email || '',
      company_name: fullProfile?.company_name || profile.company_name || '',
      phone: fullProfile?.phone || profile.phone || '',
      website: fullProfile?.website || '',
      country: fullProfile?.country || profile.country || '',
      role: fullProfile?.role || profile.role || '',
      is_active: (fullProfile?.is_active ?? profile.is_active) ? 'true' : 'false',
    });
    setModelData(null);
    setAgencyData(null);
    setOrgMemberships([]);
    setTab('edit');

    if (profile.role === 'model') {
      const { data } = await supabase.from('models').select('*').eq('user_id', profile.id).maybeSingle();
      setModelData(data as Record<string, unknown> | null);
    } else if (profile.role === 'agent') {
      const { data } = await supabase.from('agencies').select('*').eq('email', profile.email).maybeSingle();
      setAgencyData(data as Record<string, unknown> | null);
    }
    if (profile.role === 'agent' || profile.role === 'client') {
      const m = await adminListOrgMemberships(profile.id);
      setOrgMemberships(m);
    }
  };

  const handleSetOrgRole = async (organizationId: string, role: 'owner' | 'booker' | 'employee') => {
    if (!editingProfile) return;
    setOrgRoleBusyId(organizationId);
    const r = await adminSetOrganizationMemberRole(editingProfile.id, organizationId, role);
    setOrgRoleBusyId(null);
    if (r.ok) {
      showFeedback(uiCopy.adminDashboard.orgRoleUpdated);
      const m = await adminListOrgMemberships(editingProfile.id);
      setOrgMemberships(m);
    } else {
      showFeedback(uiCopy.adminDashboard.orgRoleFailed, false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingProfile) return;
    setSaving(true);
    const ok = await adminUpdateProfileFull(editingProfile.id, {
      display_name: editFields.display_name || null,
      email: editFields.email || null,
      company_name: editFields.company_name || null,
      phone: editFields.phone || null,
      website: editFields.website || null,
      country: editFields.country || null,
      role: editFields.role || null,
      is_active: editFields.is_active === 'true',
    });
    if (ok) {
      showFeedback('Profile updated');
      setEditingProfile(null);
      await loadData();
      setTab('accounts');
    } else {
      showFeedback('Update failed. Check console.', false);
    }
    setSaving(false);
  };

  // ── Organizations ────────────────────────────────────────────────────────────

  const filteredOrgs = organizations.filter((o) => {
    if (!orgSearch) return true;
    const q = orgSearch.toLowerCase();
    return o.name.toLowerCase().includes(q) || o.type.toLowerCase().includes(q);
  });

  const handleExpandOrg = async (org: AdminOrganization) => {
    if (expandedOrgId === org.id) { setExpandedOrgId(null); return; }
    setExpandedOrgId(org.id);
    setOrgEditDraft({ name: org.name, admin_notes: org.admin_notes ?? '', new_owner_id: '' });

    const { data: memberRows } = await supabase
      .from('organization_members').select('user_id, role').eq('organization_id', org.id);
    if (memberRows && memberRows.length > 0) {
      const userIds = (memberRows as Array<{ user_id: string }>).map((r) => r.user_id);
      const { data: profileRows } = await supabase
        .from('profiles').select('id, display_name, email').in('id', userIds);
      setOrgMembers(
        (memberRows as Array<{ user_id: string; role: string }>).map((r) => {
          const pr = (profileRows ?? []).find((p: Record<string, unknown>) => p.id === r.user_id) as Record<string, unknown> | undefined;
          return {
            organization_id: org.id,
            org_name: org.name,
            org_type: org.type,
            member_role: r.role as AdminOrgMembership['member_role'],
            user_id: r.user_id,
            display_name: pr?.display_name as string | undefined,
            email: pr?.email as string | undefined,
          };
        })
      );
      // Extract the owner's display name for the org card header.
      const ownerMember = (memberRows as Array<{ user_id: string; role?: string }>).find(
        (r) => r.user_id === org.owner_id,
      );
      if (ownerMember) {
        const ownerProfile = (profileRows ?? []).find(
          (p: Record<string, unknown>) => p.id === ownerMember.user_id,
        ) as Record<string, unknown> | undefined;
        const ownerName = String(ownerProfile?.display_name || ownerProfile?.email || ownerMember.user_id.slice(0, 8) + '…');
        setOrgOwnerNames((prev) => ({ ...prev, [org.id]: ownerName }));
      }
    } else {
      setOrgMembers([]);
    }

    // Load swipe limits for agency organisations.
    if (org.type === 'agency') {
      const limits = await adminGetAgencyUsageLimits(org.id);
      setOrgSwipeLimits((prev) => ({ ...prev, [org.id]: limits }));
      setOrgSwipeLimitDraft((prev) => ({
        ...prev,
        [org.id]: String(limits?.daily_swipe_limit ?? 10),
      }));
    }
  };

  const handleToggleOrgActive = async (org: AdminOrganization) => {
    if (!migrationApplied) { showFeedback('Apply the DB migration first to use this feature.', false); return; }
    setOrgTogglingId(org.id);
    const ok = await adminSetOrgActive(org.id, !org.is_active);
    if (ok) {
      showFeedback(org.is_active ? 'Organization deactivated.' : 'Organization activated.');
      await loadData();
    } else {
      showFeedback(uiCopy.adminDashboard.orgToggleActiveFailed, false);
    }
    setOrgTogglingId(null);
  };

  const handleSaveOrg = async (org: AdminOrganization) => {
    setOrgSavingId(org.id);
    const newName = orgEditDraft.name.trim();
    const newOwnerId = orgEditDraft.new_owner_id?.trim() || null;
    const notesChanged = (orgEditDraft.admin_notes ?? '') !== (org.admin_notes ?? '');

    const ok = await adminUpdateOrgDetails(org.id, {
      name: newName !== org.name ? newName : null,
      newOwnerId,
      adminNotes: notesChanged ? (orgEditDraft.admin_notes || null) : null,
      clearNotes: notesChanged && !orgEditDraft.admin_notes,
    });
    if (ok) {
      showFeedback(uiCopy.adminDashboard.orgSaved);
      setExpandedOrgId(null);
      await loadData();
    } else {
      showFeedback(uiCopy.adminDashboard.orgSaveFailed, false);
    }
    setOrgSavingId(null);
  };

  const handleSaveSwipeLimit = async (org: AdminOrganization) => {
    const raw = orgSwipeLimitDraft[org.id] ?? '10';
    const limit = parseInt(raw, 10);
    if (isNaN(limit) || limit < 0) {
      showFeedback(uiCopy.adminDashboard.swipeLimitSaveFailed, false);
      return;
    }
    setOrgSwipeSavingId(org.id);
    const ok = await adminSetAgencySwipeLimit(org.id, limit);
    if (ok) {
      showFeedback(uiCopy.adminDashboard.swipeLimitSaveSuccess);
      const updated = await adminGetAgencyUsageLimits(org.id);
      setOrgSwipeLimits((prev) => ({ ...prev, [org.id]: updated }));
    } else {
      showFeedback(uiCopy.adminDashboard.swipeLimitSaveFailed, false);
    }
    setOrgSwipeSavingId(null);
  };

  const handleResetSwipeCount = async (org: AdminOrganization) => {
    setOrgSwipeResettingId(org.id);
    const ok = await adminResetAgencySwipeCount(org.id);
    if (ok) {
      showFeedback(uiCopy.adminDashboard.swipeLimitResetSuccess);
      const updated = await adminGetAgencyUsageLimits(org.id);
      setOrgSwipeLimits((prev) => ({ ...prev, [org.id]: updated }));
    } else {
      showFeedback(uiCopy.adminDashboard.swipeLimitResetFailed, false);
    }
    setOrgSwipeResettingId(null);
  };

  // ── Models ───────────────────────────────────────────────────────────────────

  const filteredModels = models.filter((m) => {
    if (!modelSearch) return true;
    const q = modelSearch.toLowerCase();
    return m.name.toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
  });

  const handleToggleModelActive = async (model: AdminModel) => {
    if (!migrationApplied) { showFeedback('Apply the DB migration first to use this feature.', false); return; }
    setModelTogglingId(model.id);
    const ok = await adminSetModelActive(model.id, !model.is_active);
    if (ok) {
      showFeedback(model.is_active ? 'Model deactivated.' : 'Model activated.');
      await loadData();
    } else {
      showFeedback(uiCopy.adminDashboard.modelToggleActiveFailed, false);
    }
    setModelTogglingId(null);
  };

  const handleSaveModelNotes = async (model: AdminModel) => {
    if (!migrationApplied) { showFeedback('Apply the DB migration first to use this feature.', false); return; }
    setModelSavingId(model.id);
    const notes = modelNotesDraft[model.id] ?? model.admin_notes ?? '';
    const ok = await adminUpdateModelNotes(model.id, notes || null);
    if (ok) {
      showFeedback(uiCopy.adminDashboard.modelNotesSaved);
      await loadData();
    } else {
      showFeedback(uiCopy.adminDashboard.modelNotesFailed, false);
    }
    setModelSavingId(null);
  };

  const roleLabel = (r: string) => r === 'agent' ? 'Agency' : r.charAt(0).toUpperCase() + r.slice(1);

  const pendingCount = profiles.filter((p) => !p.is_active && (p.role === 'client' || p.role === 'agent')).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.brand}>INDEX CASTING — Admin</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logoutLabel}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
        <View style={styles.tabRow}>
          {(
            [
              { key: 'accounts' as AdminTab, label: 'Accounts', badge: pendingCount > 0 ? pendingCount : null },
              { key: 'organizations' as AdminTab, label: 'Organizations', badge: organizations.length || null },
              { key: 'models' as AdminTab, label: 'Models', badge: models.length || null },
              { key: 'logs' as AdminTab, label: 'Audit Log', badge: null },
              { key: 'edit' as AdminTab, label: 'Edit Profile', badge: null },
            ]
          ).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
              {t.badge != null && t.badge > 0 && (
                <View style={[styles.badge, tab === t.key && styles.badgeActive]}>
                  <Text style={[styles.badgeText, tab === t.key && styles.badgeTextActive]}>{t.badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Feedback banner */}
      {feedback && (
        <View style={[styles.feedbackBanner, !feedback.ok && styles.feedbackBannerError]}>
          <Text style={styles.feedbackText}>{feedback.msg}</Text>
          <TouchableOpacity onPress={() => setFeedback(null)}>
            <Text style={{ color: '#fff', fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Migration banner (shown when new features need DB migration) */}
      {!migrationApplied && !loading && (tab === 'organizations' || tab === 'models') && (
        <View style={styles.migrationBanner}>
          <Text style={styles.migrationBannerText}>
            ⚠ Run migration_admin_org_model_control.sql to enable is_active toggles and admin notes.
          </Text>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.textPrimary} />
        </View>

      ) : tab === 'accounts' ? (
        /* ── Accounts ── */
        <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, email, company..."
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {(['all', 'inactive', 'active', 'client', 'agent', 'model'] as const).map((f) => {
                const count = f === 'all' ? profiles.length
                  : f === 'inactive' ? profiles.filter(p => !p.is_active).length
                  : f === 'active' ? profiles.filter(p => p.is_active).length
                  : profiles.filter(p => p.role === f).length;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[styles.pill, filter === f && styles.pillActive]}
                    onPress={() => setFilter(f)}
                  >
                    <Text style={[styles.pillText, filter === f && styles.pillTextActive]}>
                      {f === 'agent' ? 'Agency' : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {filteredProfiles.map((p) => {
            const membership = profileOrgMap[p.id];
            const orgRoleLabel = membership?.orgRole === 'owner' ? 'Owner'
              : membership?.orgRole === 'booker' ? 'Booker'
              : membership?.orgRole === 'employee' ? 'Employee'
              : null;
            return (
            <TouchableOpacity key={p.id} style={[styles.card, !membership && p.role !== 'model' ? styles.cardNoOrg : null]} onPress={() => handleEditProfile(p)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <Text style={styles.cardTitle}>{p.display_name || 'No name'}</Text>
                    <View style={[styles.roleBadge, p.role === 'agent' ? styles.roleBadgeAgency : p.role === 'client' ? styles.roleBadgeClient : styles.roleBadgeModel]}>
                      <Text style={styles.roleBadgeText}>{roleLabel(p.role)}</Text>
                    </View>
                    {orgRoleLabel && (
                      <View style={styles.roleBadgeOrgRole}>
                        <Text style={styles.roleBadgeText}>{orgRoleLabel}</Text>
                      </View>
                    )}
                    {!membership && p.role !== 'model' && (
                      <View style={styles.roleBadgeGhost}>
                        <Text style={styles.roleBadgeText}>⚠ NO ORG</Text>
                      </View>
                    )}
                    <View style={[styles.statusDot, p.is_active ? styles.dotGreen : styles.dotOrange]} />
                  </View>
                  <Text style={styles.cardSub}>{p.email}</Text>
                  {membership && (
                    <Text style={styles.cardMeta}>{membership.orgName}</Text>
                  )}
                  {!membership && p.company_name && <Text style={styles.cardMeta}>{p.company_name}</Text>}
                  {p.deactivated_reason && (
                    <Text style={styles.cardReason}>Reason: {p.deactivated_reason}</Text>
                  )}
                </View>

                <View style={{ alignItems: 'flex-end', gap: 4, justifyContent: 'center' }}>
                  {!p.is_active ? (
                    <View style={{ gap: 4 }}>
                      <TouchableOpacity style={styles.btnGreen} onPress={() => handleActivate(p.id)}>
                        <Text style={styles.btnLabel}>Activate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.btnDark} onPress={() => confirmAdminPurge(p)}>
                        <Text style={styles.btnLabel}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      {actionTarget === p.id ? (
                        <View style={{ gap: 4 }}>
                          <TextInput
                            style={styles.reasonInput}
                            placeholder="Reason (optional)..."
                            placeholderTextColor={colors.textSecondary}
                            value={deactivateReason}
                            onChangeText={setDeactivateReason}
                          />
                          <TouchableOpacity style={styles.btnRed} onPress={() => handleDeactivate(p.id)}>
                            <Text style={styles.btnLabel}>Confirm</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setActionTarget(null); setDeactivateReason(''); }}>
                            <Text style={{ fontSize: 11, color: colors.textSecondary, textAlign: 'center' }}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.btnRed} onPress={() => setActionTarget(p.id)}>
                          <Text style={styles.btnLabel}>Deactivate</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.btnDark} onPress={() => confirmAdminPurge(p)}>
                        <Text style={styles.btnLabel}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </TouchableOpacity>
            );
          })}
          {filteredProfiles.length === 0 && (
            <Text style={styles.emptyText}>No accounts matching the current filter.</Text>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>

      ) : tab === 'organizations' ? (
        /* ── Organizations ── */
        <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
            <TextInput
              style={[styles.searchInput, { flex: 1, marginBottom: 0 }]}
              placeholder={uiCopy.adminDashboard.orgsSearchPlaceholder}
              placeholderTextColor={colors.textSecondary}
              value={orgSearch}
              onChangeText={setOrgSearch}
            />
            <TouchableOpacity style={styles.btnDark} onPress={loadData}>
              <Text style={styles.btnLabel}>↺ Reload</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' }}>
            <Text style={styles.summaryChip}>
              All: {organizations.length}
            </Text>
            {migrationApplied && (
              <>
                <Text style={[styles.summaryChip, { color: '#2ecc71' }]}>
                  Active: {organizations.filter(o => o.is_active === true).length}
                </Text>
                <Text style={[styles.summaryChip, { color: '#e74c3c' }]}>
                  Inactive: {organizations.filter(o => o.is_active === false).length}
                </Text>
              </>
            )}
            <Text style={styles.summaryChip}>
              Agencies: {organizations.filter(o => o.type === 'agency').length}
            </Text>
            <Text style={styles.summaryChip}>
              Clients: {organizations.filter(o => o.type === 'client').length}
            </Text>
          </View>

          {filteredOrgs.length === 0 && (
            <Text style={styles.emptyText}>{uiCopy.adminDashboard.orgsEmpty}</Text>
          )}

          {filteredOrgs.map((org) => {
            const isExpanded = expandedOrgId === org.id;
            const isSaving = orgSavingId === org.id;
            const isToggling = orgTogglingId === org.id;
            const ownerName = orgOwnerNames[org.id];

            // Ghost-org detection: org name matches owner's personal display_name.
            // Uses the eagerly-loaded profiles list — no extra query needed.
            const ownerProfile = profiles.find((p) => p.id === org.owner_id);
            const isGhostOrg = !!(
              ownerProfile?.display_name &&
              org.name.trim().toLowerCase() === ownerProfile.display_name.trim().toLowerCase()
            );

            return (
              <View key={org.id} style={styles.card}>
                {/* Card header */}
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} onPress={() => void handleExpandOrg(org)}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                      <Text style={styles.cardTitle}>{org.name}</Text>
                      <View style={[styles.roleBadge, org.type === 'agency' ? styles.roleBadgeAgency : styles.roleBadgeClient]}>
                        <Text style={styles.roleBadgeText}>{org.type === 'agency' ? 'Agency' : 'Client'}</Text>
                      </View>
                      {isGhostOrg && (
                        <View style={styles.roleBadgeGhost}>
                          <Text style={styles.roleBadgeText}>⚠ GHOST ORG</Text>
                        </View>
                      )}
                      {org.is_active !== null && (
                        <View style={[styles.statusDot, org.is_active ? styles.dotGreen : styles.dotRed]} />
                      )}
                    </View>
                    <Text style={styles.cardMeta}>
                      {ownerName ? `Owner: ${ownerName} · ` : ''}
                      {org.member_count} member{org.member_count !== 1 ? 's' : ''}
                      {org.is_active === false ? ' · DEACTIVATED' : ''}
                    </Text>
                  </View>

                  {/* Active toggle (only when migration applied) */}
                  {migrationApplied && (
                    <TouchableOpacity
                      style={[styles.btnSmall, org.is_active ? styles.btnRed : styles.btnGreen]}
                      disabled={isToggling}
                      onPress={() => handleToggleOrgActive(org)}
                    >
                      {isToggling
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={styles.btnLabel}>
                            {org.is_active ? 'Deactivate' : 'Activate'}
                          </Text>
                      }
                    </TouchableOpacity>
                  )}
                  <Text style={[styles.chevron, isExpanded && { transform: [{ rotate: '90deg' }] }]}>›</Text>
                </TouchableOpacity>

                {/* Expanded edit section */}
                {isExpanded && (
                  <View style={styles.expandBody}>
                    <Text style={styles.editLabel}>Organization Name</Text>
                    <TextInput
                      style={styles.editInput}
                      value={orgEditDraft.name ?? ''}
                      onChangeText={(v) => setOrgEditDraft((d) => ({ ...d, name: v }))}
                      placeholderTextColor={colors.textSecondary}
                    />

                    {/* Owner transfer */}
                    <Text style={[styles.editLabel, { marginTop: spacing.sm }]}>
                      {uiCopy.adminDashboard.orgChangeOwnerLabel}
                    </Text>
                    {orgMembers.length > 0 ? (
                      <View style={{ gap: 4, marginBottom: 4 }}>
                        {orgMembers.map((m) => {
                          const uid = m.user_id ?? '';
                          const label = m.display_name || m.email || uid.slice(0, 8) + '…';
                          const isSelected = orgEditDraft.new_owner_id === uid;
                          return (
                            <TouchableOpacity
                              key={uid}
                              style={[styles.memberRow, isSelected && styles.memberRowSelected]}
                              onPress={() => setOrgEditDraft((d) => ({ ...d, new_owner_id: isSelected ? '' : uid }))}
                            >
                              <Text style={[styles.memberRowText, isSelected && { color: '#fff' }]}>
                                {label}
                                <Text style={{ fontWeight: '400', opacity: 0.7 }}>  {m.member_role}{uid === org.owner_id ? ' · current owner' : ''}</Text>
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.cardMeta}>No members loaded.</Text>
                    )}

                    {/* Admin notes (only when migration applied) */}
                    {migrationApplied && (
                      <>
                        <Text style={[styles.editLabel, { marginTop: spacing.sm }]}>
                          {uiCopy.adminDashboard.orgAdminNotesLabel}
                        </Text>
                        <TextInput
                          style={[styles.editInput, { minHeight: 72, textAlignVertical: 'top' }]}
                          multiline
                          value={orgEditDraft.admin_notes ?? ''}
                          onChangeText={(v) => setOrgEditDraft((d) => ({ ...d, admin_notes: v }))}
                          placeholder={uiCopy.adminDashboard.orgAdminNotesPlaceholder}
                          placeholderTextColor={colors.textSecondary}
                        />
                      </>
                    )}

                    {/* Swipe limit controls (agency orgs only) */}
                    {org.type === 'agency' && (() => {
                      const limits = orgSwipeLimits[org.id];
                      const isSavingLimit = orgSwipeSavingId === org.id;
                      const isResetting = orgSwipeResettingId === org.id;
                      return (
                        <View style={styles.swipeLimitSection}>
                          <Text style={styles.editLabel}>{uiCopy.adminDashboard.swipeLimitTitle}</Text>
                          {limits ? (
                            <View style={styles.swipeLimitStats}>
                              <Text style={styles.swipeLimitStat}>
                                {uiCopy.adminDashboard.swipeLimitUsed}: <Text style={{ fontWeight: '700' }}>{limits.swipes_used_today}</Text>
                              </Text>
                              <Text style={styles.swipeLimitStat}>
                                {uiCopy.adminDashboard.swipeLimitMax}: <Text style={{ fontWeight: '700' }}>{limits.daily_swipe_limit}</Text>
                              </Text>
                              <Text style={styles.swipeLimitStat}>
                                {uiCopy.adminDashboard.swipeLimitLastReset}: <Text style={{ fontWeight: '700' }}>{limits.last_reset_date}</Text>
                              </Text>
                            </View>
                          ) : (
                            <Text style={styles.cardMeta}>No limit row yet (will be created on save).</Text>
                          )}
                          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.xs }}>
                            <TextInput
                              style={[styles.editInput, { flex: 1 }]}
                              value={orgSwipeLimitDraft[org.id] ?? '10'}
                              onChangeText={(v) => setOrgSwipeLimitDraft((d) => ({ ...d, [org.id]: v }))}
                              keyboardType="number-pad"
                              placeholderTextColor={colors.textSecondary}
                            />
                            <TouchableOpacity
                              style={[styles.btnSmall, styles.btnGreen, isSavingLimit && { opacity: 0.5 }]}
                              onPress={() => void handleSaveSwipeLimit(org)}
                              disabled={isSavingLimit}
                            >
                              {isSavingLimit
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Text style={styles.btnLabel}>{uiCopy.adminDashboard.swipeLimitSave}</Text>
                              }
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.btnSmall, styles.btnRed, isResetting && { opacity: 0.5 }]}
                              onPress={() => void handleResetSwipeCount(org)}
                              disabled={isResetting}
                            >
                              {isResetting
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Text style={styles.btnLabel}>{uiCopy.adminDashboard.swipeLimitReset}</Text>
                              }
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })()}

                    <TouchableOpacity
                      style={[styles.saveBtn, isSaving && { opacity: 0.5 }]}
                      onPress={() => handleSaveOrg(org)}
                      disabled={isSaving}
                    >
                      <Text style={styles.saveBtnLabel}>{isSaving ? 'Saving…' : uiCopy.adminDashboard.orgSaveChanges}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>

      ) : tab === 'models' ? (
        /* ── Models ── */
        <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.searchInput}
            placeholder={uiCopy.adminDashboard.modelsSearchPlaceholder}
            placeholderTextColor={colors.textSecondary}
            value={modelSearch}
            onChangeText={setModelSearch}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' }}>
            <Text style={styles.summaryChip}>All: {models.length}</Text>
            {migrationApplied && (
              <>
                <Text style={[styles.summaryChip, { color: '#2ecc71' }]}>
                  Active: {models.filter(m => m.is_active === true).length}
                </Text>
                <Text style={[styles.summaryChip, { color: '#e74c3c' }]}>
                  Inactive: {models.filter(m => m.is_active === false).length}
                </Text>
              </>
            )}
          </View>

          {filteredModels.length === 0 && (
            <Text style={styles.emptyText}>{uiCopy.adminDashboard.modelsEmpty}</Text>
          )}

          {filteredModels.map((model) => {
            const isToggling = modelTogglingId === model.id;
            const isSaving = modelSavingId === model.id;
            const notesDraft = model.id in modelNotesDraft ? modelNotesDraft[model.id] : (model.admin_notes ?? '');

            return (
              <View key={model.id} style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                      <Text style={styles.cardTitle}>{model.name}</Text>
                      {model.is_active !== null && (
                        <View style={[styles.statusDot, model.is_active ? styles.dotGreen : styles.dotRed]} />
                      )}
                      {model.is_active === false && (
                        <Text style={{ ...typography.label, fontSize: 10, color: '#e74c3c' }}>DEACTIVATED</Text>
                      )}
                    </View>
                    {model.email && <Text style={styles.cardSub}>{model.email}</Text>}
                    {model.agency_id && (
                      <Text style={styles.cardMeta}>Agency ID: {model.agency_id.slice(0, 8)}…</Text>
                    )}
                  </View>

                  {/* Toggle (only when migration applied) */}
                  {migrationApplied && (
                    <TouchableOpacity
                      style={[styles.btnSmall, model.is_active ? styles.btnRed : styles.btnGreen]}
                      disabled={isToggling}
                      onPress={() => handleToggleModelActive(model)}
                    >
                      {isToggling
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={styles.btnLabel}>{model.is_active ? 'Deactivate' : 'Activate'}</Text>
                      }
                    </TouchableOpacity>
                  )}
                </View>

                {/* Admin notes (only when migration applied) */}
                {migrationApplied && (
                  <>
                    <Text style={[styles.editLabel, { marginTop: spacing.sm }]}>
                      {uiCopy.adminDashboard.modelAdminNotesLabel}
                    </Text>
                    <TextInput
                      style={[styles.editInput, { minHeight: 52, textAlignVertical: 'top', fontSize: 12 }]}
                      multiline
                      value={notesDraft}
                      onChangeText={(v) => setModelNotesDraft((d) => ({ ...d, [model.id]: v }))}
                      placeholder={uiCopy.adminDashboard.modelAdminNotesPlaceholder}
                      placeholderTextColor={colors.textSecondary}
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, { marginTop: spacing.xs }, isSaving && { opacity: 0.5 }]}
                      onPress={() => handleSaveModelNotes(model)}
                      disabled={isSaving}
                    >
                      <Text style={styles.saveBtnLabel}>{isSaving ? 'Saving…' : 'Save Notes'}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>

      ) : tab === 'logs' ? (
        /* ── Audit Log ── */
        <ScrollView style={styles.scrollArea}>
          {logs.map((log) => (
            <View key={log.id} style={styles.logEntry}>
              <Text style={styles.logAction}>{log.action}</Text>
              <Text style={styles.logMeta}>
                Target: {log.target_user_id ? log.target_user_id.slice(0, 8) + '...' : 'N/A'}
                {' · '}{new Date(log.created_at).toLocaleString()}
              </Text>
              {log.details && Object.keys(log.details).length > 0 && (
                <Text style={styles.logDetails}>{JSON.stringify(log.details)}</Text>
              )}
            </View>
          ))}
          {logs.length === 0 && <Text style={styles.emptyText}>No audit log entries yet.</Text>}
        </ScrollView>

      ) : (
        /* ── Edit Profile ── */
        <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
          {editingProfile ? (
            <>
              <View style={{ marginBottom: spacing.md }}>
                <TouchableOpacity onPress={() => { setEditingProfile(null); setOrgMemberships([]); setTab('accounts'); }}>
                  <Text style={styles.backLabel}>← Back to Accounts</Text>
                </TouchableOpacity>
                <Text style={styles.editSectionTitle}>
                  Editing: {editingProfile.display_name || editingProfile.email || editingProfile.id}
                </Text>
                <Text style={styles.cardMeta}>ID: {editingProfile.id}</Text>
              </View>

              {(['display_name', 'email', 'company_name', 'phone', 'website', 'country'] as const).map((field) => (
                <View key={field} style={{ marginBottom: spacing.sm }}>
                  <Text style={styles.editLabel}>
                    {field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Text>
                  <TextInput
                    style={styles.editInput}
                    value={editFields[field] || ''}
                    onChangeText={(v) => setEditFields((prev) => ({ ...prev, [field]: v }))}
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              ))}

              {/* Role selector — maps display labels to DB values */}
              <View style={{ marginBottom: spacing.sm }}>
                <Text style={styles.editLabel}>Role</Text>
                <Text style={styles.hintText}>{uiCopy.adminDashboard.accountRoleHint}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                  {([
                    { label: 'Agency', value: 'agent'  },
                    { label: 'Client', value: 'client' },
                    { label: 'Model',  value: 'model'  },
                  ] as const).map(({ label, value }) => {
                    const isActive = editFields.role === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        style={[
                          styles.rolePill,
                          value === 'agent'  && styles.rolePillAgency,
                          value === 'client' && styles.rolePillClient,
                          value === 'model'  && styles.rolePillModel,
                          isActive && styles.rolePillActive,
                        ]}
                        onPress={() => setEditFields((prev) => ({ ...prev, role: value }))}
                      >
                        <Text style={[styles.rolePillLabel, isActive && styles.rolePillLabelActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {(editingProfile.role === 'agent' || editingProfile.role === 'client') && (
                <View style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
                  <Text style={styles.editSectionTitle}>{uiCopy.adminDashboard.organizationRolesTitle}</Text>
                  <Text style={styles.hintText}>{uiCopy.adminDashboard.organizationRolesHint}</Text>
                  {orgMemberships.length === 0 ? (
                    <Text style={styles.cardMeta}>{uiCopy.adminDashboard.orgRoleNoneLoaded}</Text>
                  ) : (
                    orgMemberships.map((m) => (
                      <View key={m.organization_id} style={[styles.card, { marginBottom: spacing.xs }]}>
                        <Text style={[styles.cardTitle, { fontSize: 13, marginBottom: spacing.sm }]}>
                          {m.org_name || '—'} · {m.org_type === 'agency' ? 'Agency' : 'Client'} · {m.member_role.charAt(0).toUpperCase() + m.member_role.slice(1)}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {m.org_type === 'agency' ? (
                            <>
                              <TouchableOpacity
                                style={[styles.btnSmall, styles.btnDark, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'owner')}
                              >
                                <Text style={styles.btnLabel}>{uiCopy.adminDashboard.orgRoleSetOwner}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.btnSmall, styles.btnDark, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'booker')}
                              >
                                <Text style={styles.btnLabel}>{uiCopy.adminDashboard.orgRoleSetBooker}</Text>
                              </TouchableOpacity>
                            </>
                          ) : (
                            <>
                              <TouchableOpacity
                                style={[styles.btnSmall, styles.btnDark, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'owner')}
                              >
                                <Text style={styles.btnLabel}>{uiCopy.adminDashboard.orgRoleSetOwner}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.btnSmall, styles.btnDark, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'employee')}
                              >
                                <Text style={styles.btnLabel}>{uiCopy.adminDashboard.orgRoleSetEmployee}</Text>
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}

              <View style={{ marginBottom: spacing.sm }}>
                <Text style={styles.editLabel}>Active</Text>
                <TouchableOpacity
                  style={[styles.toggleBtn, editFields.is_active === 'true' && styles.toggleBtnOn]}
                  onPress={() => setEditFields((prev) => ({
                    ...prev,
                    is_active: prev.is_active === 'true' ? 'false' : 'true',
                  }))}
                >
                  <Text style={[styles.toggleBtnLabel, editFields.is_active === 'true' && styles.toggleBtnLabelOn]}>
                    {editFields.is_active === 'true' ? 'Yes' : 'No'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hintText}>{uiCopy.adminDashboard.adminFlagNotEditableInApp}</Text>

              {modelData && (
                <View style={[styles.card, { marginTop: spacing.md }]}>
                  <Text style={styles.editSectionTitle}>Model Data</Text>
                  {Object.entries(modelData).map(([key, val]) => (
                    <Text key={key} style={styles.cardMeta}>
                      {key}: {Array.isArray(val) ? val.join(', ') : String(val ?? '—')}
                    </Text>
                  ))}
                </View>
              )}
              {agencyData && (
                <View style={[styles.card, { marginTop: spacing.md }]}>
                  <Text style={styles.editSectionTitle}>Agency Data</Text>
                  {Object.entries(agencyData).map(([key, val]) => (
                    <Text key={key} style={styles.cardMeta}>{key}: {String(val ?? '—')}</Text>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSaveEdit}
                disabled={saving}
              >
                <Text style={styles.saveBtnLabel}>{saving ? 'Saving...' : 'Save Changes'}</Text>
              </TouchableOpacity>
              <View style={{ height: 40 }} />
            </>
          ) : (
            <Text style={styles.emptyText}>Select a profile from the Accounts tab to edit.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  brand: { ...typography.heading, fontSize: 16, color: colors.textPrimary, letterSpacing: 1 },
  logoutLabel: { ...typography.label, fontSize: 12, color: colors.textSecondary },

  tabScroll: { borderBottomWidth: 1, borderBottomColor: colors.border, maxHeight: 48 },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: 8, gap: 6 },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 5, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1, borderColor: colors.border,
  },
  tabBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  tabLabel: { ...typography.label, fontSize: 12, color: colors.textSecondary },
  tabLabelActive: { color: colors.surface },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  badgeText: { ...typography.label, fontSize: 10, color: colors.textSecondary },
  badgeTextActive: { color: colors.surface },

  feedbackBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#2ecc71', paddingHorizontal: spacing.md, paddingVertical: 8,
    marginHorizontal: spacing.lg, marginTop: 8, borderRadius: 8,
  },
  feedbackBannerError: { backgroundColor: '#e74c3c' },
  feedbackText: { ...typography.label, color: '#fff', fontSize: 13, flex: 1, marginRight: 8 },

  migrationBanner: {
    backgroundColor: '#2c2c0a', borderLeftWidth: 3, borderLeftColor: '#f39c12',
    paddingHorizontal: spacing.md, paddingVertical: 8,
    marginHorizontal: spacing.lg, marginTop: 8, borderRadius: 4,
  },
  migrationBannerText: { ...typography.body, fontSize: 11, color: '#f39c12' },

  scrollArea: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  searchInput: {
    ...typography.body, color: colors.textPrimary,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: 9, marginBottom: spacing.sm,
  },

  // Filter pills
  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  pillText: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  pillTextActive: { color: colors.surface },

  summaryChip: { ...typography.label, fontSize: 12, color: colors.textSecondary },

  // Cards
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  cardTitle: { ...typography.label, fontSize: 14, color: colors.textPrimary },
  cardSub: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
  cardMeta: { ...typography.body, fontSize: 11, color: colors.textSecondary },
  cardReason: { ...typography.body, fontSize: 11, color: '#e74c3c', fontStyle: 'italic', marginTop: 2 },

  // Role & status badges
  roleBadge: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 4 },
  roleBadgeAgency: { backgroundColor: '#1a1a2e' },
  roleBadgeClient: { backgroundColor: '#1c2c1c' },
  roleBadgeModel: { backgroundColor: '#1a1a3e' },
  roleBadgeOrgRole: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 4, backgroundColor: '#2a3a2a' },
  roleBadgeGhost: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 4, backgroundColor: '#7a3e00' },
  roleBadgeText: { ...typography.label, fontSize: 9, color: '#fff' },
  cardNoOrg: { borderLeftWidth: 2, borderLeftColor: '#7a3e00' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  dotGreen: { backgroundColor: '#2ecc71' },
  dotOrange: { backgroundColor: '#f39c12' },
  dotRed: { backgroundColor: '#e74c3c' },

  // Buttons
  btnGreen: { backgroundColor: '#2ecc71', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  btnRed: { backgroundColor: '#e74c3c', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  btnDark: { backgroundColor: '#333', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  btnSmall: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6 },
  btnLabel: { ...typography.label, fontSize: 11, color: '#fff' },

  reasonInput: {
    ...typography.body, fontSize: 11, color: colors.textPrimary,
    borderWidth: 1, borderColor: colors.border, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, width: 130,
  },

  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },

  // Log entries
  logEntry: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
  logAction: { ...typography.label, color: colors.textPrimary, fontSize: 13 },
  logMeta: { ...typography.body, color: colors.textSecondary, fontSize: 11 },
  logDetails: { ...typography.body, color: colors.textSecondary, fontSize: 10, fontFamily: 'monospace', marginTop: 2 },

  // Edit profile
  backLabel: { ...typography.label, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  editSectionTitle: { ...typography.heading, fontSize: 14, color: colors.textPrimary, marginBottom: 2 },
  editLabel: { ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: 4 },
  editInput: {
    ...typography.body, color: colors.textPrimary,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: 9,
  },
  hintText: { ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: 6 },
  toggleBtn: {
    paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' as const,
  },
  toggleBtnOn: { backgroundColor: '#2ecc71', borderColor: '#2ecc71' },
  toggleBtnLabel: { ...typography.label, fontSize: 13, color: colors.textSecondary },
  toggleBtnLabelOn: { color: '#fff' },

  // Save button
  saveBtn: {
    backgroundColor: colors.textPrimary, paddingVertical: 11,
    borderRadius: 8, alignItems: 'center' as const, marginTop: spacing.md,
  },
  saveBtnLabel: { ...typography.label, color: colors.surface, fontSize: 13 },

  // Org expand
  expandBody: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  memberRow: {
    paddingVertical: 7, paddingHorizontal: 10, borderRadius: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  memberRowSelected: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  memberRowText: { ...typography.label, fontSize: 12, color: colors.textPrimary },
  chevron: { ...typography.heading, fontSize: 22, color: colors.textSecondary },

  // Role selector pills (Admin Edit Profile)
  rolePill: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rolePillAgency: { borderColor: '#6c5ce7' },
  rolePillClient: { borderColor: '#0984e3' },
  rolePillModel:  { borderColor: '#00b894' },
  rolePillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  rolePillLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
  },
  rolePillLabelActive: { color: colors.surface },

  // Swipe limit section inside expanded org card
  swipeLimitSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  swipeLimitStats: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  swipeLimitStat: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
