import { redirect } from "next/navigation";
import { AdminShell } from "@/features/admin/admin-shell";
import { getPageSession } from "@/server/auth/page-session";

export const metadata = { title: { default: "Super admin", template: "%s · Suvakta Admin" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession();
  if (!session) redirect("/login?next=/admin");
  if (session.user.platformRole !== "SUPER_ADMIN") redirect("/dashboard");
  return (
    <AdminShell user={{ name: session.user.name, mobile: session.user.mobile }} hasShop={!!session.membership}>
      {children}
    </AdminShell>
  );
}
