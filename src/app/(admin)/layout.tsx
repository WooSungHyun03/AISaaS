import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/server/admin/access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin({
    action: "ADMIN_SHELL_ACCESS",
    targetType: "route",
    targetId: "/admin",
    onDenied: "navigate",
    redirectTo: "/admin",
  });

  return <AdminShell email={user.email ?? "관리자"}>{children}</AdminShell>;
}

