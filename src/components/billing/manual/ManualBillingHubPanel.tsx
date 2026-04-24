/**
 * ManualBillingHubPanel — Entry view for the Manual Billing sub-system.
 *
 * Lives under the existing Billing tab as its own sub-tab ("Manual invoices").
 * Strictly additive: this panel manages its own internal sub-navigation
 * (entry → profiles | invoices | builder → preview) without touching the
 * parent BillingHubView routing.
 *
 * Visibility rules:
 *   - Agency owners + bookers (operational members) can use everything.
 *   - Anyone else sees a "not available" notice.
 *   - Models NEVER see this UI (billing firewall — never mounted in model
 *     workspace; this panel only renders when called from `variant="agency"`
 *     in BillingHubView).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, spacing, typography } from '../../../theme/theme';
import { uiCopy } from '../../../constants/uiCopy';
import { useAuth } from '../../../context/AuthContext';
import { isOrganizationOperationalMember } from '../../../services/orgRoleTypes';
import {
  listManualAgencyBillingProfiles,
  listManualBillingCounterparties,
} from '../../../services/manualBillingProfilesSupabase';
import { listManualInvoices } from '../../../services/manualInvoicesSupabase';

import { ManualBillingProfilesPanel } from './ManualBillingProfilesPanel';
import { ManualInvoiceListPanel } from './ManualInvoiceListPanel';
import { ManualInvoiceBuilderPanel } from './ManualInvoiceBuilderPanel';

type ViewState =
  | { kind: 'home' }
  | { kind: 'profiles' }
  | { kind: 'invoices' }
  | { kind: 'builder'; invoiceId: string | null };

type Props = {
  agencyOrganizationId: string | null;
};

export const ManualBillingHubPanel: React.FC<Props> = ({ agencyOrganizationId }) => {
  const c = uiCopy.manualBilling;
  const { profile } = useAuth();
  const isMember = isOrganizationOperationalMember(profile?.org_member_role);

  const [view, setView] = useState<ViewState>({ kind: 'home' });

  // Lightweight counts for the entry tiles
  const [counts, setCounts] = useState({
    profiles: 0,
    invoices: 0,
    drafts: 0,
  });
  const [loadingCounts, setLoadingCounts] = useState(false);

  const loadCounts = useCallback(async () => {
    if (!agencyOrganizationId || !isMember) {
      setCounts({ profiles: 0, invoices: 0, drafts: 0 });
      return;
    }
    setLoadingCounts(true);
    try {
      const [agencyProfiles, counterparties, invoices] = await Promise.all([
        listManualAgencyBillingProfiles(agencyOrganizationId),
        listManualBillingCounterparties(agencyOrganizationId),
        listManualInvoices(agencyOrganizationId),
      ]);
      setCounts({
        profiles: (agencyProfiles?.length ?? 0) + (counterparties?.length ?? 0),
        invoices: invoices.filter((i) => i.status === 'generated').length,
        drafts: invoices.filter((i) => i.status === 'draft').length,
      });
    } finally {
      setLoadingCounts(false);
    }
  }, [agencyOrganizationId, isMember]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  // Re-load counts when we return to home (a child likely changed state)
  useEffect(() => {
    if (view.kind === 'home') {
      void loadCounts();
    }
  }, [view.kind, loadCounts]);

  const goHome = useCallback(() => setView({ kind: 'home' }), []);

  if (!isMember) {
    return (
      <View style={s.notAllowedBox}>
        <Text style={s.notAllowedText}>{c.notAvailableForRole}</Text>
      </View>
    );
  }

  if (!agencyOrganizationId) {
    return (
      <View style={s.notAllowedBox}>
        <Text style={s.notAllowedText}>{c.notAvailableForRole}</Text>
      </View>
    );
  }

  // ── Sub-views ───────────────────────────────────────────────────────────
  if (view.kind === 'profiles') {
    return (
      <ManualBillingProfilesPanel agencyOrganizationId={agencyOrganizationId} onBack={goHome} />
    );
  }
  if (view.kind === 'invoices') {
    return (
      <ManualInvoiceListPanel
        agencyOrganizationId={agencyOrganizationId}
        onBack={goHome}
        onCreateNew={() => setView({ kind: 'builder', invoiceId: null })}
        onEdit={(invoiceId) => setView({ kind: 'builder', invoiceId })}
      />
    );
  }
  if (view.kind === 'builder') {
    return (
      <ManualInvoiceBuilderPanel
        agencyOrganizationId={agencyOrganizationId}
        invoiceId={view.invoiceId}
        onBack={() => setView({ kind: 'invoices' })}
        onDone={() => setView({ kind: 'invoices' })}
      />
    );
  }

  // ── Home (entry tiles) ──────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={s.homeContainer}>
      <View style={s.headerBlock}>
        <Text style={s.headerTitle}>{c.headerTitle}</Text>
        <Text style={s.headerSubtitle}>{c.headerSubtitle}</Text>
      </View>

      <Tile
        title={c.tileProfilesTitle}
        subtitle={c.tileProfilesSubtitle}
        meta={loadingCounts ? null : c.countLabelProfiles(counts.profiles)}
        onPress={() => setView({ kind: 'profiles' })}
      />
      <Tile
        title={c.tileCreateInvoiceTitle}
        subtitle={c.tileCreateInvoiceSubtitle}
        meta={null}
        primary
        onPress={() => setView({ kind: 'builder', invoiceId: null })}
      />
      <Tile
        title={c.tileInvoicesTitle}
        subtitle={c.tileInvoicesSubtitle}
        meta={
          loadingCounts
            ? null
            : `${c.countLabelInvoices(counts.invoices)} • ${c.countLabelDrafts(counts.drafts)}`
        }
        onPress={() => setView({ kind: 'invoices' })}
      />

      {loadingCounts && (
        <View style={{ alignItems: 'center', marginTop: spacing.md }}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      )}
    </ScrollView>
  );
};

// ── Tile sub-component ────────────────────────────────────────────────────

type TileProps = {
  title: string;
  subtitle: string;
  meta: string | null;
  primary?: boolean;
  onPress: () => void;
};

const Tile: React.FC<TileProps> = ({ title, subtitle, meta, primary, onPress }) => (
  <TouchableOpacity
    style={[s.tile, primary && s.tilePrimary]}
    onPress={onPress}
    accessibilityRole="button"
  >
    <Text style={[s.tileTitle, primary && s.tileTitlePrimary]}>{title}</Text>
    <Text style={[s.tileSubtitle, primary && s.tileSubtitlePrimary]}>{subtitle}</Text>
    {meta && <Text style={[s.tileMeta, primary && s.tileMetaPrimary]}>{meta}</Text>}
  </TouchableOpacity>
);

// ── styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  notAllowedBox: {
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  notAllowedText: {
    ...typography.body,
    color: colors.textSecondary,
  },

  homeContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  headerBlock: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  headerSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  tile: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  tilePrimary: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  tileTitle: {
    ...typography.body,
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.textPrimary,
  },
  tileTitlePrimary: { color: colors.background },
  tileSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  tileSubtitlePrimary: { color: 'rgba(255,255,255,0.85)' },
  tileMeta: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  tileMetaPrimary: { color: 'rgba(255,255,255,0.7)' },
});

export default ManualBillingHubPanel;
