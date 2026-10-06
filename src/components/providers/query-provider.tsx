"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => {
              if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
              return count < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );
  // Marks the document as interactive (used by E2E tests and CSS hooks).
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
