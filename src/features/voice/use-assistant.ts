"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { AssistantResponse } from "@/lib/api-types";

export const SALE_DRAFT_KEY = "dukaan:sale-draft";
export const PURCHASE_DRAFT_KEY = "dukaan:purchase-draft";

/** Thin client for the assistant API; all decisions happen on the server. */
export function useAssistantApi() {
  const qc = useQueryClient();
  const router = useRouter();

  const interpret = useCallback(
    (text: string, voice?: { provider: "browser"; language?: string; durationMs?: number }) =>
      api<AssistantResponse>("/ai/interpret", { method: "POST", body: { text, ...(voice ? { voice } : {}) } }),
    [],
  );
  const clarify = useCallback((id: string, choice: { optionId?: string; text?: string; slot?: string }) => api<AssistantResponse>(`/ai/interactions/${id}/clarify`, { method: "POST", body: choice }), []);
  const confirm = useCallback(
    async (id: string) => {
      const r = await api<AssistantResponse>(`/ai/interactions/${id}/confirm`, { method: "POST" });
      // Everything that shows business data may have changed.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      return r;
    },
    [qc],
  );
  const cancel = useCallback((id: string) => api<AssistantResponse>(`/ai/interactions/${id}/cancel`, { method: "POST" }), []);

  /** "Edit": open the regular form prefilled with the proposal (nothing is saved yet). */
  const edit = useCallback(
    (r: AssistantResponse) => {
      const p = r.proposal;
      if (!p) return;
      try {
        if (p.kind === "CREATE_SALE") sessionStorage.setItem(SALE_DRAFT_KEY, JSON.stringify(p.command));
        if (p.kind === "CREATE_PURCHASE") sessionStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(p.command));
      } catch {
        /* storage unavailable — the form opens empty */
      }
      void api(`/ai/interactions/${r.interactionId}/cancel`, { method: "POST" }).catch(() => undefined);
      const href = p.kind === "CREATE_SALE" ? "/sales/new?draft=1" : p.kind === "CREATE_PURCHASE" ? "/purchases/new?draft=1" : (p.view.editHref ?? "/dashboard");
      router.push(href);
    },
    [router],
  );

  return { interpret, clarify, confirm, cancel, edit };
}

/**
 * Reads (and clears) a proposal draft saved by "Edit" on a voice confirmation card.
 * Read once per page visit; returns null when there is none.
 */
export function useVoiceDraft<T>(key: string, enabled: boolean): T | null {
  const q = useQuery({
    queryKey: ["voice-draft", key],
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: () => {
      try {
        const raw = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
  });
  return q.data ?? null;
}
