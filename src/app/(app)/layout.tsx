import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";

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

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="flex min-h-screen min-w-0">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader email={user.email ?? ""} plan={subscription?.plan ?? "FREE"} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 bg-muted/10 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
