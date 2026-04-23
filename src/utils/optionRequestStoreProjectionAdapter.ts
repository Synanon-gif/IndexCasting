/**
 * Maps the local `OptionRequest` (chat store) to `SupabaseOptionRequest` in-memory
 * for calendar color projection only — no network, not sent to the API.
 */
import type { OptionRequest } from '../store/optionRequests';
import type { SupabaseOptionRequest } from '../services/optionRequestsSupabase';

/**
 * In-memory only: satisfies `calendarGridColorForOptionItem` / `resolveProjectionBucket`.
 * Synthetic `client_id` is unused by projection color logic.
 */
export function toSupabaseOptionForCalendarProjectionFromStore(
  o: OptionRequest,
): SupabaseOptionRequest {
  return {
    id: o.id,
    client_id: 'store-projection',
    model_id: o.modelId,
    agency_id: o.agencyId ?? '',
    requested_date: o.date,
    status: o.status,
    project_id: o.projectId ?? null,
    client_name: o.clientName || null,
    model_name: o.modelName || null,
    job_description: o.jobDescription ?? null,
    proposed_price: o.proposedPrice ?? null,
    agency_counter_price: o.agencyCounterPrice ?? null,
    client_price_status: o.clientPriceStatus ?? null,
    final_status: o.finalStatus ?? null,
    request_type: o.requestType ?? 'option',
    currency: o.currency ?? null,
    start_time: o.startTime ?? null,
    end_time: o.endTime ?? null,
    model_approval: o.modelApproval,
    model_approved_at: o.modelApprovedAt ?? null,
    model_account_linked: o.modelAccountLinked,
    booker_id: null,
    organization_id: o.clientOrganizationId ?? null,
    agency_organization_id: o.agencyOrganizationId ?? null,
    client_organization_id: o.clientOrganizationId ?? null,
    client_organization_name: o.clientOrganizationName ?? null,
    agency_organization_name: o.agencyOrganizationName ?? null,
    created_by: null,
    agency_assignee_user_id: null,
    is_agency_only: o.isAgencyOnly,
    agency_event_group_id: o.agencyEventGroupId ?? null,
    created_at: new Date(o.createdAt).toISOString(),
    updated_at: new Date(o.createdAt).toISOString(),
  };
}
