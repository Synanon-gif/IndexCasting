import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getAgencyModels } from '../services/apiService';
import { AgencyRecruitingView } from '../views/AgencyRecruitingView';
import { BookingChatView } from '../views/BookingChatView';
import {
  getConnectionsForAgencyByIdOrCode,
  sendConnectionRequest,
  acceptConnection,
  rejectConnection,
  subscribeConnections,
  type Connection,
} from '../store/connectionsStore';
import { getAgencies } from '../services/agenciesSupabase';

const DEMO_CLIENT_ID = 'user-client';
const DEMO_CLIENT_LABEL = 'Client (Demo)';

type AgencyModel = {
  id: string;
  name: string;
  traction: number;
  visibility: {
    commercial: boolean;
    highFashion: boolean;
  };
};

type AgencyDashboardScreenProps = {
  onBackToRoleSelection?: () => void;
};

export const AgencyDashboardScreen: React.FC<AgencyDashboardScreenProps> = ({
  onBackToRoleSelection,
}) => {
  const [items, setItems] = useState<AgencyModel[]>([]);
  const [showRecruiting, setShowRecruiting] = useState(false);
  const [openRecruitingBookingThreadId, setOpenRecruitingBookingThreadId] = useState<string | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  const [agencies, setAgencies] = useState<{ id: string }[]>([]);
  const currentAgencyId = agencies.find((a: any) => a.code === 'a1')?.id ?? agencies[0]?.id ?? '';
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    getAgencies().then(setAgencies);
  }, []);

  useEffect(() => {
    if (!currentAgencyId) return;
    const refresh = () => setConnections(getConnectionsForAgencyByIdOrCode(currentAgencyId, 'a1'));
    refresh();
    const unsub = subscribeConnections(refresh);
    return unsub;
  }, [currentAgencyId]);

  useEffect(() => {
    if (!currentAgencyId) return;
    getAgencyModels(currentAgencyId).then((data: any) => {
      setItems(
        data.map((m: any) => ({
          id: m.id,
          name: m.name,
          traction: m.traction ?? 0,
          visibility: {
            commercial: m.isVisibleCommercial ?? true,
            highFashion: m.isVisibleFashion ?? false,
          },
        })),
      );
    });
  }, [currentAgencyId]);

  const toggleVisibility = (
    id: string,
    key: keyof AgencyModel['visibility'],
  ) => {
    setItems((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              visibility: {
                ...m.visibility,
                [key]: !m.visibility[key],
              },
            }
          : m,
      ),
    );
  };

  if (showRecruiting) {
    return (
      <>
        <AgencyRecruitingView
          onBack={() => setShowRecruiting(false)}
          agencyId={currentAgencyId}
          onOpenBookingChat={(threadId) => setOpenRecruitingBookingThreadId(threadId)}
        />
        {openRecruitingBookingThreadId != null && (
          <BookingChatView
            threadId={openRecruitingBookingThreadId}
            fromRole="agency"
            onClose={() => setOpenRecruitingBookingThreadId(null)}
          />
        )}
      </>
    );
  }

  if (showConnections) {
    const conns = currentAgencyId ? getConnectionsForAgencyByIdOrCode(currentAgencyId, 'a1') : [];
    const incoming = conns.filter((c) => c.status === 'pending' && c.requestedBy === 'client');
    const connected = conns.filter((c) => c.status === 'accepted');
    const hasRequestToClient = conns.some(
      (c) => c.clientId === DEMO_CLIENT_ID && (c.status === 'pending' || c.status === 'accepted')
    );
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backRow} onPress={() => setShowConnections(false)}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.label}>Connections</Text>
        <Text style={styles.heading}>Client connections</Text>
        <ScrollView style={{ flex: 1 }}>
          {incoming.length > 0 && (
            <View style={styles.connectionsSection}>
              <Text style={styles.connectionsSectionLabel}>Incoming requests</Text>
              {incoming.map((c) => (
                <View key={c.id} style={styles.connectionRow}>
                  <Text style={styles.connectionRowLabel}>Client</Text>
                  <View style={styles.connectionRowActions}>
                    <TouchableOpacity style={styles.connectionAcceptBtn} onPress={() => acceptConnection(c.id)}>
                      <Text style={styles.connectionAcceptLabel}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.connectionRejectBtn} onPress={() => rejectConnection(c.id)}>
                      <Text style={styles.connectionRejectLabel}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
          {connected.length > 0 && (
            <View style={styles.connectionsSection}>
              <Text style={styles.connectionsSectionLabel}>Connected</Text>
              {connected.map((c) => (
                <View key={c.id} style={styles.connectionRow}>
                  <Text style={styles.connectionRowLabel}>Client</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.connectionsSection}>
            <Text style={styles.connectionsSectionLabel}>Send request to client</Text>
            <View style={styles.connectionRow}>
              <Text style={styles.connectionRowLabel}>{DEMO_CLIENT_LABEL}</Text>
              {hasRequestToClient ? (
                <Text style={styles.connectionPendingLabel}>Pending / Connected</Text>
              ) : (
                <TouchableOpacity
                  style={styles.connectionSendBtn}
                  onPress={() => currentAgencyId && sendConnectionRequest(DEMO_CLIENT_ID, currentAgencyId, 'agency')}
                >
                  <Text style={styles.connectionSendLabel}>Send request</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {onBackToRoleSelection && (
        <TouchableOpacity
          style={styles.backRow}
          onPress={onBackToRoleSelection}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Logout</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.label}>Agency workspace</Text>
      <Text style={styles.heading}>Traction</Text>

      <TouchableOpacity
        style={styles.recruitingEntry}
        onPress={() => setShowRecruiting(true)}
      >
        <Text style={styles.recruitingEntryLabel}>Recruiting</Text>
        <Text style={styles.recruitingEntryHint}>Review model applications</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.recruitingEntry}
        onPress={() => setShowConnections(true)}
      >
        <Text style={styles.recruitingEntryLabel}>Connections</Text>
        <Text style={styles.recruitingEntryHint}>Client connection requests</Text>
      </TouchableOpacity>

      <View style={styles.list}>
        {items.map((m) => (
          <View key={m.id} style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.name}>{m.name}</Text>
              <Text style={styles.traction}>{m.traction} swipes</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.visibilityLabel}>Visibility</Text>
              <View style={styles.toggleRow}>
                <VisibilityToggle
                  label="Commercial"
                  active={m.visibility.commercial}
                  onPress={() => toggleVisibility(m.id, 'commercial')}
                  tone="green"
                />
                <VisibilityToggle
                  label="High-Fashion"
                  active={m.visibility.highFashion}
                  onPress={() => toggleVisibility(m.id, 'highFashion')}
                  tone="brown"
                />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

type VisibilityToggleProps = {
  label: string;
  active: boolean;
  tone: 'green' | 'brown';
  onPress: () => void;
};

const VisibilityToggle: React.FC<VisibilityToggleProps> = ({
  label,
  active,
  tone,
  onPress,
}) => {
  const activeColor = tone === 'green' ? colors.accentGreen : colors.accentBrown;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.togglePill,
        active && { backgroundColor: activeColor, borderColor: activeColor },
      ]}
    >
      <Text
        style={[
          styles.toggleLabel,
          active && { color: colors.surface },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  backArrow: {
    fontSize: 22,
    color: colors.textPrimary,
  },
  backLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  recruitingEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recruitingEntryLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  recruitingEntryHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  name: {
    ...typography.body,
    color: colors.textPrimary,
  },
  traction: {
    ...typography.body,
    color: colors.textSecondary,
  },
  visibilityLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  togglePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  toggleLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  connectionsSection: {
    marginBottom: spacing.lg,
  },
  connectionsSectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: spacing.xs,
  },
  connectionRowLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  connectionRowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  connectionAcceptBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.buttonOptionGreen,
  },
  connectionAcceptLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
  connectionRejectBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  connectionRejectLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  connectionSendBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
  },
  connectionSendLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
  connectionPendingLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
});

