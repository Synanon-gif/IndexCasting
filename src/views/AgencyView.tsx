import React from 'react';
import { AgencyControllerView } from './AgencyControllerView';

type AgencyViewProps = {
  onBackToRoleSelection: () => void;
  /** Pending Agency-to-Agency Roster Share link ID, restored after sign-up. */
  initialAgencyShareLinkId?: string | null;
  /** Called once the inbox UI has consumed the pending link. */
  onInitialAgencyShareConsumed?: () => void;
};

/** Same agency shell on web and native (bottom tabs + global layout). */
export const AgencyView: React.FC<AgencyViewProps> = ({
  onBackToRoleSelection,
  initialAgencyShareLinkId,
  onInitialAgencyShareConsumed,
}) => (
  <AgencyControllerView
    onBackToRoleSelection={onBackToRoleSelection}
    initialAgencyShareLinkId={initialAgencyShareLinkId ?? null}
    onInitialAgencyShareConsumed={onInitialAgencyShareConsumed}
  />
);
