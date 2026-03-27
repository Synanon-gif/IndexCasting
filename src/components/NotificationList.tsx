/**
 * NotificationList — full-screen modal list of notifications.
 * Supports per-item mark-as-read (tap) and bulk mark-all-read.
 * Real-time updates flow via notificationsStore.
 */
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  subscribeNotifications,
  getNotificationsState,
  setNotificationRead,
  setAllNotificationsRead,
  type NotificationsState,
} from '../store/notificationsStore';
import type { Notification } from '../services/notificationsSupabase';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';

type Props = {
  onClose: () => void;
};

export function NotificationList({ onClose }: Props) {
  const [state, setState] = useState<NotificationsState>(getNotificationsState);

  useEffect(() => {
    const unsub = subscribeNotifications(() => {
      setState(getNotificationsState());
    });
    setState(getNotificationsState());
    return unsub;
  }, []);

  const handleMarkRead = async (id: string) => {
    await setNotificationRead(id);
  };

  const handleMarkAllRead = async () => {
    await setAllNotificationsRead();
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{uiCopy.notifications.title}</Text>
        <View style={styles.headerActions}>
          {state.unreadCount > 0 && (
            <Pressable onPress={handleMarkAllRead} style={styles.markAllBtn} hitSlop={8}>
              <Text style={styles.markAllText}>{uiCopy.notifications.markAllRead}</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Text style={styles.closeText}>{uiCopy.common.close}</Text>
          </Pressable>
        </View>
      </View>

      {/* List */}
      <FlatList<Notification>
        data={state.notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          state.notifications.length === 0 ? styles.emptyContainer : styles.listContent
        }
        renderItem={({ item }) => (
          <NotificationItem item={item} onMarkRead={handleMarkRead} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyView}>
            <Text style={styles.emptyText}>{uiCopy.notifications.empty}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ── Notification Item ─────────────────────────────────────────────────────────

type ItemProps = {
  item: Notification;
  onMarkRead: (id: string) => void;
};

function NotificationItem({ item, onMarkRead }: ItemProps) {
  return (
    <Pressable
      onPress={() => {
        if (!item.is_read) onMarkRead(item.id);
      }}
      style={[styles.item, item.is_read && styles.itemRead]}
    >
      {!item.is_read && <View style={styles.unreadDot} />}
      <View style={styles.itemContent}>
        <Text style={[styles.itemTitle, item.is_read && styles.itemTitleRead]}>
          {item.title}
        </Text>
        <Text style={styles.itemMessage}>{item.message}</Text>
        <Text style={styles.itemTime}>{formatRelativeTime(item.created_at)}</Text>
      </View>
    </Pressable>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.label,
    color: colors.textPrimary,
    fontSize: 13,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  markAllBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  markAllText: {
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeText: {
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  listContent: {
    paddingVertical: spacing.xs,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  itemRead: {
    backgroundColor: colors.background,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C0392B',
    marginTop: 5,
    marginRight: spacing.sm,
    flexShrink: 0,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  itemTitleRead: {
    fontWeight: '400',
    color: colors.textSecondary,
  },
  itemMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 4,
  },
  itemTime: {
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
});
