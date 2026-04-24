/**
 * BillingHubView — top-level Billing tab content.
 *
 * Replaces the inline Billing block that used to live in Settings. Provides
 * a sub-tab bar and routes to:
 *   Agency:  Outgoing | Incoming | Settlements | Clients & presets | Profiles | Defaults
 *   Client:  Received | Profiles | Defaults
 *
 * Smart Attention banner (deriveBillingAttention) is rendered at the top and
 * follows the same role visibility rules as the Billing tab badge.
 *
 * Owner-only writes are enforced inside each child panel; non-owners see
 * read-only state plus a banner reminder.
 *
 * IMPORTANT — never mount in model workspace (billing firewall: I-PAY-10).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { useAuth } from '../../context/AuthContext';
import { isOrganizationOwner, isOrganizationOperationalMember } from '../../services/orgRoleTypes';
import {
  listInvoicesForOrganization,
  listInvoicesForRecipient,
} from '../../services/invoicesSupabase';
import { listAgencyModelSettlements } from '../../services/agencyModelSettlementsSupabase';
import { listOrganizationBillingProfiles } from '../../services/billingProfilesSupabase';
import {
  type BillingAttentionRole,
  type BillingAttentionSeverity,
  deriveBillingAttention,
  filterBillingAttentionForRole,
  highestBillingSeverityForRole,
} from '../../utils/billingAttention';
import { InvoicesPanel } from '../InvoicesPanel';
import { OrganizationBillingProfilesPanel } from './OrganizationBillingProfilesPanel';
import { OrganizationBillingDefaultsPanel } from './OrganizationBillingDefaultsPanel';
import { AgencyModelSettlementsPanel } from './AgencyModelSettlementsPanel';
import { BillingPresetsPanel } from './BillingPresetsPanel';
import { ManualBillingHubPanel } from './manual/ManualBillingHubPanel';

export type BillingHubVariant = 'agency' | 'client';

type AgencySubTab =
  | 'outgoing'
  | 'incoming'
  | 'settlements'
  | 'presets'
  | 'profiles'
  | 'defaults'
  | 'manual';

type ClientSubTab = 'received' | 'profiles' | 'defaults';

type Props = {
  organizationId: string | null;
  variant: BillingHubVariant;
};

const SEVERITY_COLOR: Record<BillingAttentionSeverity, string> = {
  critical: colors.errorDark,
  high: colors.warningDark,
  medium: colors.warning,
  low: colors.textSecondary,
};

export const BillingHubView: React.FC<Props> = ({ organizationId, variant }) => {
  const { profile } = useAuth();
  const hub = uiCopy.billingHub;
  const isOwner = isOrganizationOwner(profile?.org_member_role);
  // Phase A (2026-11-20): Member (Owner/Booker/Employee) haben Write-Zugriff auf
  // operationale Aktionen (Invoices/Settlements/Presets). Owner-only-Bereiche
  // (Profiles, Defaults, Delete Draft, Void) signalisieren ihre Beschränkung
  // selbst via ownerOnlyHint. Globaler Read-only-Banner nur noch wenn Caller
  // nicht mal Member ist (Defense-in-Depth — sollte hier nie eintreten).
  const isMember = isOrganizationOperationalMember(profile?.org_member_role);

  const role: BillingAttentionRole = useMemo(() => {
    if (variant === 'agency') return isOwner ? 'agency_owner' : 'agency_member';
    return isOwner ? 'client_owner' : 'client_member';
  }, [variant, isOwner]);

  const [agencyTab, setAgencyTab] = useState<AgencySubTab>('outgoing');
  const [clientTab, setClientTab] = useState<ClientSubTab>('received');

  // ── Attention pipeline (lightweight pre-load) ────────────────────────────
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [signals, setSignals] = useState<ReturnType<typeof deriveBillingAttention>>([]);

  const loadAttention = useCallback(async () => {
    if (!organizationId) {
      setSignals([]);
      return;
    }
    setAttentionLoading(true);
    try {
      const [issued, received, settlements, profiles] = await Promise.all([
        variant === 'agency'
          ? listInvoicesForOrganization(organizationId)
          : Promise.resolve([] as Awaited<ReturnType<typeof listInvoicesForOrganization>>),
        listInvoicesForRecipient(organizationId),
        variant === 'agency'
          ? listAgencyModelSettlements(organizationId)
          : Promise.resolve([] as Awaited<ReturnType<typeof listAgencyModelSettlements>>),
        listOrganizationBillingProfiles(organizationId),
      ]);
      const next = deriveBillingAttention({
        issuedInvoices: issued ?? [],
        receivedInvoices: received ?? [],
        settlements: settlements ?? [],
        hasBillingProfile: (profiles ?? []).length > 0,
      });
      setSignals(next);
    } catch (e) {
      console.error('[BillingHubView] attention load failed:', e);
      setSignals([]);
    } finally {
      setAttentionLoading(false);
    }
  }, [organizationId, variant]);

  useEffect(() => {
    void loadAttention();
  }, [loadAttention]);

  const visibleSignals = useMemo(
    () => filterBillingAttentionForRole(signals, role),
    [signals, role],
  );
  const topSeverity = useMemo(() => highestBillingSeverityForRole(signals, role), [signals, role]);

  // ── Sub-tab bar ───────────────────────────────────────────────────────────
  const subTabs = useMemo(() => {
    if (variant === 'agency') {
      return [
        { key: 'outgoing' as AgencySubTab, label: hub.subTabOutgoing },
        { key: 'incoming' as AgencySubTab, label: hub.subTabIncoming },
        { key: 'settlements' as AgencySubTab, label: hub.subTabSettlements },
        { key: 'presets' as AgencySubTab, label: hub.subTabPresets },
        { key: 'profiles' as AgencySubTab, label: hub.subTabProfiles },
        { key: 'defaults' as AgencySubTab, label: hub.subTabDefaults },
        { key: 'manual' as AgencySubTab, label: hub.subTabManualInvoices },
      ];
    }
    return [
      { key: 'received' as ClientSubTab, label: hub.subTabReceived },
      { key: 'profiles' as ClientSubTab, label: hub.subTabProfiles },
      { key: 'defaults' as ClientSubTab, label: hub.subTabDefaults },
    ];
  }, [variant, hub]);

  const activeKey = variant === 'agency' ? agencyTab : clientTab;
  const setActiveKey = (k: AgencySubTab | ClientSubTab) => {
    const previous = activeKey;
    if (variant === 'agency') setAgencyTab(k as AgencySubTab);
    else setClientTab(k as ClientSubTab);
    // Smart-Attention-Refresh on sub-tab change: wenn der User in einem Panel
    // eine Aktion ausgeführt hat (Send Invoice, Mark Paid, neues Settlement,
    // neuer Billing-Profile), muss der Hub-Banner beim nächsten Tab-Wechsel
    // aktuelle Signale zeigen — sonst bleibt er bis zum Re-Mount stale.
    // Lightweight: 4 parallele Reads (Issued/Received/Settlements/Profiles)
    // — gleicher Pfad wie der Initial-Load. Skip wenn derselbe Tab geklickt wurde.
    if (k !== previous) {
      void loadAttention();
    }
  };

  // ── Body render ───────────────────────────────────────────────────────────
  // Phase D (2026-04-19): InvoicesPanel wird mit explizitem mode='outgoing'|'incoming'
  // gemountet, damit Outgoing/Incoming/Received jeweils eigenen State haben (kein
  // gemeinsamer Tab-Strip mehr) und der Empty/Header-Kontext sofort klar ist.
  function renderAgencyBody(): React.ReactElement | null {
    switch (agencyTab) {
      case 'outgoing':
        return <InvoicesPanel organizationId={organizationId} mode="outgoing" />;
      case 'incoming':
        return <InvoicesPanel organizationId={organizationId} mode="incoming" />;
      case 'settlements':
        return <AgencyModelSettlementsPanel organizationId={organizationId} />;
      case 'presets':
        return <BillingPresetsPanel organizationId={organizationId} />;
      case 'profiles':
        return <OrganizationBillingProfilesPanel organizationId={organizationId} />;
      case 'defaults':
        return <OrganizationBillingDefaultsPanel organizationId={organizationId} />;
      case 'manual':
        return <ManualBillingHubPanel agencyOrganizationId={organizationId} />;
    }
  }

  function renderClientBody(): React.ReactElement | null {
    switch (clientTab) {
      case 'received':
        return <InvoicesPanel organizationId={organizationId} mode="incoming" />;
      case 'profiles':
        return <OrganizationBillingProfilesPanel organizationId={organizationId} />;
      case 'defaults':
        return <OrganizationBillingDefaultsPanel organizationId={organizationId} />;
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: spacing.xl }}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>{hub.headerTitle}</Text>
        <Text style={s.subtitle}>
          {variant === 'agency' ? hub.headerSubtitleAgency : hub.headerSubtitleClient}
        </Text>
      </View>

      {/* Read-only banner: nur wenn Caller nicht mal Member ist. Members (Booker/Employee)
          können operationale Aktionen ausführen; Owner-only-Bereiche (Profiles, Defaults)
          haben eigene Hinweise in den jeweiligen Panels. */}
      {!isMember && (
        <View style={s.readOnlyBanner}>
          <Text style={s.readOnlyText}>{hub.readOnlyBanner}</Text>
        </View>
      )}

      {/* Smart Attention banner */}
      {visibleSignals.length > 0 && topSeverity && (
        <View style={[s.attentionBanner, { borderLeftColor: SEVERITY_COLOR[topSeverity] }]}>
          <Text style={[s.attentionTitle, { color: SEVERITY_COLOR[topSeverity] }]}>
            {hub.attentionBannerTitle}
          </Text>
          {visibleSignals.slice(0, 5).map((sig) => (
            <Text key={`${sig.category}:${sig.sourceId}`} style={s.attentionRow}>
              • {labelForCategory(sig.category)}
              {sig.displayNumber ? ` — ${sig.displayNumber}` : ''}
            </Text>
          ))}
          {visibleSignals.length > 5 && (
            <Text style={s.attentionMore}>+{visibleSignals.length - 5} more</Text>
          )}
        </View>
      )}
      {attentionLoading && visibleSignals.length === 0 && (
        <View style={{ paddingVertical: spacing.sm, alignItems: 'flex-start' }}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      )}

      {/* Sub-tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.subTabBar}
      >
        {subTabs.map((t) => {
          const active = t.key === activeKey;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setActiveKey(t.key)}
              style={[s.subTabPill, active && s.subTabPillActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.subTabLabel, active && s.subTabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Body */}
      <View style={s.body}>{variant === 'agency' ? renderAgencyBody() : renderClientBody()}</View>
    </ScrollView>
  );
};

function labelForCategory(category: string): string {
  const hub = uiCopy.billingHub;
  switch (category) {
    case 'invoice_overdue':
      return hub.attentionCategoryInvoiceOverdue;
    case 'invoice_unpaid':
      return hub.attentionCategoryInvoiceUnpaid;
    case 'invoice_draft_pending':
      return hub.attentionCategoryInvoiceDraftPending;
    case 'invoice_pending_send':
      return hub.attentionCategoryInvoicePendingSend;
    case 'invoice_payment_failed':
      return hub.attentionCategoryInvoicePaymentFailed;
    case 'invoice_missing_recipient_data':
      return hub.attentionCategoryInvoiceMissingRecipientData;
    case 'invoice_received_unpaid':
      return hub.attentionCategoryInvoiceReceivedUnpaid;
    case 'invoice_received_overdue':
      return hub.attentionCategoryInvoiceReceivedOverdue;
    case 'settlement_draft_pending':
      return hub.attentionCategorySettlementDraftPending;
    case 'settlement_recorded_unpaid':
      return hub.attentionCategorySettlementRecordedUnpaid;
    case 'billing_profile_missing':
      return hub.attentionCategoryBillingProfileMissing;
    default:
      return category;
  }
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  readOnlyBanner: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readOnlyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  attentionBanner: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    padding: spacing.sm,
    borderLeftWidth: 4,
    backgroundColor: colors.surface,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  attentionTitle: {
    ...typography.body,
    fontWeight: '700' as const,
    marginBottom: spacing.xs,
  },
  attentionRow: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: 2,
  },
  attentionMore: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  subTabBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  subTabPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.xs,
  },
  subTabPillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  subTabLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  subTabLabelActive: {
    color: colors.background,
    fontWeight: '600' as const,
  },
  body: {
    // Phase D (2026-04-19): Side-Padding entfernt — die Karten der Child-Panels
    // (InvoicesPanel, AgencyModelSettlementsPanel, BillingPresetsPanel,
    // OrganizationBillingProfilesPanel, OrganizationBillingDefaultsPanel,
    // BillingDetailsForm) bringen alle eigenes marginHorizontal: spacing.md mit.
    // Doppeltes Padding (Body 16px + Card 16px = 32px Side-Margin) entfernt.
    paddingTop: spacing.sm,
  },
});

export default BillingHubView;
