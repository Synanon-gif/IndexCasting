/** Coalesces rapid refresh triggers into a single delayed callback. */
export function createDebouncedScheduler(onFire: () => void, debounceMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onFire();
    }, debounceMs);
  };

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { schedule, clear };
}
