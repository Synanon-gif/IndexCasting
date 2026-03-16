import React from 'react';
import { Platform } from 'react-native';
import { AgencyDashboardScreen } from '../screens/AgencyDashboardScreen';
import { AgencyControllerView } from './AgencyControllerView';

type AgencyViewProps = {
  onBackToRoleSelection: () => void;
};

export const AgencyView: React.FC<AgencyViewProps> = ({ onBackToRoleSelection }) => {
  return Platform.OS === 'web' ? (
    <AgencyControllerView onBackToRoleSelection={onBackToRoleSelection} />
  ) : (
    <AgencyDashboardScreen onBackToRoleSelection={onBackToRoleSelection} />
  );
};

