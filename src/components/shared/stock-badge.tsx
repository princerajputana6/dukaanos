import { Badge } from "@/components/ui/badge";
import { stockState } from "@/lib/domain";

export function StockBadge({ milli, threshold, trackStock = true }: { milli: number; threshold: number; trackStock?: boolean }) {
  if (!trackStock) return <Badge variant="neutral">Service</Badge>;
  const s = stockState(milli, threshold);
  if (s === "OUT_OF_STOCK") return <Badge variant="danger">Out of stock</Badge>;
  if (s === "LOW_STOCK") return <Badge variant="warning">Low stock</Badge>;
  return <Badge variant="success">In stock</Badge>;
}
