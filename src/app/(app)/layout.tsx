import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { ensureTrialCredits } from "@/server/billing/credits";
import { getCreditBalances } from "@/server/billing/run-credits";
import { isAdminUser } from "@/server/admin/access";

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

  const { data: profile } = await supabase.from("profiles").select("account_status").eq("id", user.id).maybeSingle();
  if (profile?.account_status === "SUSPENDED") redirect("/account-suspended");

  // The RPC is idempotent, so every authenticated first-party entry can safely
  // ensure the one-time trial. A migration rolling out behind the app shell
  // must not make every protected page unavailable.
  await ensureTrialCredits(user.id).catch(() => false);

  // A missing credits table must not take the whole app shell down.
  const [credits, isAdmin] = await Promise.all([
    getCreditBalances(supabase, user.id).catch(() => null),
    isAdminUser(user.id).catch((error) => {
      console.error("[admin] 관리자 여부를 확인하지 못했어요.", error);
      return false;
    }),
  ]);

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
