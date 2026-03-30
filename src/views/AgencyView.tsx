import React from 'react';
import { AgencyControllerView } from './AgencyControllerView';

type AgencyViewProps = {
  onBackToRoleSelection: () => void;
};

/** Same agency shell on web and native (bottom tabs + global layout). */
export const AgencyView: React.FC<AgencyViewProps> = ({ onBackToRoleSelection }) => (
  <AgencyControllerView onBackToRoleSelection={onBackToRoleSelection} />
);

