-- Einmal im Supabase SQL Editor ausführen: 3 Demo-Models einfügen.
-- Verwendet die festen Agency-UUIDs aus seed_agencies.sql.

INSERT INTO public.models (id, agency_id, mediaslide_sync_id, name, height, bust, waist, hips, city, hair_color, eye_color, current_location, portfolio_images, polaroids, video_url, is_visible_commercial, is_visible_fashion)
VALUES
  (
    'b1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'MS-001',
    'LINA K.',
    178, 81, 60, 89,
    'Paris', 'Dark Brown', 'Brown', 'Paris',
    ARRAY['https://images.pexels.com/photos/6311571/pexels-photo-6311571.jpeg','https://images.pexels.com/photos/6311582/pexels-photo-6311582.jpeg'],
    ARRAY['https://images.pexels.com/photos/6311571/pexels-photo-6311571.jpeg','https://images.pexels.com/photos/6311581/pexels-photo-6311581.jpeg'],
    'https://example.com/video-placeholder',
    true, true
  ),
  (
    'b1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'MS-002',
    'NOAH R.',
    186, 90, 72, 92,
    'Milan', 'Black', 'Brown', 'Milan',
    ARRAY['https://images.pexels.com/photos/6311578/pexels-photo-6311578.jpeg','https://images.pexels.com/photos/6311580/pexels-photo-6311580.jpeg'],
    ARRAY['https://images.pexels.com/photos/6311578/pexels-photo-6311578.jpeg'],
    'https://example.com/video-placeholder',
    true, false
  ),
  (
    'b1000000-0000-4000-8000-000000000003'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'MS-003',
    'AMI S.',
    175, 79, 59, 87,
    'Berlin', 'Blonde', 'Green', 'Berlin',
    ARRAY['https://images.pexels.com/photos/6311573/pexels-photo-6311573.jpeg'],
    ARRAY['https://images.pexels.com/photos/6311573/pexels-photo-6311573.jpeg'],
    'https://example.com/video-placeholder',
    false, true
  )
ON CONFLICT (id) DO NOTHING;
