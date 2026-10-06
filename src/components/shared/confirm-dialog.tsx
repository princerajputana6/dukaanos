"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";

/** Strong confirmation for destructive/financial actions, with an optional reason field. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  askReason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  askReason?: boolean;
  onConfirm: (reason: string | undefined) => Promise<void> | void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
        if (!o) setReason("");
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            loading={busy}
            disabled={askReason && reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(askReason ? reason.trim() : undefined);
                onOpenChange(false);
                setReason("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {askReason && (
        <div className="space-y-1.5">
          <label htmlFor="confirm-reason" className="text-[13px] font-medium">
            Reason
          </label>
          <Input id="confirm-reason" autoFocus placeholder="e.g. Wrong entry" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
    </ResponsiveModal>
  );
}
