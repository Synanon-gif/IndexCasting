import { runBootstrapSingleFlight, type BootstrapFlightCell } from '../authBootstrapFlight';

describe('runBootstrapSingleFlight', () => {
  test('coalesces when two callers invoke in the same synchronous turn', () => {
    const ref: { current: BootstrapFlightCell<number> } = { current: null };
    const p1 = runBootstrapSingleFlight(ref, 'u1', async () => {
      return 7;
    });
    const p2 = runBootstrapSingleFlight(ref, 'u1', async () => {
      return 8;
    });
    expect(p1).toBe(p2);
  });

  test('coalesces concurrent calls for the same user id', async () => {
    const ref: { current: BootstrapFlightCell<number> } = { current: null };
    let runs = 0;
    const p1 = runBootstrapSingleFlight(ref, 'u1', async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 42;
    });
    const p2 = runBootstrapSingleFlight(ref, 'u1', async () => {
      runs += 1;
      return 99;
    });
    expect(p1).toBe(p2);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(runs).toBe(1);
  });

  test('does not coalesce different user ids', async () => {
    const ref: { current: BootstrapFlightCell<number> } = { current: null };
    const p1 = runBootstrapSingleFlight(ref, 'u1', async () => 1);
    const p2 = runBootstrapSingleFlight(ref, 'u2', async () => 2);
    expect(p1).not.toBe(p2);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
  });
});
