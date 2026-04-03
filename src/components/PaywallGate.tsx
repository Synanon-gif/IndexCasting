/**
 * PaywallGate
 *
 * Wraps any screen or section that requires an active platform subscription.
 * When access is blocked, renders PaywallScreen instead of children.
 * When still loading, renders a neutral loading indicator.
 *
 * ## When to use
 * Wrap every new screen or tab that should only be reachable with an active
 * subscription or trial. The top-level App.tsx guards (ClientPaywallGuard /
 * AgencyPaywallGuard) cover the root client/agency workspaces, but any
 * future modals, deep-link routes, or sub-screens that mount outside those
 * guards MUST use <PaywallGate> directly.
 *
 * ## Security note
 * This is a UI gate only. The authoritative enforcement layer is the
 * can_access_platform() SECURITY DEFINER RPC on the server. Data returned by
 * RPCs that call has_platform_access() is safe regardless of UI state.
 *
 * ## Usage
 *   <PaywallGate>
 *     <MyProtectedScreen />
 *   </PaywallGate>
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSubscription } from '../context/SubscriptionContext';
import PaywallScreen from '../screens/PaywallScreen';
import { colors } from '../theme/theme';

interface PaywallGateProps {
  children: React.ReactNode;
}

export default function PaywallGate({ children }: PaywallGateProps) {
  const { loaded, isBlocked } = useSubscription();

  if (!loaded) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.accentGreen} />
      </View>
    );
  }

  if (isBlocked) {
    return <PaywallScreen />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
