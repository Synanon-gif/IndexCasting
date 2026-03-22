/** Agency marketing segments (multi-select). Stored in `agencies.agency_types` (text[]). English UI only. */
export const AGENCY_SEGMENT_TYPES = ['Fashion', 'High Fashion', 'Commercial'] as const;

export type AgencySegmentType = (typeof AGENCY_SEGMENT_TYPES)[number];
