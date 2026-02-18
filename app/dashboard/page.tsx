import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BookmarkClient from "./BookmarkClient";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select("*")
    .order("created_at", { ascending: false });
  return (
    <BookmarkClient
      user={{ 
        id: user.id, 
        email: user.email!, 
        name: user.user_metadata?.full_name ?? user.email! 
      }}
      initialBookmarks={bookmarks ?? []}
    />
  );
}
