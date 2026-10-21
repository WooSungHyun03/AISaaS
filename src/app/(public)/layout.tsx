import { getAuthUser } from "@/lib/supabase/server";
import { PublicNav } from "@/components/layout/public-nav";
import { PublicFooter } from "@/components/layout/public-footer";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  return (
    <div className="flex min-h-screen flex-col">
      <PublicNav isAuthenticated={Boolean(user)} />
      <main id="main-content" tabIndex={-1} className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
