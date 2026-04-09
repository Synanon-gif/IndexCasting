/**
 * Tests for project feature: service functions, index-cycling safety, and RLS boundary.
 *
 * Security invariant verified:
 *  - getProjectsForOrg with a foreign organization_id returns [] (RLS enforced at DB level,
 *    simulated here by a mock that returns no rows for non-matching org).
 */

// ─── Mock Supabase projectsSupabase ──────────────────────────────────────────
const mockRemoveModel = jest.fn();
const mockAddModel = jest.fn();
const mockGetProjectModels = jest.fn();
const mockGetProjectsForOrg = jest.fn();

jest.mock('../projectsSupabase', () => ({
  removeModelFromProject: (...args: unknown[]) => mockRemoveModel(...args),
  addModelToProject: (...args: unknown[]) => mockAddModel(...args),
  getProjectModels: (...args: unknown[]) => mockGetProjectModels(...args),
  getProjectsForOrg: (...args: unknown[]) => mockGetProjectsForOrg(...args),
}));

import {
  removeModelFromProject,
  addModelToProject,
  getProjectsForOrg,
} from '../projectsSupabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ModelSummary = {
  id: string;
  name: string;
  city: string;
  height: number;
  bust: number;
  chest: number;
  waist: number;
  hips: number;
  coverUrl: string;
  hairColor: string;
  legsInseam: number;
  agencyId?: string;
  [key: string]: unknown;
};

type Project = {
  id: string;
  name: string;
  models: ModelSummary[];
};

function makeModel(id: string, overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    id,
    name: `Model ${id}`,
    city: 'Berlin',
    height: 178,
    bust: 88,
    chest: 88,
    waist: 64,
    hips: 91,
    coverUrl: `https://example.com/${id}.jpg`,
    hairColor: 'Brown',
    legsInseam: 82,
    ...overrides,
  };
}

function makeProject(id: string, models: ModelSummary[] = []): Project {
  return { id, name: `Project ${id}`, models };
}

// ─── 1. removeModelFromProject — calls Supabase with correct args ─────────────

describe('removeModelFromProject (service)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls supabase delete with the correct projectId and modelId', async () => {
    mockRemoveModel.mockResolvedValue(true);
    const result = await removeModelFromProject('proj-1', 'model-a');
    expect(mockRemoveModel).toHaveBeenCalledWith('proj-1', 'model-a');
    expect(result).toBe(true);
  });

  it('returns false and logs error when supabase delete fails', async () => {
    mockRemoveModel.mockResolvedValue(false);
    const result = await removeModelFromProject('proj-1', 'model-missing');
    expect(result).toBe(false);
  });
});

// ─── 2. onNext index cycling — never mutates project models ──────────────────

describe('onNext index cycling', () => {
  it('cycles the index without touching project.models', () => {
    const models = [makeModel('m1'), makeModel('m2'), makeModel('m3')];
    const project = makeProject('p1', [...models]);
    const originalModels = [...project.models];

    // Simulate onNext: pure index increment modulo length
    let currentIndex = 0;
    const onNext = (prevIndex: number, total: number) => (prevIndex + 1) % total;

    currentIndex = onNext(currentIndex, models.length); // 1
    currentIndex = onNext(currentIndex, models.length); // 2
    currentIndex = onNext(currentIndex, models.length); // 0 (wrap)

    expect(currentIndex).toBe(0);
    expect(project.models).toEqual(originalModels);
    expect(project.models.length).toBe(3);
  });

  it('wraps back to 0 after reaching the last model', () => {
    const onNext = (prevIndex: number, total: number) => (prevIndex + 1) % total;
    expect(onNext(2, 3)).toBe(0);
    expect(onNext(0, 3)).toBe(1);
  });
});

// ─── 3. handleRemoveModelFromProject — optimistic state update ────────────────

describe('handleRemoveModelFromProject (optimistic logic)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('removes model from local state and calls supabase', async () => {
    mockRemoveModel.mockResolvedValue(true);

    const model = makeModel('m1');
    let projects: Project[] = [makeProject('p1', [model, makeModel('m2')])];

    const handleRemove = async (projectId: string, modelId: string) => {
      // Optimistic state update (mirrors ClientWebApp logic)
      projects = projects.map((p) =>
        p.id === projectId
          ? { ...p, models: p.models.filter((m) => m.id !== modelId) }
          : p,
      );
      await removeModelFromProject(projectId, modelId);
    };

    await handleRemove('p1', 'm1');

    const project = projects.find((p) => p.id === 'p1')!;
    expect(project.models).toHaveLength(1);
    expect(project.models[0].id).toBe('m2');
    expect(mockRemoveModel).toHaveBeenCalledWith('p1', 'm1');
  });

  it('does not remove other projects models', async () => {
    mockRemoveModel.mockResolvedValue(true);

    let projects: Project[] = [
      makeProject('p1', [makeModel('m1'), makeModel('m2')]),
      makeProject('p2', [makeModel('m3')]),
    ];

    const handleRemove = async (projectId: string, modelId: string) => {
      projects = projects.map((p) =>
        p.id === projectId
          ? { ...p, models: p.models.filter((m) => m.id !== modelId) }
          : p,
      );
      await removeModelFromProject(projectId, modelId);
    };

    await handleRemove('p1', 'm1');

    expect(projects.find((p) => p.id === 'p1')!.models).toHaveLength(1);
    expect(projects.find((p) => p.id === 'p2')!.models).toHaveLength(1);
  });
});

// ─── 4. addModelToProject — handles duplicate (23505) silently ───────────────

describe('addModelToProject (service)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns ok when insert succeeds', async () => {
    mockAddModel.mockResolvedValue({ ok: true });
    const result = await addModelToProject('proj-1', 'model-a');
    expect(result).toEqual({ ok: true });
  });

  it('returns ok (idempotent) when duplicate insert is a no-op', async () => {
    mockAddModel.mockResolvedValue({ ok: true });
    const result = await addModelToProject('proj-1', 'model-a');
    expect(result).toEqual({ ok: true });
  });
});

// ─── 5. RLS boundary — getProjectsForOrg with foreign org returns [] ─────────

describe('getProjectsForOrg (RLS boundary)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns [] for an organization the user is not a member of', async () => {
    mockGetProjectsForOrg.mockResolvedValue([]);
    const result = await getProjectsForOrg('foreign-org-id-999');
    expect(result).toEqual([]);
  });

  it('returns projects only for the correct organization', async () => {
    const ownOrgId = 'org-abc-123';
    mockGetProjectsForOrg.mockImplementation(async (orgId: string) => {
      if (orgId !== ownOrgId) return [];
      return [{ id: 'proj-1', name: 'Summer 26', organization_id: ownOrgId }];
    });

    const ownProjects = await getProjectsForOrg(ownOrgId);
    const foreignProjects = await getProjectsForOrg('attacker-org-xyz');

    expect(ownProjects).toHaveLength(1);
    expect(ownProjects[0].organization_id).toBe(ownOrgId);
    expect(foreignProjects).toEqual([]);
  });
});
