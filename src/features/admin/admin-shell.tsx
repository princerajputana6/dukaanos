"use client";
import { BuildingIcon, HandshakeIcon, HistoryIcon, LayoutDashboardIcon, LogOutIcon, MenuIcon, PlusCircleIcon, StoreIcon, UsersIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { clearOfflineData } from "@/features/pwa/pwa";
import { apiPost } from "@/lib/api";
import { initials } from "@/lib/text";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboardIcon, exact: true },
  { href: "/admin/tenants", label: "Tenants & licences", icon: BuildingIcon },
  { href: "/admin/shops", label: "Shops & branches", icon: StoreIcon },
  { href: "/admin/agencies", label: "Agencies", icon: HandshakeIcon },
  { href: "/admin/users", label: "Owners & users", icon: UsersIcon },
  { href: "/admin/audit", label: "Admin audit log", icon: HistoryIcon },
];

export function AdminShell({ children, user, hasShop }: { children: React.ReactNode; user: { name: string; mobile: string }; hasShop: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const active = (n: (typeof NAV)[number]) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`));
  const nav = (
    <nav aria-label="Admin" className="flex flex-1 flex-col gap-0.5 px-3 py-3">
      <Button asChild className="mb-3 w-full justify-start">
        <Link href="/admin/shops/new" onClick={() => setOpen(false)}>
          <PlusCircleIcon /> Create shop
        </Link>
      </Button>
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={() => setOpen(false)}
          aria-current={active(n) ? "page" : undefined}
          className={cn(
            "flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium",
            active(n) ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/8 hover:text-white",
          )}
        >
          <n.icon className="size-[18px]" aria-hidden="true" />
          {n.label}
        </Link>
      ))}
      <div className="mt-auto space-y-1 border-t border-white/10 pt-3">
        {hasShop && (
          <Link href="/dashboard" className="flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] text-white/70 hover:bg-white/8 hover:text-white">
            <StoreIcon className="size-[18px]" /> Open my shop
          </Link>
        )}
        <div className="flex items-center gap-3 px-3 py-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold text-white">{initials(user.name)}</span>
          <span className="min-w-0 flex-1 text-[12.5px] text-white/80">
            <span className="block truncate font-semibold text-white">{user.name}</span>
            Super admin
          </span>
          <button
            type="button"
            aria-label="Log out"
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
            onClick={async () => {
              await apiPost("/auth/logout").catch(() => undefined);
              await clearOfflineData();
              window.location.assign("/login");
            }}
          >
            <LogOutIcon className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col bg-[oklch(0.22_0.03_200)] lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5 text-white">
          <LogoMark />
          <span className="font-bold">DukaanOS</span>
          <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold">ADMIN</span>
        </div>
        {nav}
      </aside>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-[oklch(0.22_0.03_200)] px-4 text-white lg:hidden">
        <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-white/10">
          <MenuIcon className="size-5" />
        </button>
        <LogoMark className="size-7" />
        <span className="font-bold">DukaanOS Admin</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-72 flex-col bg-[oklch(0.22_0.03_200)]">
            <div className="flex h-14 items-center justify-between px-4 text-white">
              <span className="font-bold">DukaanOS Admin</span>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/10">
                <XIcon className="size-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}
      <main id="main" className="min-w-0 px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
