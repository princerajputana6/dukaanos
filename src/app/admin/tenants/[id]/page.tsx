import { TenantDetailView } from "@/features/admin/tenants";

export const metadata = { title: "Account" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantDetailView id={id} />;
}
