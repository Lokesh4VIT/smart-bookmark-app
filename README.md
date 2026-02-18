# Smart Bookmark App

A production-ready bookmark manager built with **Next.js 14 (App Router)**, **Supabase**, and **Tailwind CSS**. Users sign in with Google, privately manage their bookmarks, and see updates in real-time across all open tabs.

---

## Project Overview

Smart Bookmark App lets authenticated users save, view, and delete bookmarks. Every bookmark is private — enforced at the database level using Supabase Row Level Security (RLS). Changes propagate instantly across browser tabs via Supabase Realtime without a page refresh.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Auth | Supabase Auth — Google OAuth 2.0 only |
| Database | Supabase Postgres |
| Real-time | Supabase Realtime (postgres_changes) |
| Security | Row Level Security (RLS) via `auth.uid()` |
| Styling | Tailwind CSS |
| Deployment | Vercel |

---

## Architecture

```
/app
  layout.tsx              → Root layout (fonts, globals)
  page.tsx                → Redirects to /dashboard or /login
  /login
    page.tsx              → Google sign-in button (client component)
  /dashboard
    page.tsx              → Server component: fetches user + initial bookmarks
    BookmarkClient.tsx    → Client component: realtime, add, delete
  /auth
    /callback
      route.ts            → OAuth code exchange → session cookie
/lib
  /supabase
    client.ts             → Browser Supabase client (SSR-safe)
    server.ts             → Server Supabase client (reads cookies)
middleware.ts             → Session refresh + route protection
```

### Request Flow

1. User visits `/` → middleware checks session → redirect to `/login` or `/dashboard`
2. On `/login`, clicking "Continue with Google" initiates OAuth with Supabase, redirecting to Google
3. Google redirects back to `/auth/callback?code=...`
4. The callback route exchanges the code for a session and sets a cookie
5. User is redirected to `/dashboard`
6. The dashboard server component fetches the authenticated user and their bookmarks
7. `BookmarkClient` mounts and opens a Supabase Realtime channel filtered to `user_id=eq.<uid>`

---

## How Real-Time Works

Supabase Realtime streams Postgres WAL (Write-Ahead Log) changes over WebSocket to connected clients.

In `BookmarkClient.tsx`:

```ts
const channel = supabase
  .channel(`bookmarks:${user.id}`)
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "bookmarks",
    filter: `user_id=eq.${user.id}`,   // Server-side filter — only your rows
  }, (payload) => {
    setBookmarks(prev => [payload.new as Bookmark, ...prev]);
  })
  .on("postgres_changes", { event: "DELETE", ... }, (payload) => {
    setBookmarks(prev => prev.filter(b => b.id !== payload.old.id));
  })
  .subscribe();
```

- The `filter` parameter ensures only the current user's changes are streamed — not other users'
- Subscriptions are cleaned up on component unmount via `supabase.removeChannel(channel)`
- Optimistic updates are applied immediately, with realtime deduplication preventing double-renders

---

## How Row Level Security (RLS) Works

RLS is enforced at the Postgres level — the application layer cannot bypass it.

```sql
-- Only the authenticated user's rows are returned
CREATE POLICY "Users can view their own bookmarks"
  ON public.bookmarks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bookmarks"
  ON public.bookmarks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bookmarks"
  ON public.bookmarks FOR DELETE
  USING (auth.uid() = user_id);
```

`auth.uid()` is a Supabase function that reads the JWT sent with every request and returns the authenticated user's UUID. Even if a malicious client sends `user_id` of another user, the `WITH CHECK` clause rejects the insert.

---

## Problems Encountered & Solutions

| Problem | Solution |
|---|---|
| OAuth redirect URIs must match exactly | Added both `localhost` and Vercel URLs to Google Cloud Console and Supabase Auth settings |
| Supabase cookies not available in Server Components after redirect | Used `@supabase/ssr` with the correct `setAll`/`getAll` cookie interface; middleware refreshes the session token on every request |
| Realtime receiving events from other users | Used the `filter` parameter on `postgres_changes` to scope events to `user_id=eq.<uid>` |
| Double-render on optimistic insert + realtime event | Added deduplication: `if (prev.some(b => b.id === newBookmark.id)) return prev` |
| `cookies()` is async in Next.js 14.2+ | Awaited `cookies()` in `lib/supabase/server.ts` and the auth callback route |

---

## Local Setup

### Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- A Google Cloud Console project

### 1. Clone & install

```bash
git clone https://github.com/your-username/smart-bookmark-app
cd smart-bookmark-app
npm install
```

### 2. Configure Supabase

1. Go to [supabase.com](https://supabase.com) → create a new project
2. Navigate to **SQL Editor** and run the contents of `database.sql`
3. Navigate to **Database → Replication** and enable replication for the `bookmarks` table (or the SQL file does this automatically)

### 3. Configure Google OAuth

**In Google Cloud Console:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add Authorized Redirect URIs:
   ```
   https://your-project-id.supabase.co/auth/v1/callback
   ```
4. Copy the **Client ID** and **Client Secret**

**In Supabase Dashboard:**
1. Go to **Authentication → Providers → Google**
2. Enable Google
3. Paste your **Client ID** and **Client Secret**
4. Add your site URL under **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (local) or `https://your-app.vercel.app` (prod)
   - Redirect URLs: `http://localhost:3000/auth/callback` and `https://your-app.vercel.app/auth/callback`

### 4. Create environment file

```bash
cp .env.local.example .env.local
```

Fill in your values from **Supabase → Settings → API**:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Production Deployment (Vercel)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/smart-bookmark-app
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import your GitHub repo
2. Add environment variables in the Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy — Vercel will auto-detect Next.js settings

### 3. Update OAuth Redirect URLs

After deployment, update:

**In Supabase → Authentication → URL Configuration:**
- Add: `https://your-app.vercel.app/auth/callback`
- Site URL: `https://your-app.vercel.app`

**In Google Cloud Console → OAuth 2.0 Client:**
- Authorized Redirect URIs already point to Supabase's callback URL — no change needed unless you changed the Supabase project

### 4. Verify

- Open your Vercel URL
- Sign in with Google
- Add a bookmark
- Open a second tab — the bookmark should appear instantly without refresh

---

## Folder Structure

```
smart-bookmark-app/
├── app/
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts          # OAuth code exchange
│   ├── dashboard/
│   │   ├── BookmarkClient.tsx    # Client: realtime + CRUD
│   │   └── page.tsx              # Server: auth guard + initial fetch
│   ├── login/
│   │   └── page.tsx              # Google sign-in
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                  # Root redirect
├── lib/
│   └── supabase/
│       ├── client.ts             # Browser client
│       └── server.ts             # Server client
├── middleware.ts                 # Session refresh + route protection
├── database.sql                  # Table + RLS policies
├── .env.local.example
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## Security Notes

- No email/password auth — Google OAuth only
- JWTs are stored in HttpOnly cookies via `@supabase/ssr`
- RLS policies prevent any cross-user data access, even with a valid anon key
- The anon key is safe to expose publicly — it has no privilege without a valid user JWT
- All bookmark operations are scoped to the authenticated user via `auth.uid()`
