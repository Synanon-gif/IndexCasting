/**
 * Single-flight coalescing for async bootstrap keyed by user id.
 * Registers `flightRef` synchronously before `run()` starts (no gap where a second
 * caller can start duplicate work).
 */

export type BootstrapFlightCell<T> = { key: string; promise: Promise<T> } | null;

export function runBootstrapSingleFlight<T>(
  flightRef: { current: BootstrapFlightCell<T> },
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  const inflight = flightRef.current;
  if (inflight?.key === userId) return inflight.promise;

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  flightRef.current = { key: userId, promise };

  void (async () => {
    try {
      resolve(await run());
    } catch (e) {
      reject(e);
    } finally {
      if (flightRef.current?.promise === promise) {
        flightRef.current = null;
      }
    }
  })();

  return promise;
}
