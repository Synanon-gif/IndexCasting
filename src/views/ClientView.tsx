import React from 'react';
import { ClientWebApp } from '../web/ClientWebApp';
export type ClientType = 'fashion' | 'commercial';

type ClientViewProps = {
  clientType: ClientType;
  onClientTypeChange: (t: ClientType) => void;
  onBackToRoleSelection: () => void;
  initialPackageId?: string | null;
  onInitialPackageConsumed?: () => void;
};

export const ClientView: React.FC<ClientViewProps> = ({
  clientType,
  onClientTypeChange,
  onBackToRoleSelection,
  initialPackageId,
  onInitialPackageConsumed,
}) => {
  return (
    <ClientWebApp
      clientType={clientType}
      onClientTypeChange={onClientTypeChange}
      onBackToRoleSelection={onBackToRoleSelection}
      initialPackageId={initialPackageId}
      onInitialPackageConsumed={onInitialPackageConsumed}
    />
  );
};
