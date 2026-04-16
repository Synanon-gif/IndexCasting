import { resetOptionRequestsStore } from '../store/optionRequests';
import { resetApplicationsStore } from '../store/applicationsStore';
import { resetRecruitingChatsStore } from '../store/recruitingChats';
import { resetNotificationsStore } from '../store/notificationsStore';

/**
 * Org-keyed B2B stores (agency or client workspace). Call after successful dissolve_organization
 * so lists/messages/options do not reference a removed org.
 */
export function resetB2bCachesAfterOrgDissolve(): void {
  resetOptionRequestsStore();
  resetApplicationsStore();
  resetRecruitingChatsStore();
  resetNotificationsStore();
}

/** Call after successful dissolve_organization for the agency workspace (owner). */
export function clearAgencyWorkspaceCachesAfterDissolve(): void {
  resetB2bCachesAfterOrgDissolve();
}
