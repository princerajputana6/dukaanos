import type * as React from "react";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Label + control + hint/error, wired for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
  optional,
}: {
  id: string;
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[12.5px] font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
