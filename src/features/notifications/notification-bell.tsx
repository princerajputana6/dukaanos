"use client";
import { useQuery } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

export function NotificationBell() {
  const { data } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: ({ signal }) => apiGet<{ count: number }>("/notifications/unread-count", signal),
    refetchInterval: 60_000,
  });
  const count = data?.count ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative inline-flex size-11 items-center justify-center rounded-xl hover:bg-accent"
      aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
    >
      <BellIcon className="size-5" aria-hidden="true" />
      {count > 0 && (
        <span className="absolute top-1.5 right-1.5 flex min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-[10.5px] leading-4.5 font-bold text-destructive-foreground">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
