# Smart Bookmark App

A private bookmark manager where users sign in with Google, save URLs with titles, and see their list update instantly across open tabs. Built with Next.js, Supabase, and Tailwind CSS.

Live demo: https://smart-bookmark-app-titf.vercel.app

---

## What It Does

You sign in with your Google account. You get a personal list of bookmarks — just a title and a URL. You can add them, delete them, and if you have the app open in two tabs, adding a bookmark in one tab makes it appear in the other immediately without refreshing.

No one else can see your bookmarks. That's enforced at the database level, not just in the app code.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | Server components handle auth checks before anything reaches the browser, which avoids the flash of unauthenticated content you get with purely client-side approaches |
| Auth | Supabase + Google OAuth | No passwords to manage. Google handles identity, Supabase handles the session |
| Database | Supabase Postgres | RLS policies sit inside Postgres itself — even if the app code had a bug, cross-user access would still be blocked |
| Realtime | Supabase Realtime | WebSocket-based, built into the same client already being used for everything else |
| Styling | Tailwind CSS | Faster to iterate without context-switching between files |
| Deployment | Vercel | Zero config for Next.js, handles environment variables cleanly |

---

## Architecture

```
/app
  layout.tsx              → Root layout, loads global CSS
  page.tsx                → Checks session, redirects to /login or /dashboard
  /login
    page.tsx              → Google sign-in button
  /dashboard
    page.tsx              → Server component: verifies auth, fetches initial bookmarks
    BookmarkClient.tsx    → Client component: realtime updates, add, delete
  /auth
    /callback
      route.ts            → Receives OAuth code, exchanges it for a session cookie
/lib
  /supabase
    client.ts             → Browser-side Supabase client
    server.ts             → Server-side Supabase client (reads cookies)
proxy.ts                  → Runs on every request: refreshes session, protects routes
```

There are two separate Supabase clients — one for the browser and one for the server. They look similar but serve different purposes. The server client reads the session from cookies on each request. The browser client handles the OAuth flow and opens the realtime connection. Using the wrong one in the wrong place causes the session to silently disappear.

---

## How Login Works

1. You click "Continue with Google"
2. Supabase redirects you to Google's login page
3. After you approve, Google sends you back to Supabase
4. Supabase redirects to `/auth/callback` on this app with a short-lived code
5. The callback route exchanges that code for a real session and saves it in an HttpOnly cookie
6. You land on `/dashboard`

The session lives in a cookie, not localStorage. This means it works across tabs, survives page refreshes, and isn't accessible to JavaScript running on the page.

---

## How Privacy Works (RLS)

Every bookmark row has a `user_id` column. Supabase's Row Level Security (RLS) uses that to enforce access at the database level:

```sql
-- You can only read your own rows
CREATE POLICY "select_own" ON public.bookmarks
  FOR SELECT USING (auth.uid() = user_id);

-- You can only insert rows where user_id matches your own ID
CREATE POLICY "insert_own" ON public.bookmarks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- You can only delete your own rows
CREATE POLICY "delete_own" ON public.bookmarks
  FOR DELETE USING (auth.uid() = user_id);
```

`auth.uid()` reads the JWT from the request and returns the logged-in user's ID. The `WITH CHECK` on INSERT means even if someone tampered with the request and sent a different `user_id`, Postgres would reject it. The app code doesn't need to handle this — the database does.

---

## How Realtime Works

When you open the dashboard, a WebSocket connection opens to Supabase. It listens for changes to the bookmarks table, but only for your rows:

```ts
supabase
  .channel(`bookmarks:${user.id}`)
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "bookmarks",
    filter: `user_id=eq.${user.id}`,
  }, (payload) => {
    setBookmarks(prev => {
      if (prev.some(b => b.id === payload.new.id)) return prev;
      return [payload.new as Bookmark, ...prev];
    });
  })
```

The `filter` is applied server-side — Supabase only sends events for your rows. The deduplication check (`prev.some(...)`) handles the case where the optimistic update and the realtime event arrive close together, which would otherwise cause the same bookmark to appear twice.

When the component unmounts, the channel is closed via `supabase.removeChannel(channel)`.

---

## Problems I Ran Into

**Node.js and npm not being recognized after install**

After installing Node.js, the terminal still couldn't find `npm`. The fix was closing and fully reopening VS Code so it picked up the updated PATH. On Windows, the terminal inherits environment variables at launch — if Node was installed while it was already open, it won't see the new PATH until restarted.

**PowerShell blocking npm scripts**

Running `npm install` threw a security error about scripts being disabled. Windows PowerShell has execution policies that block scripts by default. Fixed by running `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` in an Administrator PowerShell window.

**File structure — Next.js App Router conventions**

The App Router requires specific filenames in specific folders (`page.tsx`, `layout.tsx`, `route.ts`). Files in the right folder but with the wrong name just produce a 404 with no helpful error. After downloading the project files, several ended up loose in the root folder instead of inside the `app/` directory. The app wouldn't start until every file was in the right place with the right name.

**Middleware redirect loop**

After login, the app kept bouncing between `/login` and `/dashboard` in a loop. The root cause was that the session cookie wasn't being saved properly after the OAuth exchange. The proxy (middleware) was reading the session on every request but the `setAll` function wasn't fully implemented, so the refreshed token never got written back. Once both `getAll` and `setAll` were wired up correctly in the server client, the loop stopped.

**Invalid API key error during OAuth**

After Google login, the auth callback kept failing with "Invalid API key". The `.env.local` file had placeholder text instead of the real Supabase anon key. Supabase recently renamed this key from "anon key" to "Publishable Key" in their dashboard — finding it required looking under the new label.

**TypeScript errors blocking the Vercel build**

The app ran fine locally but failed to build on Vercel. The strict TypeScript compiler on Vercel rejected the `cookiesToSet` parameter in several files because it had an implicit `any` type. Locally this passed because `strict` mode wasn't fully enforced the same way. Fixed by adding an explicit type annotation:
```ts
setAll(cookiesToSet: { name: string; value: string; options?: object }[])
```
This needed to be applied in three separate files: `server.ts`, `route.ts`, and `proxy.ts`.

**OAuth redirecting to localhost after Vercel deployment**

After deploying to Vercel, clicking "Continue with Google" redirected back to `localhost:3000` instead of the live URL. The Supabase "Site URL" setting was still pointing to localhost. Updating it to the Vercel deployment URL fixed the redirect.

**Date formatting hydration mismatch**

React flagged a hydration error because the server formatted dates differently from the client based on system locale. The server rendered "18 Feb 2026" and the browser rendered "Feb 18, 2026". Fixed by passing an explicit locale (`"en-US"`) to `toLocaleDateString()` so both sides produce the same output.

---

## Database Schema

```sql
CREATE TABLE public.bookmarks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`user_id` references Supabase's internal auth table. `ON DELETE CASCADE` means if someone deletes their account, their bookmarks go with it automatically.

---

## Local Setup

**Requirements:** Node.js 18+, a Supabase project, a Google Cloud project

```bash
git clone https://github.com/Lokesh4VIT/smart-bookmark-app
cd smart-bookmark-app
npm install
```

Create `.env.local` in the root folder:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
```

Run the SQL in `database.sql` via the Supabase SQL editor, then:
```bash
npm run dev
```

**Note for Windows users:** If `npm` is not recognized after installing Node.js, close and reopen your terminal. If you get a script execution error, run this in PowerShell as Administrator:
```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Supabase Configuration

**Google OAuth:**
- Authentication → Providers → Google → enable, paste Client ID and Secret
- In Google Cloud Console: APIs & Services → Credentials → OAuth 2.0 Client ID → add authorized redirect URI:
  ```
  https://your-project-id.supabase.co/auth/v1/callback
  ```

**URL Configuration:**
- Authentication → URL Configuration
- Site URL: `http://localhost:3000` for local, your Vercel URL for production
- Redirect URLs: `http://localhost:3000/**` and `https://your-app.vercel.app/**`

---

## Vercel Deployment

1. Push to GitHub
2. Import repo at vercel.com
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy
5. After deployment, update Supabase Site URL to your Vercel URL and add it to Redirect URLs

---

## Security Notes

The anon key is visible in the browser — this is expected. It only grants what RLS policies allow, and every policy requires a valid authenticated session. Without one, it returns nothing.

Sessions are in HttpOnly cookies, not localStorage, so they can't be read by JavaScript on the page.

There is no UPDATE policy on the bookmarks table. Users can create and delete but not edit — which matches the current feature set and removes an attack surface that isn't needed.

---

## What I'd Add Next

- Search and filtering by title or domain
- Folders or collections to group bookmarks
- A browser extension to save the current tab in one click
- Better mobile layout — it works but wasn't the focus
