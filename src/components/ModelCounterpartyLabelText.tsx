/**
 * ModelCounterpartyLabelText
 *
 * Renders the model-facing counterparty label ("Client Org · via Agency Org",
 * or just an agency org for agency-only events) as a single <Text> with
 * tappable org-name segments that open the public organization profile.
 *
 * This is the canonical Model-perspective replacement for raw
 * `<Text>{primaryCounterpartyLabelForModel(req)}</Text>` blocks in detail
 * views (option thread header, calendar event detail). List rows that are
 * already wrapped in a TouchableOpacity should NOT make the segments tappable
 * (to avoid nested touch handlers); the user can tap the row to open the
 * thread, then tap the org name in the header.
 *
 * Wires up to the existing `OrgProfileModal` infrastructure (no new public
 * profile screens — just consistent linking).
 */

import React from 'react';
import { Text, type TextProps, type TextStyle, type StyleProp } from 'react-native';
import { colors } from '../theme/theme';
import type { OptionRequest } from '../store/optionRequests';
import { uiCopy } from '../constants/uiCopy';

export type CounterpartyOrgTap = {
  orgType: 'agency' | 'client';
  organizationId: string;
  agencyId: string | null;
  orgName: string;
};

type Props = {
  req: Pick<
    OptionRequest,
    | 'isAgencyOnly'
    | 'clientOrganizationId'
    | 'clientOrganizationName'
    | 'clientName'
    | 'agencyOrganizationId'
    | 'agencyOrganizationName'
    | 'agencyId'
  >;
  /** Called when a tappable org segment is pressed. */
  onOrgPress?: (tap: CounterpartyOrgTap) => void;
  textStyle?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: TextProps['numberOfLines'];
};

const VIA_SEPARATOR = ' · via ';

function trimOrUndef(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

export function ModelCounterpartyLabelText({
  req,
  onOrgPress,
  textStyle,
  linkStyle,
  numberOfLines,
}: Props) {
  const clientOrgName = trimOrUndef(req.clientOrganizationName);
  const agencyOrgName = trimOrUndef(req.agencyOrganizationName);
  const legacyClientName = trimOrUndef(req.clientName);
  const clientLabel = clientOrgName || legacyClientName;

  const defaultLinkStyle: StyleProp<TextStyle> = {
    color: colors.accent ?? colors.textPrimary,
    textDecorationLine: 'underline',
  };
  const linkSx: StyleProp<TextStyle> = [defaultLinkStyle, linkStyle];

  const canTapClient = Boolean(
    onOrgPress && clientOrgName && req.clientOrganizationId && !req.isAgencyOnly,
  );
  const canTapAgency = Boolean(onOrgPress && agencyOrgName && req.agencyOrganizationId);

  const handleClient = canTapClient
    ? () =>
        onOrgPress!({
          orgType: 'client',
          organizationId: req.clientOrganizationId!,
          agencyId: null,
          orgName: clientOrgName!,
        })
    : undefined;

  const handleAgency = canTapAgency
    ? () =>
        onOrgPress!({
          orgType: 'agency',
          organizationId: req.agencyOrganizationId!,
          agencyId: req.agencyId ?? null,
          orgName: agencyOrgName!,
        })
    : undefined;

  // Agency-only flow: only the agency name is shown.
  if (req.isAgencyOnly) {
    const label = agencyOrgName || clientOrgName || legacyClientName || uiCopy.common.unknownAgency;
    return (
      <Text style={textStyle} numberOfLines={numberOfLines}>
        {handleAgency && agencyOrgName ? (
          <Text style={linkSx} onPress={handleAgency} accessibilityRole="link">
            {label}
          </Text>
        ) : (
          label
        )}
      </Text>
    );
  }

  // Client-driven: "Client Org · via Agency Org" when both are known and differ.
  if (clientLabel && agencyOrgName && clientLabel !== agencyOrgName) {
    return (
      <Text style={textStyle} numberOfLines={numberOfLines}>
        {handleClient ? (
          <Text style={linkSx} onPress={handleClient} accessibilityRole="link">
            {clientLabel}
          </Text>
        ) : (
          clientLabel
        )}
        {VIA_SEPARATOR}
        {handleAgency ? (
          <Text style={linkSx} onPress={handleAgency} accessibilityRole="link">
            {agencyOrgName}
          </Text>
        ) : (
          agencyOrgName
        )}
      </Text>
    );
  }

  // Fallback: single name (or generic placeholder if nothing is known).
  const single = clientLabel || agencyOrgName || uiCopy.common.unknownClient;
  const tapHandler = clientLabel && handleClient ? handleClient : handleAgency;
  const tapEnabled = Boolean(tapHandler) && (Boolean(clientOrgName) || Boolean(agencyOrgName));
  return (
    <Text style={textStyle} numberOfLines={numberOfLines}>
      {tapEnabled && tapHandler ? (
        <Text style={linkSx} onPress={tapHandler} accessibilityRole="link">
          {single}
        </Text>
      ) : (
        single
      )}
    </Text>
  );
}
