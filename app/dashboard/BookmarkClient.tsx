"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type Bookmark = {
  id: string;
  user_id: string;
  title: string;
  url: string;
  created_at: string;
};

type User = {
  id: string;
  email: string;
  name: string;
};

type Props = {
  user: User;
  initialBookmarks: Bookmark[];
};

export default function BookmarkClient({ user, initialBookmarks }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`bookmarks:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bookmarks",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newBookmark = payload.new as Bookmark;
          setBookmarks((prev) => {
            // Avoid duplicates (optimistic insert already added it)
            if (prev.some((b) => b.id === newBookmark.id)) return prev;
            return [newBookmark, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "bookmarks",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setBookmarks((prev) =>
            prev.filter((b) => b.id !== payload.old.id)
          );
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id, supabase]);

  const handleAddBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const trimmedUrl = url.trim();
    const trimmedTitle = title.trim();

    if (!trimmedTitle || !trimmedUrl) {
      setError("Both title and URL are required.");
      setSubmitting(false);
      return;
    }

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      setError("Please enter a valid URL (e.g. https://example.com).");
      setSubmitting(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("bookmarks")
      .insert({ title: trimmedTitle, url: trimmedUrl, user_id: user.id })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
    } else if (data) {
      // Optimistic update — realtime will deduplicate
      setBookmarks((prev) => [data, ...prev]);
      setTitle("");
      setUrl("");
    }

    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);

    // Optimistic update
    setBookmarks((prev) => prev.filter((b) => b.id !== id));

    const { error: deleteError } = await supabase
      .from("bookmarks")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      // Rollback on failure — refetch
      const { data } = await supabase
        .from("bookmarks")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setBookmarks(data);
    }

    setDeletingId(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const getDomain = (rawUrl: string) => {
    try {
      return new URL(rawUrl).hostname.replace("www.", "");
    } catch {
      return rawUrl;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 text-white rounded-lg p-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </div>
            <span className="font-bold text-lg text-gray-900">Smart Bookmarks</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-600 hover:text-red-600 font-medium transition-colors border border-gray-200 hover:border-red-300 rounded-lg px-3 py-1.5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Add Bookmark Form */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add a Bookmark</h2>
          <form onSubmit={handleAddBookmark} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="title">
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Supabase Docs"
                disabled={submitting}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="url">
                URL
              </label>
              <input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://supabase.com/docs"
                disabled={submitting}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed transition"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Bookmark"
              )}
            </button>
          </form>
        </section>

        {/* Bookmarks List */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Your Bookmarks
              <span className="ml-2 bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {bookmarks.length}
              </span>
            </h2>
          </div>

          {bookmarks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <p className="text-gray-400 text-sm">No bookmarks yet. Add your first one above!</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {bookmarks.map((bookmark) => (
                <li
                  key={bookmark.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4 hover:border-indigo-200 transition-colors group"
                >
                  {/* Favicon */}
                  <div className="flex-shrink-0 mt-0.5">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${getDomain(bookmark.url)}&sz=32`}
                      alt=""
                      className="w-6 h-6 rounded"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <a
                      href={bookmark.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-900 hover:text-indigo-600 transition-colors line-clamp-1 block"
                    >
                      {bookmark.title}
                    </a>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{bookmark.url}</p>
                    <p className="text-xs text-gray-300 mt-1">{formatDate(bookmark.created_at)}</p>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(bookmark.id)}
                    disabled={deletingId === bookmark.id}
                    className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Delete bookmark"
                  >
                    {deletingId === bookmark.id ? (
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
