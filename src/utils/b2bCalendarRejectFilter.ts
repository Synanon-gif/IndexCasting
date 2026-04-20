/**
 * B2B unified calendar (client/agency): rejected negotiations keep an `option_requests` row while
 * DB triggers cancel mirrors. Calendar fetches that omit cancelled rows would still produce a
 * date-only ghost from `requested_date` unless we drop these items before `buildUnifiedAgencyCalendarRows`.
 */
export function filterOutRejectedOptionCalendarRows<T extends { option: { status: string } }>(
  items: T[],
): T[] {
  return items.filter((row) => row.option.status !== 'rejected');
}
