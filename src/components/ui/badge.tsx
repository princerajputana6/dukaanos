import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap [&_svg]:size-3", {
  variants: {
    variant: {
      default: "bg-primary-soft text-primary-soft-foreground",
      neutral: "bg-muted text-muted-foreground",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning-foreground",
      danger: "bg-destructive-soft text-destructive",
      info: "bg-info-soft text-info",
      outline: "border text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
