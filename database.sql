-- ============================================================
-- Smart Bookmark App — Database Setup
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create the bookmarks table
CREATE TABLE IF NOT EXISTS public.bookmarks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies — users can only access their own bookmarks

-- SELECT: only own rows
CREATE POLICY "Users can view their own bookmarks"
  ON public.bookmarks
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: only for themselves
CREATE POLICY "Users can insert their own bookmarks"
  ON public.bookmarks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- DELETE: only own rows
CREATE POLICY "Users can delete their own bookmarks"
  ON public.bookmarks
  FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Enable Realtime for this table
-- Go to: Supabase Dashboard → Database → Replication → Tables
-- Enable replication for the "bookmarks" table
-- OR run:
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookmarks;
