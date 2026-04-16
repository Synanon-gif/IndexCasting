jest.mock('../../store/optionRequests', () => ({
  resetOptionRequestsStore: jest.fn(),
}));
jest.mock('../../store/applicationsStore', () => ({
  resetApplicationsStore: jest.fn(),
}));
jest.mock('../../store/recruitingChats', () => ({
  resetRecruitingChatsStore: jest.fn(),
}));

import { resetOptionRequestsStore } from '../../store/optionRequests';
import { resetApplicationsStore } from '../../store/applicationsStore';
import { resetRecruitingChatsStore } from '../../store/recruitingChats';
import { clearAgencyWorkspaceCachesAfterDissolve } from '../clearAgencyWorkspaceCachesAfterDissolve';

describe('clearAgencyWorkspaceCachesAfterDissolve', () => {
  it('resets option, applications, and recruiting stores', () => {
    clearAgencyWorkspaceCachesAfterDissolve();
    expect(resetOptionRequestsStore).toHaveBeenCalledTimes(1);
    expect(resetApplicationsStore).toHaveBeenCalledTimes(1);
    expect(resetRecruitingChatsStore).toHaveBeenCalledTimes(1);
  });
});
