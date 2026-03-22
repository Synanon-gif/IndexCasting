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
  type AdminProfile,
  type AdminLogEntry,
  type AdminOrgMembership,
} from '../services/adminSupabase';
import { supabase } from '../../lib/supabase';

type AdminTab = 'accounts' | 'logs' | 'edit';
type AccountFilter = 'all' | 'inactive' | 'active' | 'client' | 'agent' | 'model';

export const AdminDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const [tab, setTab] = useState<AdminTab>('accounts');
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AccountFilter>('inactive');
  const [search, setSearch] = useState('');
  const [deactivateReason, setDeactivateReason] = useState('');
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<AdminProfile | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [modelData, setModelData] = useState<Record<string, unknown> | null>(null);
  const [agencyData, setAgencyData] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [orgMemberships, setOrgMemberships] = useState<AdminOrgMembership[]>([]);
  const [orgRoleBusyId, setOrgRoleBusyId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    const [p, l] = await Promise.all([getAllProfiles(), getAdminLogs(200)]);
    setProfiles(p);
    setLogs(l);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

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
    if (ok) {
      setFeedback('Account activated');
      await loadData();
    }
  };

  const handleDeactivate = async (userId: string) => {
    const ok = await deactivateAccount(userId, deactivateReason || undefined);
    if (ok) {
      setFeedback('Account deactivated');
      setDeactivateReason('');
      setActionTarget(null);
      await loadData();
    }
  };

  const runAdminPurge = async (userId: string) => {
    const result = await adminPurgeUserData(userId);
    if (result.ok) {
      setFeedback(uiCopy.adminDashboard.purgeSuccess);
      await loadData();
    } else {
      setFeedback(uiCopy.adminDashboard.purgeFailedWithDetails.replace('{details}', result.error));
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
      {
        text: uiCopy.adminDashboard.deleteData,
        style: 'destructive',
        onPress: () => void runAdminPurge(p.id),
      },
    ]);
  };

  const handleEditProfile = async (profile: AdminProfile) => {
    const { data: fullProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', profile.id)
      .maybeSingle();

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
      setFeedback(uiCopy.adminDashboard.orgRoleUpdated);
      const m = await adminListOrgMemberships(editingProfile.id);
      setOrgMemberships(m);
    } else {
      setFeedback(uiCopy.adminDashboard.orgRoleFailed);
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
      setFeedback('Profile updated');
      setEditingProfile(null);
      await loadData();
      setTab('accounts');
    } else {
      setFeedback('Error: Update failed. Check console.');
    }
    setSaving(false);
  };

  const roleLabel = (r: string) => r === 'agent' ? 'Agency' : r.charAt(0).toUpperCase() + r.slice(1);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>INDEX CASTING — Admin</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logoutLabel}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {(['accounts', 'logs', 'edit'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'accounts' ? 'Accounts' : t === 'logs' ? 'Audit Log' : 'Edit Profile'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {feedback && (
        <View style={styles.feedbackBanner}>
          <Text style={styles.feedbackText}>{feedback}</Text>
          <TouchableOpacity onPress={() => setFeedback(null)}><Text style={{ color: colors.textSecondary }}>✕</Text></TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.textPrimary} />
        </View>
      ) : tab === 'accounts' ? (
        <ScrollView style={styles.scrollArea}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, email, company..."
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {(['all', 'inactive', 'active', 'client', 'agent', 'model'] as const).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterPill, filter === f && styles.filterPillActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>
                  {f === 'agent' ? 'Agency' : f.charAt(0).toUpperCase() + f.slice(1)}
                  {f === 'inactive' ? ` (${profiles.filter(p => !p.is_active).length})` : ''}
                  {f === 'active' ? ` (${profiles.filter(p => p.is_active).length})` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {filteredProfiles.map((p) => (
            <TouchableOpacity key={p.id} style={styles.profileCard} onPress={() => handleEditProfile(p)}>
              <View style={styles.profileCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileName}>{p.display_name || 'No name'}</Text>
                  <Text style={styles.profileEmail}>{p.email}</Text>
                  <Text style={styles.profileMeta}>
                    {roleLabel(p.role)} · {p.is_active ? '✅ Active' : '⏳ Pending'}
                    {p.company_name ? ` · ${p.company_name}` : ''}
                    {p.country ? ` · ${p.country}` : ''}
                  </Text>
                  <Text style={styles.profileMeta}>
                    ToS: {p.tos_accepted ? '✓' : '✗'} · Privacy: {p.privacy_accepted ? '✓' : '✗'}
                    {p.role === 'agent' ? ` · Model Rights: ${p.agency_model_rights_accepted ? '✓' : '✗'}` : ''}
                    · Docs Sent: {p.activation_documents_sent ? '✓' : '✗'}
                  </Text>
                  {p.deactivated_reason && (
                    <Text style={styles.deactivatedReason}>Reason: {p.deactivated_reason}</Text>
                  )}
                </View>

                <View style={styles.profileActions}>
                  {!p.is_active ? (
                    <View style={{ gap: 4 }}>
                      <TouchableOpacity style={styles.activateBtn} onPress={() => handleActivate(p.id)}>
                        <Text style={styles.activateBtnLabel}>Activate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.deactivateBtn, { backgroundColor: '#333' }]}
                        onPress={() => confirmAdminPurge(p)}
                      >
                        <Text style={styles.deactivateBtnLabel}>Delete permanently</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      {actionTarget === p.id ? (
                        <View style={{ gap: 4 }}>
                          <TextInput
                            style={styles.reasonInput}
                            placeholder="Reason..."
                            placeholderTextColor={colors.textSecondary}
                            value={deactivateReason}
                            onChangeText={setDeactivateReason}
                          />
                          <TouchableOpacity style={styles.deactivateBtn} onPress={() => handleDeactivate(p.id)}>
                            <Text style={styles.deactivateBtnLabel}>Confirm</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setActionTarget(null); setDeactivateReason(''); }}>
                            <Text style={{ fontSize: 11, color: colors.textSecondary }}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.deactivateBtn} onPress={() => setActionTarget(p.id)}>
                          <Text style={styles.deactivateBtnLabel}>Deactivate</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.deactivateBtn, { marginTop: 4, backgroundColor: '#333' }]}
                        onPress={() => confirmAdminPurge(p)}
                      >
                        <Text style={styles.deactivateBtnLabel}>Delete permanently</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}

          {filteredProfiles.length === 0 && (
            <Text style={styles.emptyText}>No accounts matching the current filter.</Text>
          )}
        </ScrollView>
      ) : tab === 'logs' ? (
        <ScrollView style={styles.scrollArea}>
          {logs.map((log) => (
            <View key={log.id} style={styles.logEntry}>
              <Text style={styles.logAction}>{log.action}</Text>
              <Text style={styles.logMeta}>
                Target: {log.target_user_id ? log.target_user_id.slice(0, 8) + '...' : 'N/A'}
                {' · '}
                {new Date(log.created_at).toLocaleString()}
              </Text>
              {log.details && Object.keys(log.details).length > 0 && (
                <Text style={styles.logDetails}>{JSON.stringify(log.details)}</Text>
              )}
            </View>
          ))}
          {logs.length === 0 && <Text style={styles.emptyText}>No audit log entries yet.</Text>}
        </ScrollView>
      ) : (
        <ScrollView style={styles.scrollArea}>
          {editingProfile ? (
            <>
              <View style={styles.editHeader}>
                <TouchableOpacity
                  onPress={() => {
                    setEditingProfile(null);
                    setOrgMemberships([]);
                    setTab('accounts');
                  }}
                >
                  <Text style={styles.backLabel}>← Back to Accounts</Text>
                </TouchableOpacity>
                <Text style={styles.editTitle}>
                  Editing: {editingProfile.display_name || editingProfile.email || editingProfile.id}
                </Text>
                <Text style={styles.editSubtitle}>ID: {editingProfile.id}</Text>
              </View>

              {(['display_name', 'email', 'company_name', 'phone', 'website', 'country', 'role'] as const).map((field) => (
                <View key={field} style={styles.editFieldRow}>
                  <Text style={styles.editFieldLabel}>
                    {field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Text>
                  {field === 'role' && (
                    <Text style={styles.fieldHint}>{uiCopy.adminDashboard.accountRoleHint}</Text>
                  )}
                  <TextInput
                    style={styles.editInput}
                    value={editFields[field] || ''}
                    onChangeText={(v) => setEditFields((prev) => ({ ...prev, [field]: v }))}
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              ))}

              {(editingProfile.role === 'agent' || editingProfile.role === 'client') && (
                <View style={styles.orgRoleSection}>
                  <Text style={styles.roleDataTitle}>{uiCopy.adminDashboard.organizationRolesTitle}</Text>
                  <Text style={styles.fieldHint}>{uiCopy.adminDashboard.organizationRolesHint}</Text>
                  {orgMemberships.length === 0 ? (
                    <Text style={styles.orgRoleEmpty}>{uiCopy.adminDashboard.orgRoleNoneLoaded}</Text>
                  ) : (
                    orgMemberships.map((m) => (
                      <View key={m.organization_id} style={styles.orgRoleCard}>
                        <Text style={styles.orgRoleOrgName}>
                          {m.org_name || '—'} · {m.org_type} · current: {m.member_role}
                        </Text>
                        <View style={styles.orgRoleBtnRow}>
                          {m.org_type === 'agency' ? (
                            <>
                              <TouchableOpacity
                                style={[styles.orgRoleBtn, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'owner')}
                              >
                                <Text style={styles.orgRoleBtnLabel}>{uiCopy.adminDashboard.orgRoleSetOwner}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.orgRoleBtn, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'booker')}
                              >
                                <Text style={styles.orgRoleBtnLabel}>{uiCopy.adminDashboard.orgRoleSetBooker}</Text>
                              </TouchableOpacity>
                            </>
                          ) : (
                            <>
                              <TouchableOpacity
                                style={[styles.orgRoleBtn, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'owner')}
                              >
                                <Text style={styles.orgRoleBtnLabel}>{uiCopy.adminDashboard.orgRoleSetOwner}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.orgRoleBtn, orgRoleBusyId === m.organization_id && { opacity: 0.5 }]}
                                disabled={orgRoleBusyId !== null}
                                onPress={() => void handleSetOrgRole(m.organization_id, 'employee')}
                              >
                                <Text style={styles.orgRoleBtnLabel}>{uiCopy.adminDashboard.orgRoleSetEmployee}</Text>
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}

              <View style={styles.editFieldRow}>
                <Text style={styles.editFieldLabel}>Active</Text>
                <TouchableOpacity
                  style={[styles.toggleBtn, editFields.is_active === 'true' && styles.toggleBtnActive]}
                  onPress={() => setEditFields((prev) => ({
                    ...prev,
                    is_active: prev.is_active === 'true' ? 'false' : 'true',
                  }))}
                >
                  <Text style={[styles.toggleBtnLabel, editFields.is_active === 'true' && styles.toggleBtnLabelActive]}>
                    {editFields.is_active === 'true' ? 'Yes' : 'No'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.fieldHint}>{uiCopy.adminDashboard.adminFlagNotEditableInApp}</Text>

              {modelData && (
                <View style={styles.roleDataSection}>
                  <Text style={styles.roleDataTitle}>Model Data</Text>
                  {Object.entries(modelData).map(([key, val]) => (
                    <Text key={key} style={styles.roleDataRow}>
                      {key}: {Array.isArray(val) ? val.join(', ') : String(val ?? '—')}
                    </Text>
                  ))}
                </View>
              )}

              {agencyData && (
                <View style={styles.roleDataSection}>
                  <Text style={styles.roleDataTitle}>Agency Data</Text>
                  {Object.entries(agencyData).map(([key, val]) => (
                    <Text key={key} style={styles.roleDataRow}>
                      {key}: {String(val ?? '—')}
                    </Text>
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
  brand: { ...typography.heading, fontSize: 18, color: colors.textPrimary },
  logoutLabel: { ...typography.label, color: colors.textSecondary },
  tabRow: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tabBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  tabBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  tabLabel: { ...typography.label, fontSize: 12, color: colors.textSecondary },
  tabLabelActive: { color: colors.surface },
  feedbackBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#2ecc71', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm, borderRadius: 8,
  },
  feedbackText: { ...typography.label, color: '#fff' },
  scrollArea: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  searchInput: {
    ...typography.body, color: colors.textPrimary,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm,
  },
  filterRow: { marginBottom: spacing.md, flexDirection: 'row', gap: spacing.xs },
  filterPill: { paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, marginRight: spacing.xs },
  filterPillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  filterPillText: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  filterPillTextActive: { color: colors.surface },
  profileCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  profileCardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  profileName: { ...typography.label, color: colors.textPrimary, fontSize: 14, marginBottom: 2 },
  profileEmail: { ...typography.body, color: colors.textSecondary, fontSize: 12, marginBottom: 4 },
  profileMeta: { ...typography.body, color: colors.textSecondary, fontSize: 11, marginBottom: 2 },
  deactivatedReason: { ...typography.body, color: '#C0392B', fontSize: 11, fontStyle: 'italic' },
  profileActions: { justifyContent: 'center', alignItems: 'flex-end', gap: 4 },
  activateBtn: { backgroundColor: '#2ecc71', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  activateBtnLabel: { ...typography.label, color: '#fff', fontSize: 12 },
  deactivateBtn: { backgroundColor: '#e74c3c', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  deactivateBtnLabel: { ...typography.label, color: '#fff', fontSize: 12 },
  reasonInput: {
    ...typography.body, fontSize: 11, color: colors.textPrimary,
    borderWidth: 1, borderColor: colors.border, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, width: 120,
  },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
  logEntry: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
  logAction: { ...typography.label, color: colors.textPrimary, fontSize: 13 },
  logMeta: { ...typography.body, color: colors.textSecondary, fontSize: 11 },
  logDetails: { ...typography.body, color: colors.textSecondary, fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  editHeader: { marginBottom: spacing.md },
  backLabel: { ...typography.label, color: colors.textSecondary, fontSize: 13, marginBottom: spacing.sm },
  editTitle: { ...typography.heading, color: colors.textPrimary, fontSize: 16, marginBottom: 2 },
  editSubtitle: { ...typography.body, color: colors.textSecondary, fontSize: 11, marginBottom: spacing.md },
  editFieldRow: { marginBottom: spacing.sm },
  editFieldLabel: { ...typography.label, color: colors.textSecondary, fontSize: 11, marginBottom: 4 },
  editInput: {
    ...typography.body, color: colors.textPrimary,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  toggleBtn: {
    paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' as const,
  },
  toggleBtnActive: { backgroundColor: '#2ecc71', borderColor: '#2ecc71' },
  toggleBtnLabel: { ...typography.label, fontSize: 13, color: colors.textSecondary },
  toggleBtnLabelActive: { color: '#fff' },
  roleDataSection: {
    marginTop: spacing.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
  },
  roleDataTitle: { ...typography.heading, color: colors.textPrimary, fontSize: 14, marginBottom: spacing.sm },
  roleDataRow: { ...typography.body, color: colors.textSecondary, fontSize: 12, marginBottom: 2 },
  saveBtn: {
    backgroundColor: colors.textPrimary, paddingVertical: 12,
    borderRadius: 8, alignItems: 'center' as const, marginTop: spacing.lg,
  },
  saveBtnLabel: { ...typography.label, color: colors.surface, fontSize: 14 },
  fieldHint: { ...typography.body, color: colors.textSecondary, fontSize: 11, marginBottom: 6 },
  orgRoleSection: { marginTop: spacing.md, marginBottom: spacing.sm },
  orgRoleCard: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  orgRoleOrgName: { ...typography.label, color: colors.textPrimary, fontSize: 12, marginBottom: spacing.sm },
  orgRoleBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  orgRoleBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  orgRoleBtnLabel: { ...typography.label, color: colors.surface, fontSize: 12 },
  orgRoleEmpty: { ...typography.body, color: colors.textSecondary, fontSize: 12, marginTop: 4 },
});
