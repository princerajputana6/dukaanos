"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { paiseToRupeeString, parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Rupee input that reports integer paise. Keeps the raw text while typing so users can enter
 * "12." or "12.5" naturally; never uses float arithmetic for the value.
 */
export function AmountInput({
  value,
  onChange,
  className,
  allowEmpty = true,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & { value: number | null; onChange: (paise: number | null) => void; allowEmpty?: boolean }) {
  const [text, setText] = React.useState(value == null ? "" : trimZeros(paiseToRupeeString(value)));
  const [prev, setPrev] = React.useState(value);
  // Sync when the parent changes the value (not when it echoes what the user typed).
  if (value !== prev) {
    setPrev(value);
    if (parseRupees(text) !== value) setText(value == null ? "" : trimZeros(paiseToRupeeString(value)));
  }
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[15px] text-muted-foreground">₹</span>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        className="tabular pl-8"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          if (!/^\d*(\.\d{0,2})?$/.test(t)) return;
          setText(t);
          const p = t === "" ? null : parseRupees(t);
          const next = p ?? (allowEmpty ? null : 0);
          setPrev(next);
          onChange(next);
        }}
      />
    </div>
  );
}

function trimZeros(s: string) {
  return s.replace(/\.00$/, "");
}
