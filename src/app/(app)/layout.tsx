import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { getCreditBalances } from "@/server/billing/run-credits";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense in depth — middleware already redirects unauthenticated users,
  // but a Server Component should never assume a request came through it.
  if (!user) {
    redirect("/login");
  }

  // A missing credits table must not take the whole app shell down.
  const credits = await getCreditBalances(supabase, user.id).catch(() => null);

  return (
    <div className="flex min-h-screen min-w-0">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader email={user.email ?? ""} credits={credits ? { blog: credits.BLOG.remaining, shorts: credits.SHORTS.remaining } : null} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
