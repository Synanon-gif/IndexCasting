/**
 * App-wide data context: current user, projects, persistence.
 * Models now loaded from Supabase. Projects still localStorage (migrated later).
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  getModelsFromSupabase,
  getModelsForClientFromSupabase,
  updateModelVisibilityInSupabase,
  type SupabaseModel,
} from '../services/modelsSupabase';
import { useAuth } from './AuthContext';

const CURRENT_USER_KEY = 'ci_current_user_id';

type User = { id: string; role: string };

type Project = {
  id: string;
  name: string;
  owner_id: string;
  model_ids: string[];
  created_at: string;
  updated_at: string;
};

const PROJECTS_KEY = 'ci_projects';

function loadProjects(): Project[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveProjects(projects: Project[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

type AppDataState = {
  currentUser: User | null;
  projects: Project[];
  setCurrentUserId: (id: string | null) => void;
  createProject: (name: string) => Project | null;
  updateProjectName: (projectId: string, name: string) => void;
  addModelToProject: (projectId: string, modelId: string) => void;
  getModelsForClient: (clientType: 'fashion' | 'commercial') => Promise<SupabaseModel[]>;
  getModels: () => Promise<SupabaseModel[]>;
  updateModelVisibility: (id: string, payload: { is_visible_commercial?: boolean; is_visible_fashion?: boolean }) => Promise<boolean>;
};

const AppDataContext = createContext<AppDataState | null>(null);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [currentUserId, setCurrentUserIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(CURRENT_USER_KEY);
  });
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());

  const setCurrentUserId = useCallback((id: string | null) => {
    setCurrentUserIdState(id);
    if (typeof window !== 'undefined') {
      if (id) window.localStorage.setItem(CURRENT_USER_KEY, id);
      else window.localStorage.removeItem(CURRENT_USER_KEY);
    }
  }, []);

  // Role is derived from the authenticated profile — never hardcoded to 'client'.
  const currentUser: User | null = currentUserId
    ? { id: currentUserId, role: profile?.role ?? 'client' }
    : null;
  const userProjects = useMemo(() => currentUser ? projects.filter(p => p.owner_id === currentUser.id) : [], [currentUser, projects]);

  const createProjectAction = useCallback((name: string) => {
    if (!currentUser) return null;
    const p: Project = {
      id: `proj-${Date.now()}`,
      name,
      owner_id: currentUser.id,
      model_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setProjects(prev => { const next = [...prev, p]; saveProjects(next); return next; });
    return p;
  }, [currentUser]);

  const updateProjectNameAction = useCallback((projectId: string, name: string) => {
    setProjects(prev => {
      const next = prev.map(p => p.id === projectId ? { ...p, name, updated_at: new Date().toISOString() } : p);
      saveProjects(next);
      return next;
    });
  }, []);

  const addModelToProjectAction = useCallback((projectId: string, modelId: string) => {
    setProjects(prev => {
      const next = prev.map(p => {
        if (p.id !== projectId) return p;
        if (p.model_ids.includes(modelId)) return p;
        return { ...p, model_ids: [...p.model_ids, modelId], updated_at: new Date().toISOString() };
      });
      saveProjects(next);
      return next;
    });
  }, []);

  const value = useMemo<AppDataState>(
    () => ({
      currentUser,
      projects: userProjects,
      setCurrentUserId,
      createProject: createProjectAction,
      updateProjectName: updateProjectNameAction,
      addModelToProject: addModelToProjectAction,
      getModelsForClient: (clientType: 'fashion' | 'commercial') => getModelsForClientFromSupabase(clientType),
      getModels: () => getModelsFromSupabase(),
      updateModelVisibility: (id: string, payload: { is_visible_commercial?: boolean; is_visible_fashion?: boolean }) =>
        updateModelVisibilityInSupabase(id, payload),
    }),
    [
      currentUser,
      userProjects,
      setCurrentUserId,
      createProjectAction,
      updateProjectNameAction,
      addModelToProjectAction,
    ]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataState {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}

export function useCurrentUser(): User | null {
  return useContext(AppDataContext)?.currentUser ?? null;
}
