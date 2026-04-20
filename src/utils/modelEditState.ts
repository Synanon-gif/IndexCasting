/**
 * `ModelEditState` — pure, JSX-free representation of the Agency-side model
 * edit form. Lives outside `ModelEditDetailsPanel.tsx` so unit tests (jest)
 * can import the type and the `buildEditState` factory without dragging in
 * React Native — which the current jest config does not transform.
 *
 * `ModelEditDetailsPanel.tsx` re-exports both symbols for backwards-compat,
 * so existing `import { buildEditState, type ModelEditState } from '../components/ModelEditDetailsPanel'`
 * call sites continue to work.
 */

export type ModelEditState = {
  name: string;
  email: string;
  sex: 'male' | 'female' | null;
  height: string;
  chest: string;
  waist: string;
  hips: string;
  legs_inseam: string;
  shoe_size: string;
  hair_color: string;
  eye_color: string;
  ethnicity: string | null;
  country_code: string;
  city: string;
  current_location: string;
  categories: string[];
  is_sports_winter: boolean;
  is_sports_summer: boolean;
  /** Free-text mother agency name (visible to clients via existing models RLS). */
  mother_agency_name: string;
  /** Free-text mother agency contact (UI keeps it agency-internal). */
  mother_agency_contact: string;
};

export function buildEditState(m: {
  name: string;
  email?: string | null;
  sex?: 'male' | 'female' | null;
  height?: number | null;
  chest?: number | null;
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
  legs_inseam?: number | null;
  shoe_size?: number | null;
  hair_color?: string | null;
  eye_color?: string | null;
  ethnicity?: string | null;
  country_code?: string | null;
  country?: string | null;
  city?: string | null;
  current_location?: string | null;
  categories?: string[] | null;
  is_sports_winter?: boolean;
  is_sports_summer?: boolean;
  mother_agency_name?: string | null;
  mother_agency_contact?: string | null;
}): ModelEditState {
  const chestVal = m.chest ?? m.bust;
  return {
    name: m.name ?? '',
    email: m.email ?? '',
    sex: (m.sex as 'male' | 'female' | null) ?? null,
    height: String(m.height ?? ''),
    chest: chestVal != null ? String(chestVal) : '',
    waist: m.waist != null ? String(m.waist) : '',
    hips: m.hips != null ? String(m.hips) : '',
    legs_inseam: m.legs_inseam != null ? String(m.legs_inseam) : '',
    shoe_size: m.shoe_size != null ? String(m.shoe_size) : '',
    hair_color: m.hair_color ?? '',
    eye_color: m.eye_color ?? '',
    ethnicity: m.ethnicity ?? null,
    country_code: m.country_code ?? '',
    city: m.city ?? '',
    current_location: m.current_location ?? '',
    categories: m.categories ?? [],
    is_sports_winter: m.is_sports_winter ?? false,
    is_sports_summer: m.is_sports_summer ?? false,
    mother_agency_name: m.mother_agency_name ?? '',
    mother_agency_contact: m.mother_agency_contact ?? '',
  };
}
