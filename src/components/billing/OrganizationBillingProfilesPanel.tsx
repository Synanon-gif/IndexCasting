/**
 * OrganizationBillingProfilesPanel
 *
 * Owner-only panel for canonical billing identities (legal name, addresses,
 * VAT/tax IDs, IBAN). Lives under the Billing Hub `Profiles` sub-tab.
 *
 * Implementation note (extraction parity, 2026-04-19):
 * The existing `BillingDetailsForm` is the proven, production form that already
 * persists profiles via `billingProfilesSupabase`. To stay minimal-invasive
 * (no regression to RLS, snapshot freeze, or owner-only writes), this panel
 * wraps `BillingDetailsForm` directly. Future work may split it into a
 * profiles-only sub-form once the new Hub UX is validated end-to-end.
 *
 * Owner-only writes are enforced inside `BillingDetailsForm` via
 * `isOrganizationOwner(profile?.org_member_role)`; non-owners see read-only
 * state. RLS additionally enforces this server-side.
 */
import React from 'react';
import { BillingDetailsForm } from '../BillingDetailsForm';

type Props = {
  organizationId: string | null;
};

export const OrganizationBillingProfilesPanel: React.FC<Props> = ({ organizationId }) => {
  return <BillingDetailsForm organizationId={organizationId} />;
};

export default OrganizationBillingProfilesPanel;
