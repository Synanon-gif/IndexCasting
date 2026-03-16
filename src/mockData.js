// Zentrale Mock-Daten zur Simulation einer Mediaslide-ähnlichen API

const models = [
  {
    id: '1',
    code: 'MS-001',
    name: 'LINA K.',
    height: 178,
    bust: 81,
    waist: 60,
    hips: 89,
    city: 'Paris',
    currentLocation: 'Paris',
    hairColor: 'Dark Brown',
    eyeColor: 'Brown',
    polaroids: [
      'https://images.pexels.com/photos/6311571/pexels-photo-6311571.jpeg',
      'https://images.pexels.com/photos/6311581/pexels-photo-6311581.jpeg',
    ],
    gallery: [
      'https://images.pexels.com/photos/6311571/pexels-photo-6311571.jpeg',
      'https://images.pexels.com/photos/6311582/pexels-photo-6311582.jpeg',
    ],
    videoUrl: 'https://example.com/video-placeholder',
    traction: { swipeCount: 34 },
    isVisibleCommercial: true,
    isVisibleFashion: true,
    visibility: { commercial: true, highFashion: true },
  },
  {
    id: '2',
    code: 'MS-002',
    name: 'NOAH R.',
    height: 186,
    bust: 90,
    waist: 72,
    hips: 92,
    city: 'Milan',
    currentLocation: 'Milan',
    hairColor: 'Black',
    eyeColor: 'Brown',
    polaroids: [
      'https://images.pexels.com/photos/6311578/pexels-photo-6311578.jpeg',
    ],
    gallery: [
      'https://images.pexels.com/photos/6311578/pexels-photo-6311578.jpeg',
      'https://images.pexels.com/photos/6311580/pexels-photo-6311580.jpeg',
    ],
    videoUrl: 'https://example.com/video-placeholder',
    traction: { swipeCount: 21 },
    isVisibleCommercial: true,
    isVisibleFashion: false,
    visibility: { commercial: true, highFashion: false },
  },
  {
    id: '3',
    code: 'MS-003',
    name: 'AMI S.',
    height: 175,
    bust: 79,
    waist: 59,
    hips: 87,
    city: 'Berlin',
    currentLocation: 'Berlin',
    hairColor: 'Blonde',
    eyeColor: 'Green',
    polaroids: [
      'https://images.pexels.com/photos/6311573/pexels-photo-6311573.jpeg',
    ],
    gallery: [
      'https://images.pexels.com/photos/6311573/pexels-photo-6311573.jpeg',
    ],
    videoUrl: 'https://example.com/video-placeholder',
    traction: { swipeCount: 18 },
    isVisibleCommercial: false,
    isVisibleFashion: true,
    visibility: { commercial: false, highFashion: true },
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Client: Liste der Models für The Swipe
export async function fetchClientModels() {
  await delay(300);
  return models;
}

// Model: Eigenes Profil
export async function fetchModelProfile(modelId = '1') {
  await delay(300);
  return models.find((m) => m.id === modelId) || models[0];
}

// Agency: Traction Dashboard Daten
export async function fetchAgencyDashboard() {
  await delay(300);
  return models;
}

// Für apiService: direkter Zugriff auf Model-Array (später durch Mediaslide ersetzt)
export { models };

// Model Recruiting: eingehende Bewerbungen (wird zur Laufzeit durch applicationsStore ergänzt)
// Initial leer; Persistenz über applicationsStore / später Backend
export const incoming_applications = [];

