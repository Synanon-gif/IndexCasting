import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMyModelAgencies,
  type ModelAgencyContext as ModelAgencyRow,
} from '../services/modelsSupabase';

const STORAGE_KEY = 'active_model_agency';

type ModelAgencyState = {
  /** All agency representations for this model user (from model_agency_territories). */
  agencies: ModelAgencyRow[];
  /** Currently active agency id. null = not yet selected or no agencies. */
  activeAgencyId: string | null;
  activeOrganizationId: string | null;
  /** Model id (same across all agencies — single models row per user). */
  modelId: string | null;
  loading: boolean;
  switchAgency: (agencyId: string) => void;
  reload: () => Promise<void>;
};

const ModelAgencyCtx = createContext<ModelAgencyState>({
  agencies: [],
  activeAgencyId: null,
  activeOrganizationId: null,
  modelId: null,
  loading: true,
  switchAgency: () => {},
  reload: async () => {},
});

export const useModelAgency = () => useContext(ModelAgencyCtx);

export const ModelAgencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [agencies, setAgencies] = useState<ModelAgencyRow[]>([]);
  const [activeAgencyId, setActiveAgencyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getMyModelAgencies();
      setAgencies(rows);
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && rows.some((r) => r.agencyId === stored)) {
        setActiveAgencyId(stored);
      } else if (rows.length === 1) {
        setActiveAgencyId(rows[0].agencyId);
        await AsyncStorage.setItem(STORAGE_KEY, rows[0].agencyId);
      } else if (rows.length > 1) {
        // Stored agency was removed; fallback to first available
        setActiveAgencyId(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
      } else {
        setActiveAgencyId(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.error('ModelAgencyProvider load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchAgency = useCallback((agencyId: string) => {
    setActiveAgencyId(agencyId);
    void AsyncStorage.setItem(STORAGE_KEY, agencyId);
  }, []);

  const activeRow = useMemo(
    () => agencies.find((a) => a.agencyId === activeAgencyId) ?? null,
    [agencies, activeAgencyId],
  );

  const value = useMemo<ModelAgencyState>(
    () => ({
      agencies,
      activeAgencyId,
      activeOrganizationId: activeRow?.organizationId ?? null,
      modelId: agencies[0]?.modelId ?? null,
      loading,
      switchAgency,
      reload: load,
    }),
    [agencies, activeAgencyId, activeRow, loading, switchAgency, load],
  );

  return <ModelAgencyCtx.Provider value={value}>{children}</ModelAgencyCtx.Provider>;
};
