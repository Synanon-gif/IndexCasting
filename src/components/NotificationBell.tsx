/**
 * NotificationBell — header icon with unread count badge.
 * Taps open the NotificationList modal.
 * Subscribes to notificationsStore; hydrates on mount using the current session user.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  subscribeNotifications,
  getNotificationsState,
  ensureHydrated,
  type NotificationsState,
} from '../store/notificationsStore';
import { colors } from '../theme/theme';
import { NotificationList } from './NotificationList';

export function NotificationBell() {
  const [state, setState] = useState<NotificationsState>({
    notifications: [],
    unreadCount: 0,
  });
  const [visible, setVisible] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const unsub = subscribeNotifications(() => {
      setState(getNotificationsState());
    });
    setState(getNotificationsState());

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user?.id) {
          ensureHydrated(user.id);
        }
      });
    }

    return unsub;
  }, []);

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={styles.container}
        hitSlop={8}
        accessibilityLabel="Notifications"
        accessibilityRole="button"
      >
        <Text style={styles.bellIcon}>{'\u{1F514}'}</Text>
        {state.unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {state.unreadCount > 99 ? '99+' : state.unreadCount}
            </Text>
          </View>
        )}
      </Pressable>

      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVisible(false)}
      >
        <NotificationList onClose={() => setVisible(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    marginRight: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellIcon: {
    fontSize: 20,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#C0392B',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
