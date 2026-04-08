import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { ModelProfileScreen } from '../screens/ModelProfileScreen';
import { ModelApplicationsView } from './ModelApplicationsView';
import { getModelForUserFromSupabase } from '../services/modelsSupabase';
import { getOptionRequestsForModel, type SupabaseOptionRequest } from '../services/optionRequestsSupabase';
import { colors, spacing } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { toDisplayStatus, statusColor, statusBgColor } from '../utils/statusHelpers';

type ModelTab = 'inbox' | 'profile';

type ModelViewProps = {
  onBackToRoleSelection: () => void;
  userId?: string | null;
};

export const ModelView: React.FC<ModelViewProps> = ({ onBackToRoleSelection, userId }) => {
  const [modelId, setModelId] = useState<string | null | 'loading'>('loading');
  const [activeTab, setActiveTab] = useState<ModelTab>('inbox');

  useEffect(() => {
    if (!userId) {
      setModelId(null);
      return;
    }
    let cancelled = false;
    setModelId('loading');
    getModelForUserFromSupabase(userId).then((m) => {
      if (!cancelled) setModelId(m ? m.id : null);
    });
    return () => { cancelled = true; };
  }, [userId]);

  if (modelId === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (modelId === null && userId) {
    return (
      <ModelApplicationsView
        applicantUserId={userId}
        onBackToRoleSelection={onBackToRoleSelection}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {(['inbox', 'profile'] as ModelTab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabItem, activeTab === t && styles.tabItemActive]}
            onPress={() => setActiveTab(t)}
          >
            <Text style={[styles.tabLabel, activeTab === t && styles.tabLabelActive]}>
              {t === 'inbox' ? uiCopy.dashboard.inboxTitle : uiCopy.dashboard.profileTab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'inbox' && modelId && (
        <ModelUnifiedInbox modelId={modelId} />
      )}

      {activeTab === 'profile' && (
        <ModelProfileScreen onBackToRoleSelection={onBackToRoleSelection} userId={userId ?? undefined} />
      )}
    </View>
  );
};

/** Priority-sorted unified inbox: action_required → unread → chronological. */
const ModelUnifiedInbox: React.FC<{ modelId: string }> = ({ modelId }) => {
  const [requests, setRequests] = useState<SupabaseOptionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const copy = uiCopy.dashboard;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await getOptionRequestsForModel(modelId);
      setRequests(data);
    } catch (e) {
      console.error('ModelUnifiedInbox load error:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => { void load(); }, [load]);

  /** Assign priority: 0 = action required, 1 = in_negotiation (unread-ish), 2 = rest. */
  const sorted = useMemo(() => {
    return [...requests].sort((a, b) => {
      const priority = (r: SupabaseOptionRequest): number => {
        if (r.model_approval === 'pending') return 0; // action required
        if (r.status === 'in_negotiation') return 1;  // unread / active
        return 2;
      };
      const diff = priority(a) - priority(b);
      if (diff !== 0) return diff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [requests]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{uiCopy.common.error}</Text>
        <TouchableOpacity onPress={() => void load()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.textPrimary, fontSize: 13 }}>{uiCopy.common.retry}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (sorted.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{copy.inboxEmpty}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ padding: spacing.md }}>
      {sorted.map((r) => {
        const displayStatus = toDisplayStatus(r.status, r.final_status ?? null);
        const isActionRequired = r.model_approval === 'pending';
        return (
          <View key={r.id} style={[styles.inboxRow, isActionRequired && styles.inboxRowHighlight]}>
            <View style={{ flex: 1 }}>
              {isActionRequired && (
                <Text style={styles.actionTag}>{copy.inboxActionRequired}</Text>
              )}
              <Text style={styles.inboxModelName}>
                {r.model_name?.trim() ? r.model_name : copy.optionRequestUnnamedModel}
              </Text>
              <Text style={styles.inboxDate}>{r.requested_date ?? r.created_at.slice(0, 10)}</Text>
              {r.request_type ? (
                <Text style={styles.inboxRole}>
                  {r.request_type === 'casting' ? copy.threadContextCasting : copy.threadContextOption}
                </Text>
              ) : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusBgColor(displayStatus) }]}>
              <Text style={[styles.statusText, { color: statusColor(displayStatus) }]}>
                {displayStatus}
              </Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textSecondary,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabItem: {
    flex: 1,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.textPrimary,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tabLabelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inboxRowHighlight: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  actionTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#b45309',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  inboxModelName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  inboxDate: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  inboxRole: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginLeft: spacing.sm,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
