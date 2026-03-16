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
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '',
  },
};
