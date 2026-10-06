"use client";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { apiGet } from "@/lib/api";
import type { FeatureFlags, Permission } from "@/lib/domain";

export interface MeData {
  user: { id: string; name: string; mobile: string; email: string | null };
  membership: { businessId: string; businessName: string; onboardedAt: number | null; roleKey: string; roleName: string; permissions: Permission[] };
  businesses: Array<{ id: string; name: string; type: string }>;
  business: { id: string; name: string; type: string; city: string | null; stateCode: string | null; phone: string | null; address: string | null; onboardingStep: number; onboardedAt: number | null };
  settings: {
    pricesIncludeGst: boolean;
    allowNegativeStock: boolean;
    defaultLowStockMilli: number;
    invoicePrefix: string;
    language: string;
    voiceProvider: string;
    aiEnabled: boolean;
    lowStockNotifications: boolean;
    dailySummaryNotifications: boolean;
    outstandingReminders: boolean;
  };
  gst: { gstin: string | null; legalName: string | null; stateCode: string | null; registrationStatus: string };
  flags: FeatureFlags;
}

const SessionContext = createContext<MeData | null>(null);

export function SessionProvider({ initial, children }: { initial: MeData; children: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => apiGet<MeData>("/me", signal), initialData: initial, staleTime: 60_000 });
  return <SessionContext.Provider value={data}>{children}</SessionContext.Provider>;
}

export function useSession(): MeData {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function useCan() {
  const s = useSession();
  return (p: Permission) => s.membership.permissions.includes(p);
}
