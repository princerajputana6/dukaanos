"use client";
import { Button } from "@/components/ui/button";

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="outline" onClick={onClick} loading={loading}>
        Load more
      </Button>
    </div>
  );
}
