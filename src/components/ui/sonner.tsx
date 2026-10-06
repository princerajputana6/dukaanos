"use client";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: "!rounded-xl !text-[14px] !font-medium" } }}
      offset={{ top: 12 }}
      mobileOffset={{ top: 12 }}
    />
  );
}
