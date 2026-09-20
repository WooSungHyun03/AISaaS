import { createClient } from "@/lib/supabase/server";
import { PublicNav } from "@/components/layout/public-nav";
import { PublicFooter } from "@/components/layout/public-footer";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col">
      <PublicNav isAuthenticated={Boolean(user)} />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
