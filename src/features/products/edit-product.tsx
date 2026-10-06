"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/session/session-context";
import { api, apiGet, errorMessage } from "@/lib/api";
import type { ProductDetail } from "@/lib/api-types";
import { ProductForm } from "./product-form";

export function EditProduct({ id }: { id: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const [archive, setArchive] = React.useState(false);
  const q = useQuery({ queryKey: ["products", "detail", id], queryFn: ({ signal }) => apiGet<ProductDetail>(`/products/${id}`, signal), staleTime: 0 });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={5} />;
  const p = q.data.product;
  const toggle = async () => {
    try {
      await api(`/products/${id}`, { method: "PATCH", body: { isActive: !p.isActive } });
      toast.success(p.isActive ? `${p.name} archived` : `${p.name} restored`);
      await qc.invalidateQueries({ queryKey: ["products"] });
      router.push(p.isActive ? "/products" : `/inventory/${id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${p.name}`}
        back={{ href: `/inventory/${id}`, label: p.name }}
        actions={
          can("inventory.create") && (
            <Button variant="outline" onClick={() => (p.isActive ? setArchive(true) : void toggle())}>
              {p.isActive ? <ArchiveIcon /> : <ArchiveRestoreIcon />} {p.isActive ? "Archive" : "Restore"}
            </Button>
          )
        }
      />
      <ProductForm key={p.updatedAt} existing={q.data} />
      <ConfirmDialog
        open={archive}
        onOpenChange={setArchive}
        title={`Archive ${p.name}?`}
        description="It will be hidden from billing and lists. Past sales and stock history are kept. You can restore it any time."
        confirmLabel="Archive"
        destructive
        onConfirm={toggle}
      />
    </div>
  );
}
