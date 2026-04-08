import {
  filterModelsByChestCoalesce,
  type ChestFilterBounds,
} from '../../utils/filterModelsByChestCoalesce';

describe('filterModelsByChestCoalesce', () => {
  const base = { id: '1', chest: null as number | null, bust: null as number | null };

  it('passes all rows when no chest min/max', () => {
    const models = [
      { ...base, id: 'a', chest: null, bust: 90 },
      { ...base, id: 'b', chest: 88, bust: null },
    ];
    const f: ChestFilterBounds = {};
    expect(filterModelsByChestCoalesce(models, f)).toHaveLength(2);
  });

  it('includes bust-only row when chest min satisfied via bust', () => {
    const models = [
      { ...base, chest: null, bust: 92 },
      { ...base, chest: 80, bust: 99 },
    ];
    const f: ChestFilterBounds = { chestMin: 90 };
    const out = filterModelsByChestCoalesce(models, f);
    expect(out.map((m) => m.bust)).toEqual([92]);
  });

  it('excludes row when coalesce value below min', () => {
    const models = [{ ...base, chest: null, bust: 85 }];
    expect(filterModelsByChestCoalesce(models, { chestMin: 90 })).toHaveLength(0);
  });

  it('prefers chest over bust when both set', () => {
    const models = [{ ...base, chest: 80, bust: 95 }];
    expect(filterModelsByChestCoalesce(models, { chestMin: 90 })).toHaveLength(0);
    expect(filterModelsByChestCoalesce(models, { chestMax: 85 })).toHaveLength(1);
  });

  it('applies chest max with bust fallback', () => {
    const models = [
      { ...base, chest: null, bust: 88 },
      { ...base, chest: null, bust: 95 },
    ];
    const out = filterModelsByChestCoalesce(models, { chestMax: 90 });
    expect(out).toHaveLength(1);
    expect(out[0].bust).toBe(88);
  });

  it('excludes when both chest and bust null but min required', () => {
    const models = [{ ...base, chest: null, bust: null }];
    expect(filterModelsByChestCoalesce(models, { chestMin: 1 })).toHaveLength(0);
  });
});
