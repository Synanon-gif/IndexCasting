import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'casting_index_agency_shortlist_';

function key(agencyId: string): string {
  return `${PREFIX}${agencyId}`;
}

export async function loadAgencyShortlistIds(agencyId: string): Promise<string[]> {
  if (!agencyId) return [];
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(key(agencyId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    }
    const raw = await AsyncStorage.getItem(key(agencyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveAgencyShortlistIds(agencyId: string, ids: string[]): Promise<void> {
  if (!agencyId) return;
  try {
    const payload = JSON.stringify(ids);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key(agencyId), payload);
      return;
    }
    await AsyncStorage.setItem(key(agencyId), payload);
  } catch (e) {
    console.error('saveAgencyShortlistIds error:', e);
  }
}
