/**
 * Status display helpers.
 *
 * Maps the internal DB status fields of option_requests to unified,
 * user-facing display labels. The DB status values remain unchanged —
 * only the UI presentation is standardized.
 */

export type DisplayStatus = 'Draft' | 'In negotiation' | 'Confirmed' | 'Rejected';

/**
 * Converts the internal option_request status + final_status to a single
 * clean display label following the draft → sent → confirmed flow.
 */
export function toDisplayStatus(
  status: string | null,
  finalStatus: string | null,
): DisplayStatus {
  if (finalStatus === 'job_confirmed') return 'Confirmed';
  if (status === 'confirmed' || finalStatus === 'option_confirmed') return 'Confirmed';
  if (status === 'rejected') return 'Rejected';
  if (status === 'in_negotiation') return 'In negotiation';
  return 'Draft';
}

/** Returns a color token for a given display status (Tailwind / RN compatible). */
export function statusColor(displayStatus: DisplayStatus): string {
  switch (displayStatus) {
    case 'Confirmed': return '#16a34a'; // green-600
    case 'Rejected':  return '#dc2626'; // red-600
    case 'In negotiation': return '#d97706'; // amber-600
    case 'Draft':
    default:          return '#6b7280'; // gray-500
  }
}

/** Returns the background color token for a status badge. */
export function statusBgColor(displayStatus: DisplayStatus): string {
  switch (displayStatus) {
    case 'Confirmed': return '#dcfce7'; // green-100
    case 'Rejected':  return '#fee2e2'; // red-100
    case 'In negotiation': return '#fef3c7'; // amber-100
    case 'Draft':
    default:          return '#f3f4f6'; // gray-100
  }
}
