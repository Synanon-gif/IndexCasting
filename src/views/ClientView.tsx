import React from 'react';
import { ClientWebApp } from '../web/ClientWebApp';
export type ClientType = 'fashion' | 'commercial';

type ClientViewProps = {
  clientType: ClientType;
  onClientTypeChange: (t: ClientType) => void;
  onBackToRoleSelection: () => void;
};

export const ClientView: React.FC<ClientViewProps> = ({
  clientType,
  onClientTypeChange,
  onBackToRoleSelection,
}) => {
  return (
    <ClientWebApp
      clientType={clientType}
      onClientTypeChange={onClientTypeChange}
      onBackToRoleSelection={onBackToRoleSelection}
    />
  );
};

