/**
 * PaywallScreen
 *
 * Shown when platform access is denied (trial expired / no subscription).
 * Renders an org-type-aware layout:
 *   - Client orgs  → single "Client" plan CTA, full-app-lock messaging
 *   - Agency orgs  → 3-card agency plan comparison
 *   - Unknown type → all plans (safe fallback)
 *
 * This screen is UI-only — access is never granted here.
 * The actual enforcement is in can_access_platform() (server-side).
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { uiCopy } from '../constants/uiCopy';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { createCheckoutSession, PLAN_LIMITS, type PlanType } from '../services/subscriptionSupabase';
import { colors, spacing, typography } from '../theme/theme';
import { validateUrl } from '../../lib/validation';

// ─── Plan card data ───────────────────────────────────────────────────────────

interface PlanCard {
  id: PlanType;
  label: string;
  audience: 'agency' | 'client';
  features: string[];
  highlight: boolean;
}

const ALL_PLAN_CARDS: PlanCard[] = [
  {
    id:       'agency_basic',
    label:    uiCopy.billing.planNameAgencyBasic,
    audience: 'agency',
    features: [
      uiCopy.billing.swipesPerDay(10),
      uiCopy.billing.storageLimit(5),
      uiCopy.billing.agencyTeamSeats(PLAN_LIMITS.agency_basic.maxAgencyMembers ?? 2),
      uiCopy.billing.realtimeMessaging,
      uiCopy.billing.castingManagement,
    ],
    highlight: false,
  },
  {
    id:       'agency_pro',
    label:    uiCopy.billing.planNameAgencyPro,
    audience: 'agency',
    features: [
      uiCopy.billing.swipesPerDay(50),
      uiCopy.billing.storageLimit(50),
      uiCopy.billing.agencyTeamSeats(PLAN_LIMITS.agency_pro.maxAgencyMembers ?? 4),
      uiCopy.billing.realtimeMessaging,
      uiCopy.billing.castingManagement,
      uiCopy.billing.fullPlatformAccess,
    ],
    highlight: true,
  },
  {
    id:       'agency_enterprise',
    label:    uiCopy.billing.planNameAgencyEnterprise,
    audience: 'agency',
    features: [
      uiCopy.billing.swipesPerDay(150),
      uiCopy.billing.storageLimit(500),
      uiCopy.billing.agencyTeamSeatsUnlimited,
      uiCopy.billing.realtimeMessaging,
      uiCopy.billing.castingManagement,
      uiCopy.billing.fullPlatformAccess,
    ],
    highlight: false,
  },
  {
    id:       'client',
    label:    uiCopy.billing.planNameClient,
    audience: 'client',
    features: [
      uiCopy.billing.swipesUnlimited,
      uiCopy.billing.storageUnlimited,
      uiCopy.billing.realtimeMessaging,
      uiCopy.billing.castingManagement,
      uiCopy.billing.fullPlatformAccess,
    ],
    highlight: true,
  },
];

// ─── Plan card component ──────────────────────────────────────────────────────

interface PlanCardProps {
  plan: PlanCard;
  loadingPlan: PlanType | null;
  onSelect: (plan: PlanType) => void;
}

function PlanCardView({ plan, loadingPlan, onSelect }: PlanCardProps) {
  return (
    <View style={[styles.card, plan.highlight && styles.cardHighlighted]}>
      {plan.highlight && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularBadgeText}>{uiCopy.billing.planCardRecommendedBadge}</Text>
        </View>
      )}

      <Text style={[styles.planName, plan.highlight && styles.planNameHighlighted]}>
        {plan.label}
      </Text>

      <View style={styles.featureList}>
        {plan.features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Text style={[styles.featureCheck, plan.highlight && styles.featureCheckHighlighted]}>
              ✓
            </Text>
            <Text style={[styles.featureText, plan.highlight && styles.featureTextHighlighted]}>
              {feature}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[
          styles.ctaButton,
          plan.highlight && styles.ctaButtonHighlighted,
          loadingPlan === plan.id && styles.ctaButtonLoading,
        ]}
        onPress={() => onSelect(plan.id)}
        disabled={loadingPlan !== null}
      >
        {loadingPlan === plan.id ? (
          <ActivityIndicator
            size="small"
            color={plan.highlight ? colors.accentGreen : colors.textPrimary}
          />
        ) : (
          <Text style={[styles.ctaText, plan.highlight && styles.ctaTextHighlighted]}>
            {uiCopy.billing.upgradeCTA}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PaywallScreen() {
  const { trialDaysLeft, accessStatus, orgType } = useSubscription();
  const { profile } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<PlanType | null>(null);

  // Only owners may initiate a subscription purchase.
  const isOwner = profile?.org_member_role === 'owner';

  const isTrialExpired    = accessStatus?.reason === 'no_active_subscription';
  const isTrialAlreadyUsed = accessStatus?.reason === 'trial_already_used';
  const isTrialActive     = accessStatus?.reason === 'trial_active';

  // Determine which plan cards to show based on org type.
  // Client orgs see only the 'client' plan. Agency orgs see only agency plans.
  // null/unknown falls back to showing all plans safely.
  const visibleCards = orgType === 'client'
    ? ALL_PLAN_CARDS.filter((c) => c.audience === 'client')
    : orgType === 'agency'
    ? ALL_PLAN_CARDS.filter((c) => c.audience === 'agency')
    : ALL_PLAN_CARDS;

  const isClientPaywall = orgType === 'client';

  async function handleSelectPlan(plan: PlanType) {
    if (loadingPlan) return;
    setLoadingPlan(plan);
    try {
      const result = await createCheckoutSession(plan);
      if (!result?.checkout_url) {
        Alert.alert(uiCopy.common.error, uiCopy.billing.checkoutFailed);
        return;
      }
      if (!validateUrl(result.checkout_url).ok) {
        Alert.alert(uiCopy.common.error, uiCopy.billing.checkoutFailed);
        return;
      }
      await Linking.openURL(result.checkout_url);
    } catch {
      Alert.alert(uiCopy.common.error, uiCopy.billing.checkoutFailed);
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header — different copy for client vs agency */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {isClientPaywall ? uiCopy.billing.paywallClientTitle : uiCopy.billing.paywallTitle}
        </Text>
        <Text style={styles.subtitle}>
          {isClientPaywall
            ? uiCopy.billing.paywallClientSubtitle
            : uiCopy.billing.paywallSubtitle}
        </Text>
      </View>

      {/* Trial banner — shown for both org types when trial is still active */}
      {isTrialActive && trialDaysLeft > 0 && (
        <View style={styles.trialBanner}>
          <Text style={styles.trialBadge}>{uiCopy.billing.trialBadge}</Text>
          <Text style={styles.trialText}>{uiCopy.billing.trialDaysLeft(trialDaysLeft)}</Text>
        </View>
      )}

      {/* Expired banner */}
      {isTrialExpired && (
        <View style={styles.expiredBanner}>
          <Text style={styles.expiredTitle}>{uiCopy.billing.trialExpiredTitle}</Text>
          <Text style={styles.expiredBody}>
            {isClientPaywall
              ? uiCopy.billing.paywallClientLockedBody
              : uiCopy.billing.trialExpiredBody}
          </Text>
        </View>
      )}

      {/* Trial already used banner */}
      {isTrialAlreadyUsed && (
        <View style={styles.expiredBanner}>
          <Text style={styles.expiredTitle}>{uiCopy.billing.trialAlreadyUsedTitle}</Text>
          <Text style={styles.expiredBody}>{uiCopy.billing.trialAlreadyUsedBody}</Text>
        </View>
      )}

      {/* Plan cards — only owners may initiate checkout; others see a contact note */}
      {isOwner ? (
        visibleCards.map((plan) => (
          <PlanCardView
            key={plan.id}
            plan={plan}
            loadingPlan={loadingPlan}
            onSelect={handleSelectPlan}
          />
        ))
      ) : (
        <View style={styles.nonOwnerNotice}>
          <Text style={styles.nonOwnerTitle}>{uiCopy.billing.nonOwnerPaywallTitle}</Text>
          <Text style={styles.nonOwnerBody}>{uiCopy.billing.nonOwnerPaywallBody}</Text>
        </View>
      )}

      {/* Footer — only agency orgs see the enterprise contact note */}
      {!isClientPaywall && (
        <Text style={styles.footerNote}>
          {uiCopy.billing.paywallEnterpriseFooterLead}{' '}
          <Text
            style={styles.footerLink}
            onPress={() => Linking.openURL('mailto:hello@indexcasting.com')}
          >
            {uiCopy.billing.contactSales}
          </Text>
        </Text>
      )}

      {/* Client footer — support link */}
      {isClientPaywall && (
        <Text style={styles.footerNote}>
          {uiCopy.billing.paywallClientSupportLead}{' '}
          <Text
            style={styles.footerLink}
            onPress={() => Linking.openURL('mailto:hello@indexcasting.com')}
          >
            {uiCopy.billing.paywallContactSupport}
          </Text>
        </Text>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  header: {
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Trial banners
  trialBanner: {
    backgroundColor: colors.accentGreen,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  trialBadge: {
    ...typography.label,
    color: colors.surface,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 4,
  },
  trialText: {
    ...typography.body,
    color: colors.surface,
  },
  expiredBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  expiredTitle: {
    ...typography.label,
    color: colors.buttonSkipRed,
    marginBottom: spacing.xs,
  },
  expiredBody: {
    ...typography.body,
    color: colors.textSecondary,
  },

  // Plan cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHighlighted: {
    backgroundColor: colors.accentGreen,
    borderColor: colors.accentGreen,
  },
  popularBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  popularBadgeText: {
    ...typography.label,
    color: colors.surface,
    fontSize: 9,
  },
  planName: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  planNameHighlighted: {
    color: colors.surface,
  },
  featureList: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureCheck: {
    color: colors.accentGreen,
    fontSize: 14,
    fontWeight: '700',
  },
  featureCheckHighlighted: {
    color: 'rgba(255,255,255,0.9)',
  },
  featureText: {
    ...typography.body,
    color: colors.textSecondary,
    flex: 1,
  },
  featureTextHighlighted: {
    color: 'rgba(255,255,255,0.85)',
  },

  // CTA buttons
  ctaButton: {
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  ctaButtonHighlighted: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
  },
  ctaButtonLoading: {
    opacity: 0.6,
  },
  ctaText: {
    ...typography.label,
    color: colors.textPrimary,
  },
  ctaTextHighlighted: {
    color: colors.accentGreen,
  },

  // Non-owner notice
  nonOwnerNotice: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  nonOwnerTitle: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  nonOwnerBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Footer
  footerNote: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  footerLink: {
    color: colors.accentGreen,
    textDecorationLine: 'underline',
  },
});
