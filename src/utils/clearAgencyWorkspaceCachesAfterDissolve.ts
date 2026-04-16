import { resetOptionRequestsStore } from '../store/optionRequests';
import { resetApplicationsStore } from '../store/applicationsStore';
import { resetRecruitingChatsStore } from '../store/recruitingChats';

/** Call after successful dissolve_organization for the agency workspace (owner). */
export function clearAgencyWorkspaceCachesAfterDissolve(): void {
  resetOptionRequestsStore();
  resetApplicationsStore();
  resetRecruitingChatsStore();
}
