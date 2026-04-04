const { config } = require('dotenv');
const path = require('path');

// .env.local laden (vor dem Lesen von process.env)
config({ path: path.resolve(__dirname, '.env.local') });

const appJson = require('./app.json');

module.exports = {
  ...appJson.expo,
  name: appJson.expo.name,
  slug: appJson.expo.slug,
  extra: {
    // Prefer EXPO_PUBLIC_* (Metro + Vercel). Fallback: plain names often used in .env by mistake.
    supabaseUrl:
      process.env.EXPO_PUBLIC_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      '',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      '',
    supabasePublishableKey:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
      '',
    appUrl: process.env.EXPO_PUBLIC_APP_URL ?? 'https://index-casting.com',
  },
  web: {
    ...appJson.expo.web,
    bundler: 'metro',
  },
};
