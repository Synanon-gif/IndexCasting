/**
 * Apply form photo slots: concurrent `assignImageFile` calls for the same slot share
 * global `photoError` and async `await convertHeicToJpegWithStatus`. A slower HEIC attempt
 * can finish after a faster JPG replacement and overwrite UI state — use a monotonic
 * generation per slot and skip stale completions.
 */
export function isStaleSlotGeneration(startGen: number, currentGen: number): boolean {
  return startGen !== currentGen;
}
