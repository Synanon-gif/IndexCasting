# Connecting Supabase to Casting Index (Step-by-Step)

This app is prepared for Supabase with a **local API layer** (`src/db/localApi.ts`) and **schema** (`src/db/schema.ts`). Follow these steps to connect a real Supabase project.

---

## Step 1: Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Choose organization, name (e.g. `casting-index`), database password, and region.
4. Wait for the project to be ready.

---

## Step 2: Get API URL and anon key

1. In the Supabase dashboard, open **Project Settings** (gear icon).
2. Go to **API**.
3. Copy:
   - **Project URL** (e.g. `https://xxxxx.supabase.co`)
   - **anon public** key (under "Project API keys").

You will use these in the app so the client can talk to Supabase (with Row Level Security protecting data).

---

## Step 3: Create tables in Supabase

In the Supabase dashboard, open **SQL Editor** and run the following (adjust types if you prefer).

```sql
-- Users (roles: model, agent, client). Sync with Supabase Auth if you use it.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('model', 'agent', 'client')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Models (Mediaslide sync id, portfolio, attributes)
CREATE TABLE models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mediaslide_sync_id TEXT,
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  height INT,
  bust INT,
  waist INT,
  hips INT,
  city TEXT,
  hair_color TEXT,
  portfolio_images TEXT[],
  polaroids TEXT[],
  is_visible_commercial BOOLEAN DEFAULT false,
  is_visible_fashion BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Projects (owner = client, content = model ids)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  model_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Conversations (context: option or booking)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('option', 'booking')),
  context_id TEXT NOT NULL,
  context_label TEXT,
  participant_ids UUID[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Messages (sender, receiver, context via conversation_id)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for RLS and performance
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_conversations_participants ON conversations USING GIN(participant_ids);
```

---

## Step 4: Row Level Security (RLS)

Enable RLS so data is only visible to authorized users (e.g. project owner, conversation participants).

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Example: users can read their own row
CREATE POLICY "Users can read own row" ON users
  FOR SELECT USING (auth.uid() = id);

-- Projects: owner can do everything
CREATE POLICY "Project owner full access" ON projects
  FOR ALL USING (owner_id = auth.uid());

-- Conversations: only participants can read/write
CREATE POLICY "Participants can read conversation" ON conversations
  FOR SELECT USING (auth.uid() = ANY(participant_ids));

CREATE POLICY "Participants can insert conversation" ON conversations
  FOR INSERT WITH CHECK (auth.uid() = ANY(participant_ids));

-- Messages: only if in conversation
CREATE POLICY "Participants can read messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids)
    )
  );

CREATE POLICY "Participants can send messages" ON messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids)
    )
  );
```

(If you are not using Supabase Auth yet, you can use a custom `user_id` claim or a separate `current_user_id` in the app and pass it in a header; then RLS policies would use that instead of `auth.uid()`.)

---

## Step 5: Environment variables in the app

1. Create `.env` in the project root (and add `.env` to `.gitignore` if not already):

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

2. Install the Supabase client:

```bash
npm install @supabase/supabase-js
```

3. Create a Supabase client (e.g. `src/lib/supabase.ts`):

```ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey);
```

---

## Step 6: Swap local API for Supabase

Replace the implementation of `src/db/localApi.ts` with functions that call Supabase instead of in-memory arrays. For example:

- `getProjectsForUser(userId)` → `supabase.from('projects').select('*').eq('owner_id', userId)`
- `getMessagesForConversation(conversationId, userId)` → `supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at')`
- `addMessage(...)` → `supabase.from('messages').insert({ conversation_id, sender_id, receiver_id, text })`

Keep the same function signatures so the rest of the app (context, screens) does not need to change. The schema in `src/db/schema.ts` already matches the table shapes above.

---

## Step 7: Mediaslide API URL

In `src/services/mediaslideConnector.js`, set the real Mediaslide base URL when you have it:

- Either in `.env`: `EXPO_PUBLIC_MEDIASLIDE_API_URL=https://api.mediaslide.com/v1`
- Or in the connector: `const MEDIASLIDE_API_BASE_URL = process.env.EXPO_PUBLIC_MEDIASLIDE_API_URL || null;`

Then uncomment and adjust the `fetch` calls marked with `REAL API CALL` in that file.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Create Supabase project |
| 2 | Copy Project URL and anon key |
| 3 | Run SQL to create tables (users, models, projects, conversations, messages) |
| 4 | Enable RLS and add policies so only authorized users see data |
| 5 | Add `.env` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, install `@supabase/supabase-js`, create `supabase` client |
| 6 | Replace `localApi` with Supabase calls (same API surface) |
| 7 | Set Mediaslide API URL in env and in `mediaslideConnector.js` |

After that, the app will use Supabase as the backend while keeping the same data schema and RLS-ready access pattern.
