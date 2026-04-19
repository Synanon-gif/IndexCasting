/**
 * OrganizationBillingDefaultsPanel
 *
 * Owner-only panel for invoice defaults (commission rate, tax rate, currency,
 * payment terms, invoice prefix, notes template, reverse charge flag).
 * Lives under the Billing Hub `Defaults` sub-tab.
 *
 * See OrganizationBillingProfilesPanel for the same minimal-invasive
 * extraction rationale: both panels currently mount `BillingDetailsForm` —
 * the proven production form that persists profiles AND defaults via
 * `billingProfilesSupabase`. Visual split happens in the BillingHubView
 * sub-tab routing; the underlying form is a single owner-gated unit.
 */
import React from 'react';
import { BillingDetailsForm } from '../BillingDetailsForm';

type Props = {
  organizationId: string | null;
};

export const OrganizationBillingDefaultsPanel: React.FC<Props> = ({ organizationId }) => {
  return <BillingDetailsForm organizationId={organizationId} />;
};

export default OrganizationBillingDefaultsPanel;
