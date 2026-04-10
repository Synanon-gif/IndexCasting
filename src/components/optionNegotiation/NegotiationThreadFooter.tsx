import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import type { OptionRequest, ChatStatus } from '../../store/optionRequests';
import type { ClientAssignmentFlag, AssignmentFlagColor } from '../../services/clientAssignmentsSupabase';

export type NegotiationThreadFooterProps = {
  request: OptionRequest;
  isAgency: boolean;
  status: ChatStatus | null;
  finalStatus: OptionRequest['finalStatus'];
  clientPriceStatus: OptionRequest['clientPriceStatus'];
  currency: string;
  agencyCounterPrice: number | undefined;
  negotiationCounterExpanded: boolean;
  setNegotiationCounterExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  agencyCounterInput: string;
  setAgencyCounterInput: (s: string) => void;
  /** When true, primary agency action buttons are dimmed/disabled (e.g. multi-tab processing). */
  actionBusy?: boolean;
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>;
  assignableMembers: Array<{ userId: string; name: string }>;
  onSaveClientAssignment?: (
    clientOrganizationId: string,
    patch: { label: string; color: AssignmentFlagColor; assignedMemberUserId?: string | null },
  ) => Promise<void>;
  editingAssignmentThreadId: string | null;
  setEditingAssignmentThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  openOrgChatBusy: boolean;
  openOrgChatFromRequest: () => void;
  onAgencyAcceptClientPrice: () => Promise<void>;
  onAgencyRejectClientPrice: () => Promise<void>;
  onAgencyCounterOffer: (amount: number) => Promise<void>;
  onAgencyProposeInitialFee: (amount: number) => Promise<void>;
  onRejectNegotiation: () => void;
  onClientAcceptCounter: () => Promise<void>;
  /** Decline agency counter-offer (closes request) — optional; omit on agency-only surfaces. */
  onClientRejectCounter?: () => Promise<void>;
  onClientConfirmJob: () => Promise<void>;
  /**
   * Agency native fullscreen: show proposed price line under org row + model-approval strip when the model is linked.
   * Client web keeps this off (prices/chips live in the header; linked-model strip was not shown there historically).
   */
  showAgencyExtras?: boolean;
  /** Client web: full assignment editor; agency app: one-line read-only when a flag exists. */
  assignmentMode?: 'manage' | 'readonly';
  /** First pill label next to “Open org chat” (agency thread copy vs. generic negotiation). */
  contextThreadLabel?: string;
  /** When true, org-chat button also requires `request.agencyId` (client web). Agency app passes false. */
  requireAgencyIdForOrgChat?: boolean;
  /**
   * When the summary card / chips already show price + status + model hints, hide repeated banners in the footer.
   */
  suppressDuplicateMeta?: boolean;
};

/**
 * Consolidated negotiation footer: assignment, org chat, model/final banners, agency/client CTAs + inline counter.
 * Same behavior as previous inline blocks in ClientWebApp / AgencyControllerView — presentation only.
 */
export const NegotiationThreadFooter: React.FC<NegotiationThreadFooterProps> = ({
  request,
  isAgency,
  status,
  finalStatus,
  clientPriceStatus,
  currency,
  agencyCounterPrice,
  negotiationCounterExpanded,
  setNegotiationCounterExpanded,
  agencyCounterInput,
  setAgencyCounterInput,
  actionBusy = false,
  assignmentByClientOrgId,
  assignableMembers,
  onSaveClientAssignment,
  editingAssignmentThreadId,
  setEditingAssignmentThreadId,
  openOrgChatBusy,
  openOrgChatFromRequest,
  onAgencyAcceptClientPrice,
  onAgencyRejectClientPrice,
  onAgencyCounterOffer,
  onAgencyProposeInitialFee,
  onRejectNegotiation,
  onClientAcceptCounter,
  onClientRejectCounter,
  onClientConfirmJob,
  showAgencyExtras = false,
  assignmentMode = 'manage',
  contextThreadLabel = uiCopy.optionNegotiationChat.negotiationContext,
  requireAgencyIdForOrgChat = true,
  suppressDuplicateMeta = false,
}) => {
  const busy = actionBusy;
  /** No model app: agency negotiates with client without in-app model approval (see store / RPC). */
  const agencyMayActOnFee = request.modelAccountLinked === false || request.modelApproval === 'approved';

  return (
    <>
      {assignmentMode === 'readonly' && request.clientOrganizationId && assignmentByClientOrgId[request.clientOrganizationId] ? (
        <Text style={[styles.metaText, { marginBottom: spacing.xs }]}>
          Client assignment: {assignmentByClientOrgId[request.clientOrganizationId].label}
          {assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName
            ? ` · ${assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName}`
            : ''}
        </Text>
      ) : null}
      {assignmentMode === 'manage' && request.clientOrganizationId && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {assignmentByClientOrgId[request.clientOrganizationId] ? (
            <Text style={styles.metaText}>
              Client flag: {assignmentByClientOrgId[request.clientOrganizationId].label}
              {assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName
                ? ` · ${assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName}`
                : ''}
            </Text>
          ) : (
            <Text style={styles.metaText}>Client flag: none</Text>
          )}
          {isAgency && onSaveClientAssignment && (
            <TouchableOpacity
              style={styles.filterPill}
              onPress={() =>
                setEditingAssignmentThreadId((prev) => (prev === request.threadId ? null : request.threadId))
              }
            >
              <Text style={styles.filterPillLabel}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {assignmentMode === 'manage' && isAgency && onSaveClientAssignment && request.clientOrganizationId && editingAssignmentThreadId === request.threadId && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {(['gray', 'blue', 'green', 'amber', 'purple', 'red'] as AssignmentFlagColor[]).map((color) => (
            <TouchableOpacity
              key={color}
              style={styles.filterPill}
              onPress={() => {
                void onSaveClientAssignment(request.clientOrganizationId!, {
                  label: color.toUpperCase(),
                  color,
                  assignedMemberUserId:
                    assignmentByClientOrgId[request.clientOrganizationId!]?.assignedMemberUserId ?? null,
                });
                setEditingAssignmentThreadId(null);
              }}
            >
              <Text style={styles.filterPillLabel}>{color}</Text>
            </TouchableOpacity>
          ))}
          {assignableMembers.slice(0, 6).map((member) => (
            <TouchableOpacity
              key={member.userId}
              style={styles.filterPill}
              onPress={() => {
                const current = assignmentByClientOrgId[request.clientOrganizationId!];
                void onSaveClientAssignment!(request.clientOrganizationId!, {
                  label: current?.label ?? 'BLUE',
                  color: current?.color ?? 'blue',
                  assignedMemberUserId: member.userId,
                });
                setEditingAssignmentThreadId(null);
              }}
            >
              <Text style={styles.filterPillLabel}>{member.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        <View style={[styles.statusPill, { backgroundColor: '#e0e7ff' }]}>
          <Text style={[styles.statusPillLabel, { color: '#3730a3' }]}>{contextThreadLabel}</Text>
        </View>
        <TouchableOpacity
          style={[styles.filterPill, openOrgChatBusy && { opacity: 0.6 }]}
          disabled={
            openOrgChatBusy ||
            (requireAgencyIdForOrgChat && !request.agencyId) ||
            !request.clientOrganizationId
          }
          onPress={() => {
            void openOrgChatFromRequest();
          }}
        >
          <Text style={styles.filterPillLabel}>
            {openOrgChatBusy ? uiCopy.common.loading : uiCopy.b2bChat.openOrgChat}
          </Text>
        </TouchableOpacity>
      </View>
      {isAgency &&
        request.modelAccountLinked !== false &&
        request.modelApproval === 'pending' &&
        finalStatus !== 'job_confirmed' &&
        status !== 'rejected' && (
          <Text
            style={{
              ...typography.label,
              fontSize: 11,
              color: colors.textSecondary,
              marginBottom: spacing.sm,
            }}
          >
            {uiCopy.optionNegotiationChat.modelMustPreApproveBeforeAgencyActs}
          </Text>
        )}
      {!suppressDuplicateMeta && showAgencyExtras && request.proposedPrice != null && (
        <Text style={{ ...typography.label, fontSize: 10, color: colors.accentBrown, marginBottom: spacing.xs }}>
          {uiCopy.optionNegotiationChat.proposedPriceLabel}:{' '}
          {currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€'}
          {request.proposedPrice}
        </Text>
      )}
      {!suppressDuplicateMeta && request.modelAccountLinked === false ? (
        <View style={styles.noModelBanner}>
          <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
            {uiCopy.dashboard.optionRequestFinalStatusNoModelAppHint}
          </Text>
        </View>
      ) : !suppressDuplicateMeta && showAgencyExtras ? (
        <View
          style={[
            styles.approvalBanner,
            request.modelApproval === 'approved' && styles.approvalBannerApproved,
            request.modelApproval === 'rejected' && styles.approvalBannerRejected,
            request.modelApproval === 'pending' && styles.approvalBannerPending,
          ]}
        >
          <Text
            style={[
              styles.approvalBannerText,
              request.modelApproval === 'approved' && styles.approvalBannerTextApproved,
              request.modelApproval === 'rejected' && styles.approvalBannerTextRejected,
              request.modelApproval === 'pending' && styles.approvalBannerTextPending,
            ]}
          >
            {request.modelApproval === 'approved'
              ? uiCopy.dashboard.optionRequestModelApprovalApproved
              : request.modelApproval === 'rejected'
                ? uiCopy.dashboard.optionRequestModelApprovalRejected
                : uiCopy.dashboard.optionRequestModelApprovalPending}
          </Text>
        </View>
      ) : null}
      {!suppressDuplicateMeta && finalStatus ? (
        <View
          style={[
            styles.finalBanner,
            finalStatus === 'job_confirmed'
              ? { backgroundColor: 'rgba(0,120,0,0.15)' }
              : finalStatus === 'option_confirmed'
                ? { backgroundColor: 'rgba(0,80,200,0.12)' }
                : { backgroundColor: 'rgba(120,120,0,0.12)' },
          ]}
        >
          <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
            {request.requestType === 'casting' ? uiCopy.dashboard.threadContextCasting : uiCopy.dashboard.threadContextOption} -{' '}
            {finalStatus === 'job_confirmed'
              ? uiCopy.dashboard.optionRequestStatusJobConfirmed
              : finalStatus === 'option_confirmed'
                ? uiCopy.dashboard.optionRequestStatusConfirmed
                : uiCopy.dashboard.optionRequestStatusPending}
          </Text>
        </View>
      ) : null}
      {isAgency &&
        agencyMayActOnFee &&
        finalStatus !== 'job_confirmed' &&
        status !== 'rejected' &&
        (clientPriceStatus === 'pending' || clientPriceStatus === 'rejected') && (
        <Text
          style={{
            ...typography.body,
            fontSize: 12,
            lineHeight: 17,
            color: colors.textSecondary,
            marginBottom: spacing.sm,
          }}
        >
          {uiCopy.optionNegotiationChat.agencyNegotiationFeeStepIntro}
        </Text>
      )}
      {isAgency && agencyMayActOnFee && finalStatus !== 'job_confirmed' && status !== 'rejected' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
          {request.proposedPrice != null &&
          clientPriceStatus === 'pending' &&
          agencyCounterPrice == null ? (
            <TouchableOpacity
              style={[styles.filterPill, { backgroundColor: colors.buttonOptionGreen }, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={() => {
                void onAgencyAcceptClientPrice();
              }}
            >
              <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.confirmOption}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.filterPill, { backgroundColor: colors.buttonOptionGreen, borderWidth: 0 }]}
            onPress={() => setNegotiationCounterExpanded((e) => !e)}
          >
            <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.counterOffer}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }]}
            onPress={onRejectNegotiation}
          >
            <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>{uiCopy.optionNegotiationChat.rejectOption}</Text>
          </TouchableOpacity>
        </View>
      )}
      {isAgency &&
        negotiationCounterExpanded &&
        agencyMayActOnFee &&
        clientPriceStatus === 'pending' &&
        request.proposedPrice != null &&
        finalStatus !== 'job_confirmed' && (
          <View style={styles.counterBox}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary, marginBottom: spacing.xs }}>
              {uiCopy.optionNegotiationChat.counterOfferPendingHint}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <TextInput
                value={agencyCounterInput}
                onChangeText={setAgencyCounterInput}
                placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.chatInput, { flex: 1, minWidth: 120 }]}
              />
              <TouchableOpacity
                style={[styles.filterPill, { paddingHorizontal: spacing.sm, backgroundColor: colors.textPrimary }, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={() => {
                  const num = parseFloat(agencyCounterInput.trim());
                  if (isNaN(num)) return;
                  void onAgencyCounterOffer(num);
                }}
              >
                <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.sendCounter}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filterPill}
                onPress={() => {
                  setAgencyCounterInput('');
                  setNegotiationCounterExpanded(false);
                }}
              >
                <Text style={styles.filterPillLabel}>{uiCopy.common.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      {isAgency && agencyMayActOnFee && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && request.proposedPrice != null && (
        <TouchableOpacity
          style={{ alignSelf: 'flex-start', marginBottom: spacing.sm }}
          disabled={busy}
          onPress={() => {
            void onAgencyRejectClientPrice();
          }}
        >
          <Text style={{ ...typography.label, fontSize: 12, color: colors.buttonSkipRed, fontWeight: '600' }}>
            {uiCopy.optionNegotiationChat.declineProposedFee}
          </Text>
        </TouchableOpacity>
      )}
      {isAgency &&
        negotiationCounterExpanded &&
        agencyMayActOnFee &&
        clientPriceStatus === 'rejected' &&
        finalStatus !== 'job_confirmed' && (
          <View style={styles.counterBox}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary, marginBottom: spacing.xs }}>
              {uiCopy.optionNegotiationChat.agencyNegotiationAfterClientDecline}
            </Text>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: spacing.xs }}>
              {uiCopy.optionNegotiationChat.clientPriceDeclinedCounterHint}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <TextInput
                value={agencyCounterInput}
                onChangeText={setAgencyCounterInput}
                placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.chatInput, { flex: 1, minWidth: 120 }]}
              />
              <TouchableOpacity
                style={[styles.filterPill, { paddingHorizontal: spacing.sm, backgroundColor: colors.textPrimary }, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={() => {
                  const num = parseFloat(agencyCounterInput.trim());
                  if (isNaN(num)) return;
                  void onAgencyCounterOffer(num);
                }}
              >
                <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.sendCounter}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      {isAgency &&
        negotiationCounterExpanded &&
        agencyMayActOnFee &&
        clientPriceStatus === 'pending' &&
        finalStatus !== 'job_confirmed' &&
        request.proposedPrice == null && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>{uiCopy.optionNegotiationChat.proposeFeeHint}</Text>
            <TextInput
              value={agencyCounterInput}
              onChangeText={setAgencyCounterInput}
              placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              style={[styles.chatInput, { width: 100 }]}
            />
            <TouchableOpacity
              style={[styles.filterPill, { paddingHorizontal: spacing.sm }, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={() => {
                const num = parseFloat(agencyCounterInput.trim());
                if (isNaN(num)) return;
                void onAgencyProposeInitialFee(num);
              }}
            >
              <Text style={styles.filterPillLabel}>{uiCopy.optionNegotiationChat.sendOffer}</Text>
            </TouchableOpacity>
          </View>
        )}
      {!isAgency && agencyCounterPrice != null && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && (
        <View style={{ marginBottom: spacing.sm, gap: spacing.xs }}>
          <TouchableOpacity
            style={[styles.filterPill, { backgroundColor: colors.buttonOptionGreen }]}
            onPress={() => {
              void onClientAcceptCounter();
            }}
          >
            <Text style={[styles.filterPillLabel, { color: '#fff' }]}>
              Accept agency proposal ({currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€'}
              {agencyCounterPrice})
            </Text>
          </TouchableOpacity>
          {onClientRejectCounter ? (
            <TouchableOpacity
              style={[styles.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }]}
              onPress={() => {
                void onClientRejectCounter();
              }}
            >
              <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>
                {uiCopy.optionNegotiationChat.rejectCounterOffer}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      {!isAgency &&
        finalStatus === 'option_confirmed' &&
        request?.requestType === 'option' &&
        status !== 'rejected' && (
        <TouchableOpacity
          style={[styles.filterPill, { marginBottom: spacing.sm, backgroundColor: colors.accentBrown }]}
          onPress={() => {
            void onClientConfirmJob();
          }}
        >
          <Text style={[styles.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.confirmJob}</Text>
        </TouchableOpacity>
      )}
      {(finalStatus === 'job_confirmed' || status === 'rejected') && (
        <Text
          style={{
            ...typography.label,
            fontSize: 11,
            color: colors.textSecondary,
            marginBottom: spacing.sm,
          }}
        >
          {finalStatus === 'job_confirmed'
            ? uiCopy.optionNegotiationChat.negotiationFeeClosedJobConfirmed
            : uiCopy.optionNegotiationChat.negotiationFeeClosedRejected}
        </Text>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  filterPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterPillLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  chatInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  noModelBanner: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(100,100,100,0.12)',
    borderRadius: 8,
  },
  finalBanner: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 8,
  },
  counterBox: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: 'rgba(180,100,0,0.08)',
    borderRadius: 8,
  },
  approvalBanner: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  approvalBannerApproved: { borderColor: colors.buttonOptionGreen, backgroundColor: 'rgba(76,175,80,0.08)' },
  approvalBannerRejected: { borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.08)' },
  approvalBannerPending: { borderColor: '#B8860B', backgroundColor: 'rgba(184,134,11,0.08)' },
  approvalBannerText: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  approvalBannerTextApproved: { color: colors.buttonOptionGreen },
  approvalBannerTextRejected: { color: '#e74c3c' },
  approvalBannerTextPending: { color: '#B8860B' },
});

/** Plan name: structured negotiation footer + inline counter — alias of NegotiationThreadFooter. */
export const NegotiationActionBar = NegotiationThreadFooter;
