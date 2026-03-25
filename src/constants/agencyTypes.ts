/** Agency marketing segments (multi-select). Stored in `agencies.agency_types` (text[]). English UI only. */
export const AGENCY_SEGMENT_TYPES = ['Fashion', 'High Fashion', 'Commercial'] as const;

export type AgencySegmentType = (typeof AGENCY_SEGMENT_TYPES)[number];

/**
 * Sports sub-categories for models.
 * Stored as boolean columns `is_sports_winter` / `is_sports_summer` on models — NOT part of `categories[]`.
 * Independent of Fashion/Commercial dimension.
 */
export const SPORTS_CATEGORIES = ['Winter Sports', 'Summer Sports'] as const;

export type SportsCategoryType = (typeof SPORTS_CATEGORIES)[number];
