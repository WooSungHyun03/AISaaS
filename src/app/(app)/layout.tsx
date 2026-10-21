import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { ensureTrialCredits } from "@/server/billing/credits";
import { getCreditBalances } from "@/server/billing/run-credits";
import { isAdminUser } from "@/server/admin/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The page below renders in parallel and asks for the same user: getAuthUser shares one Auth round trip between them.
  const user = await getAuthUser();

  // Defense in depth — middleware already redirects unauthenticated users,
  // but a Server Component should never assume a request came through it.
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  // Everything the shell needs is independent of each other: one round trip, not four in a row. A missing credits table
  // must not take the whole app shell down.
  const [{ data: profile }, firstCredits, isAdmin] = await Promise.all([
    supabase.from("profiles").select("account_status").eq("id", user.id).maybeSingle(),
    getCreditBalances(supabase, user.id).catch(() => null),
    isAdminUser(user.id).catch((error) => {
      console.error("[admin] 관리자 여부를 확인하지 못했어요.", error);
      return false;
    }),
  ]);
  if (profile?.account_status === "SUSPENDED") redirect("/account-suspended");

  // The one-time trial is granted by an idempotent RPC. It only needs to run when the owner has no credits at all (a
  // first visit), so every other page view skips that round trip; the balance is read again only if it granted.
  let credits = firstCredits;
  if (credits && credits.BLOG.remaining === 0 && credits.SHORTS.remaining === 0) {
    const granted = await ensureTrialCredits(user.id).catch(() => false);
    if (granted) credits = await getCreditBalances(supabase, user.id).catch(() => credits);
  }

  return (
    <div className="flex min-h-screen min-w-0">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader email={user.email ?? ""} isAdmin={isAdmin} credits={credits ? { blog: credits.BLOG.remaining, shorts: credits.SHORTS.remaining } : null} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 bg-background px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
