/**
 * PaywallGate
 *
 * Wraps any screen or section that requires an active platform subscription.
 * When access is blocked, renders PaywallScreen instead of children.
 * When still loading, renders a neutral loading indicator.
 *
 * Usage:
 *   <PaywallGate>
 *     <MyProtectedScreen />
 *   </PaywallGate>
 *
 * Security note: this is a UI gate only. Server-side RPCs are the real enforcement.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSubscription } from '../context/SubscriptionContext';
import PaywallScreen from '../screens/PaywallScreen';
import { colors } from '../theme/theme';

interface PaywallGateProps {
  children: React.ReactNode;
  /**
   * UNSAFE: skips the paywall UI gate and always renders children.
   *
   * Use ONLY for provably non-sensitive screens (e.g. public profile preview
   * or guest-link landing). The server-side RPCs remain the authoritative
   * enforcement layer regardless of this flag.
   *
   * The deliberately verbose name makes accidental misuse visible in code
   * review. Do NOT pass `true` to gate protected screens. (VULN-07 fix)
   */
  _unsafeBypassForPublicPreviewOnly?: boolean;
}

export default function PaywallGate({ children, _unsafeBypassForPublicPreviewOnly = false }: PaywallGateProps) {
  const { loaded, isBlocked } = useSubscription();

  // Show neutral loader while initial access check is in flight.
  if (!loaded) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.accentGreen} />
      </View>
    );
  }

  if (!_unsafeBypassForPublicPreviewOnly && isBlocked) {
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
