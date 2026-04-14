import {
  APPLY_FORM_EMPTY_PHOTO_SLOT_HEIGHT,
  APPLY_FORM_FILLED_PHOTO_ASPECT_RATIO,
} from '../applyFormPhotoLayout';

describe('applyFormPhotoLayout (Apply form photo slots)', () => {
  it('uses a compact fixed height for empty slots (not viewport-scaled 3:4)', () => {
    expect(APPLY_FORM_EMPTY_PHOTO_SLOT_HEIGHT).toBe(152);
    expect(APPLY_FORM_EMPTY_PHOTO_SLOT_HEIGHT).toBeLessThan(220);
  });

  it('keeps portrait aspect ratio for filled preview slots', () => {
    expect(APPLY_FORM_FILLED_PHOTO_ASPECT_RATIO).toBe(0.75);
  });
});
