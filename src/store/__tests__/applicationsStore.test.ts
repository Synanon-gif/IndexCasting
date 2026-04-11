/**
 * Unit-Tests für applicationsStore.ts
 * Testet: Zustandsübergänge, Pub/Sub-Benachrichtigungen, Fehlerbehandlung.
 * Services werden vollständig gemockt – kein Supabase-Netzwerkzugriff.
 */

jest.mock('../../services/applicationsSupabase', () => ({
  getApplications: jest.fn(),
  getApplicationsByStatus: jest.fn(),
  insertApplication: jest.fn(),
  updateApplicationStatus: jest.fn(),
  createModelFromApplication: jest.fn(),
  confirmApplicationByModel: jest.fn(),
  rejectApplicationByModel: jest.fn(),
}));

jest.mock('../recruitingChats', () => ({
  startRecruitingChat: jest.fn(),
  addRecruitingMessage: jest.fn(),
}));

jest.mock('../../services/recruitingChatSupabase', () => ({
  updateThreadAgency: jest.fn(),
  updateThreadChatType: jest.fn(),
}));

jest.mock('../../services/notificationsSupabase', () => ({
  createNotification: jest.fn(),
}));

jest.mock('../../constants/uiCopy', () => ({
  uiCopy: {
    notifications: {
      applicationAccepted: { title: 'test', message: 'test' },
      applicationRejected: { title: 'test', message: 'test' },
    },
  },
}));

import {
  getApplications,
  getPendingApplications,
  getPendingSwipeQueueApplications,
  getAcceptedApplications,
  getApplicationById,
  addApplication,
  acceptApplication,
  confirmApplicationByModel,
  rejectApplicationByModel,
  rejectApplication,
  refreshApplications,
  resetApplicationsStore,
  subscribeApplications,
} from '../applicationsStore';

import {
  getApplications as fetchApps,
  insertApplication as insertApp,
  updateApplicationStatus,
  confirmApplicationByModel as confirmByModelService,
  rejectApplicationByModel as rejectByModelService,
} from '../../services/applicationsSupabase';

import { startRecruitingChat, addRecruitingMessage } from '../recruitingChats';
import { updateThreadAgency, updateThreadChatType } from '../../services/recruitingChatSupabase';

const mockFetchApps = fetchApps as jest.Mock;
const mockInsertApp = insertApp as jest.Mock;
const mockUpdateStatus = updateApplicationStatus as jest.Mock;
const mockConfirmService = confirmByModelService as jest.Mock;
const mockRejectService = rejectByModelService as jest.Mock;
const mockStartChat = startRecruitingChat as jest.Mock;
const mockAddMessage = addRecruitingMessage as jest.Mock;
const mockUpdateThreadAgency = updateThreadAgency as jest.Mock;
const mockUpdateThreadChatType = updateThreadChatType as jest.Mock;

const BASE_APP = {
  id: 'app-1',
  agency_id: 'ag-1',
  applicant_user_id: 'user-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  age: 22,
  height: 175,
  gender: 'female' as const,
  hair_color: 'brown',
  city: 'Berlin',
  instagram_link: '',
  images: {},
  created_at: new Date(1_000_000).toISOString(),
  status: 'pending' as const,
  recruiting_thread_id: null,
  accepted_by_agency_id: null,
  country_code: 'DE',
  ethnicity: null,
  agencies: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetApplicationsStore();
  mockFetchApps.mockResolvedValue([]);
});

// ─── resetApplicationsStore ───────────────────────────────────────────────────

describe('resetApplicationsStore', () => {
  it('clears the cache so getApplications returns an empty array', async () => {
    mockFetchApps.mockResolvedValue([BASE_APP]);
    await refreshApplications();
    expect(getApplications()).toHaveLength(1);

    resetApplicationsStore();
    expect(getApplications()).toHaveLength(0);
  });

  it('notifies listeners after reset', () => {
    const listener = jest.fn();
    subscribeApplications(listener);
    resetApplicationsStore();
    resetApplicationsStore();
    expect(listener).toHaveBeenCalled();
  });
});

// ─── refreshApplications ─────────────────────────────────────────────────────

describe('refreshApplications', () => {
  it('fills cache from service and notifies listeners', async () => {
    mockFetchApps.mockResolvedValue([BASE_APP]);
    const listener = jest.fn();
    subscribeApplications(listener);

    await refreshApplications();

    expect(getApplications()).toHaveLength(1);
    expect(getApplications()[0].firstName).toBe('Ada');
    expect(listener).toHaveBeenCalled();
  });

  it('replaces previous cache on repeated refresh', async () => {
    mockFetchApps.mockResolvedValueOnce([BASE_APP]);
    await refreshApplications();
    expect(getApplications()).toHaveLength(1);

    mockFetchApps.mockResolvedValueOnce([]);
    await refreshApplications();
    expect(getApplications()).toHaveLength(0);
  });

  it('returns an empty cache when the service returns []', async () => {
    mockFetchApps.mockResolvedValue([]);
    await refreshApplications();
    expect(getApplications()).toHaveLength(0);
  });
});

// ─── getPendingApplications / getPendingSwipeQueueApplications ────────────────

describe('getPendingApplications', () => {
  it('returns only pending applications', async () => {
    const accepted = { ...BASE_APP, id: 'app-2', status: 'accepted' as const, recruiting_thread_id: 't-2' };
    mockFetchApps.mockResolvedValue([BASE_APP, accepted]);
    await refreshApplications();

    expect(getPendingApplications()).toHaveLength(1);
    expect(getPendingApplications()[0].id).toBe('app-1');
  });

  it('returns empty when no pending applications exist', async () => {
    const accepted = { ...BASE_APP, id: 'app-2', status: 'accepted' as const };
    mockFetchApps.mockResolvedValue([accepted]);
    await refreshApplications();
    expect(getPendingApplications()).toHaveLength(0);
  });
});

describe('getPendingSwipeQueueApplications', () => {
  it('excludes pending applications that already have a chatThreadId', async () => {
    const withThread = { ...BASE_APP, id: 'app-3', status: 'pending' as const, recruiting_thread_id: 'thread-x' };
    mockFetchApps.mockResolvedValue([BASE_APP, withThread]);
    await refreshApplications();

    const queue = getPendingSwipeQueueApplications();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('app-1');
  });
});

// ─── getAcceptedApplications ──────────────────────────────────────────────────

describe('getAcceptedApplications', () => {
  it('includes accepted and pending_model_confirmation applications that have a thread', async () => {
    const accepted = { ...BASE_APP, id: 'app-a', status: 'accepted' as const, recruiting_thread_id: 't-a' };
    const pendingConfirm = { ...BASE_APP, id: 'app-p', status: 'pending_model_confirmation' as const, recruiting_thread_id: 't-p' };
    const noThread = { ...BASE_APP, id: 'app-n', status: 'accepted' as const, recruiting_thread_id: null };
    mockFetchApps.mockResolvedValue([accepted, pendingConfirm, noThread]);
    await refreshApplications();

    const accepted_ = getAcceptedApplications();
    const ids = accepted_.map((a) => a.id);
    expect(ids).toContain('app-a');
    expect(ids).toContain('app-p');
    expect(ids).not.toContain('app-n');
  });
});

// ─── getApplicationById ───────────────────────────────────────────────────────

describe('getApplicationById', () => {
  it('returns the correct application by id', async () => {
    mockFetchApps.mockResolvedValue([BASE_APP]);
    await refreshApplications();
    expect(getApplicationById('app-1')?.firstName).toBe('Ada');
  });

  it('returns undefined for an unknown id', async () => {
    mockFetchApps.mockResolvedValue([BASE_APP]);
    await refreshApplications();
    expect(getApplicationById('unknown')).toBeUndefined();
  });
});

// ─── addApplication ───────────────────────────────────────────────────────────

describe('addApplication', () => {
  it('inserts and prepends the new application to the cache', async () => {
    mockFetchApps.mockResolvedValue([]);
    await refreshApplications();

    mockInsertApp.mockResolvedValue({ ...BASE_APP, id: 'app-new' });
    const result = await addApplication({
      applicantUserId: 'user-1',
      agencyId: 'ag-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      age: 22,
      height: 175,
      gender: 'female',
      hairColor: 'brown',
      city: 'Berlin',
      instagramLink: '',
      images: {},
    });

    expect(result?.id).toBe('app-new');
    expect(getApplications()[0].id).toBe('app-new');
  });

  it('returns null when the service fails', async () => {
    mockInsertApp.mockResolvedValue(null);
    const result = await addApplication({
      applicantUserId: 'user-1',
      agencyId: null,
      firstName: 'Ada',
      lastName: 'Lovelace',
      age: 22,
      height: 175,
      gender: 'female',
      hairColor: '',
      city: '',
      instagramLink: '',
      images: {},
    });
    expect(result).toBeNull();
  });
});

// ─── acceptApplication ────────────────────────────────────────────────────────

describe('acceptApplication', () => {
  beforeEach(async () => {
    mockFetchApps.mockResolvedValue([BASE_APP]);
    await refreshApplications();
  });

  it('transitions status to pending_model_confirmation and returns threadId', async () => {
    mockStartChat.mockResolvedValue('thread-1');
    mockAddMessage.mockReturnValue(undefined);
    mockUpdateStatus.mockResolvedValue(true);
    mockUpdateThreadAgency.mockResolvedValue(undefined);

    const result = await acceptApplication('app-1', 'ag-1');

    expect(result).not.toBeNull();
    expect(result?.threadId).toBe('thread-1');
    expect(result?.modelId).toBeNull();
    expect(getApplicationById('app-1')?.status).toBe('pending_model_confirmation');
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      'app-1',
      'pending_model_confirmation',
      expect.objectContaining({ recruiting_thread_id: 'thread-1', accepted_by_agency_id: 'ag-1' }),
    );
  });

  it('returns null when the application is not in pending state', async () => {
    const nonPending = { ...BASE_APP, id: 'app-np', status: 'accepted' as const, recruiting_thread_id: 't-1' };
    mockFetchApps.mockResolvedValue([nonPending]);
    await refreshApplications();
    const result = await acceptApplication('app-np', 'ag-1');
    expect(result).toBeNull();
  });

  it('returns null when startRecruitingChat fails', async () => {
    mockStartChat.mockResolvedValue(null);
    const result = await acceptApplication('app-1', 'ag-1');
    expect(result).toBeNull();
  });

  it('returns null when updateApplicationStatus fails', async () => {
    mockStartChat.mockResolvedValue('thread-1');
    mockUpdateStatus.mockResolvedValue(false);
    const result = await acceptApplication('app-1', 'ag-1');
    expect(result).toBeNull();
  });
});

// ─── confirmApplicationByModel ────────────────────────────────────────────────

describe('confirmApplicationByModel', () => {
  beforeEach(async () => {
    const pendingConfirm = { ...BASE_APP, status: 'pending_model_confirmation' as const, recruiting_thread_id: 't-1' };
    mockFetchApps.mockResolvedValue([pendingConfirm]);
    await refreshApplications();
  });

  it('transitions status to accepted and returns modelId', async () => {
    mockConfirmService.mockResolvedValue({ modelId: 'model-1' });
    mockUpdateThreadChatType.mockResolvedValue(undefined);

    const result = await confirmApplicationByModel('app-1', 'user-1');

    expect(result).not.toBeNull();
    expect(result?.modelId).toBe('model-1');
    expect(getApplicationById('app-1')?.status).toBe('accepted');
    expect(mockUpdateThreadChatType).toHaveBeenCalledWith('t-1', 'active_model');
  });

  it('returns null when application is not in pending_model_confirmation state', async () => {
    const pending = { ...BASE_APP, id: 'app-2', status: 'pending' as const };
    mockFetchApps.mockResolvedValue([pending]);
    await refreshApplications();
    const result = await confirmApplicationByModel('app-2', 'user-1');
    expect(result).toBeNull();
  });

  it('returns null when the service call fails', async () => {
    mockConfirmService.mockResolvedValue(null);
    const result = await confirmApplicationByModel('app-1', 'user-1');
    expect(result).toBeNull();
    expect(getApplicationById('app-1')?.status).toBe('pending_model_confirmation');
  });

  it('returns null when application id is unknown', async () => {
    mockConfirmService.mockResolvedValue({ modelId: 'model-x' });
    const result = await confirmApplicationByModel('unknown-id', 'user-1');
    expect(result).toBeNull();
  });
});

// ─── rejectApplicationByModel ─────────────────────────────────────────────────

describe('rejectApplicationByModel', () => {
  beforeEach(async () => {
    const pendingConfirm = { ...BASE_APP, status: 'pending_model_confirmation' as const };
    mockFetchApps.mockResolvedValue([pendingConfirm]);
    await refreshApplications();
  });

  it('transitions status to rejected and returns true', async () => {
    mockRejectService.mockResolvedValue(true);

    const result = await rejectApplicationByModel('app-1', 'user-1');

    expect(result).toBe(true);
    expect(getApplicationById('app-1')?.status).toBe('rejected');
  });

  it('returns false when application is not in pending_model_confirmation state', async () => {
    const pending = { ...BASE_APP, id: 'app-2', status: 'pending' as const };
    mockFetchApps.mockResolvedValue([pending]);
    await refreshApplications();
    const result = await rejectApplicationByModel('app-2', 'user-1');
    expect(result).toBe(false);
  });

  it('returns false when the service call fails', async () => {
    mockRejectService.mockResolvedValue(false);
    const result = await rejectApplicationByModel('app-1', 'user-1');
    expect(result).toBe(false);
    expect(getApplicationById('app-1')?.status).toBe('pending_model_confirmation');
  });

  it('returns false when application id is unknown', async () => {
    const result = await rejectApplicationByModel('unknown-id', 'user-1');
    expect(result).toBe(false);
  });
});

// ─── rejectApplication (agency-side) ─────────────────────────────────────────

describe('rejectApplication', () => {
  beforeEach(async () => {
    mockFetchApps.mockResolvedValue([BASE_APP]);
    await refreshApplications();
  });

  it('transitions pending application to rejected', async () => {
    mockUpdateStatus.mockResolvedValue(true);
    await rejectApplication('app-1');
    expect(getApplicationById('app-1')?.status).toBe('rejected');
  });

  it('does nothing when the application is not pending', async () => {
    const accepted = { ...BASE_APP, id: 'app-a', status: 'accepted' as const };
    mockFetchApps.mockResolvedValue([accepted]);
    await refreshApplications();
    await rejectApplication('app-a');
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('does not mutate cache when updateApplicationStatus returns false', async () => {
    mockUpdateStatus.mockResolvedValue(false);
    await rejectApplication('app-1');
    expect(getApplicationById('app-1')?.status).toBe('pending');
  });
});
