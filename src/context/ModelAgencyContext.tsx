import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMyModelAgencies,
  type ModelAgencyContext as ModelAgencyRow,
} from '../services/modelsSupabase';
import {
  makeModelAgencyKey,
  findRowByKey,
  computeInitialRepresentationKey,
} from '../utils/modelAgencyKey';

const STORAGE_KEY = 'active_model_agency';

type ModelAgencyState = {
  /** All agency representations for this model user (from model_agency_territories). */
  agencies: ModelAgencyRow[];
  /**
   * Active representation: `agencyId:territory` (one MAT row). null = not selected or none.
   */
  activeRepresentationKey: string | null;
  /** @deprecated Use activeRepresentationKey — kept for quick agency id access */
  activeAgencyId: string | null;
  /** Resolved active MAT row (agency + territory), or null. */
  activeRow: ModelAgencyRow | null;
  activeOrganizationId: string | null;
  /** Model id (same across all agencies — single models row per user). */
  modelId: string | null;
  loading: boolean;
  switchRepresentation: (row: ModelAgencyRow) => void;
  reload: () => Promise<void>;
};

const ModelAgencyCtx = createContext<ModelAgencyState>({
  agencies: [],
  activeRepresentationKey: null,
  activeAgencyId: null,
  activeRow: null,
  activeOrganizationId: null,
  modelId: null,
  loading: true,
  switchRepresentation: () => {
    /* noop */
  },
  reload: async () => {},
});

export const useModelAgency = () => useContext(ModelAgencyCtx);

export const ModelAgencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [agencies, setAgencies] = useState<ModelAgencyRow[]>([]);
  const [activeRepresentationKey, setActiveRepresentationKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getMyModelAgencies();
      setAgencies(rows);
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const nextKey = computeInitialRepresentationKey(stored, rows);
      setActiveRepresentationKey(nextKey);
      if (nextKey) {
        if (stored !== nextKey) {
          await AsyncStorage.setItem(STORAGE_KEY, nextKey);
        }
      } else {
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

  const switchRepresentation = useCallback(
    (row: ModelAgencyRow) => {
      const key = makeModelAgencyKey(row.agencyId, row.territory);
      const valid = agencies.some((a) => makeModelAgencyKey(a.agencyId, a.territory) === key);
      if (!valid) {
        console.warn('[ModelAgencyContext] switchRepresentation: unknown row', key);
        return;
      }
      setActiveRepresentationKey(key);
      void AsyncStorage.setItem(STORAGE_KEY, key);
    },
    [agencies],
  );

  const activeRow = useMemo(
    () => findRowByKey(agencies, activeRepresentationKey),
    [agencies, activeRepresentationKey],
  );

  const value = useMemo<ModelAgencyState>(
    () => ({
      agencies,
      activeRepresentationKey,
      activeAgencyId: activeRow?.agencyId ?? null,
      activeRow,
      activeOrganizationId: activeRow?.organizationId ?? null,
      modelId: agencies[0]?.modelId ?? null,
      loading,
      switchRepresentation,
      reload: load,
    }),
    [agencies, activeRepresentationKey, activeRow, loading, switchRepresentation, load],
  );

  return <ModelAgencyCtx.Provider value={value}>{children}</ModelAgencyCtx.Provider>;
};
