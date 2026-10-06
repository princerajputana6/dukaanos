"use client";
import { ChevronsUpDownIcon, LogOutIcon, MenuIcon, SearchIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { OfflineBanner } from "@/features/offline/offline-banner";
import { clearOfflineData } from "@/features/pwa/pwa";
import { GlobalSearch } from "@/features/search/global-search";
import { useCan, useSession } from "@/features/session/session-context";
import { VoiceFab } from "@/features/voice/voice-fab";
import { apiPost } from "@/lib/api";
import { initials } from "@/lib/text";
import { cn } from "@/lib/utils";
import { isActive, MOBILE_TABS, MORE_NAV, SIDEBAR_FOOTER_NAV, SIDEBAR_NAV, type NavItem } from "./nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const can = useCan();
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const visible = (items: NavItem[]) => items.filter((i) => !i.permission || can(i.permission));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    const onUnauth = () => window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    window.addEventListener("keydown", onKey);
    window.addEventListener("dukaan:unauthenticated", onUnauth);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dukaan:unauthenticated", onUnauth);
    };
  }, []);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar md:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/dashboard" aria-label="DukaanOS home">
            <Logo />
          </Link>
        </div>
        <BusinessSwitcher />
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {visible(SIDEBAR_NAV).map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
        </nav>
        <nav aria-label="Secondary" className="space-y-0.5 border-t px-3 py-3">
          {visible(SIDEBAR_FOOTER_NAV).map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b bg-background/85 pt-safe backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-4 md:h-16 md:px-6">
            <Link href="/dashboard" className="md:hidden" aria-label="DukaanOS home">
              <Logo compact />
            </Link>
            <MobileBusinessName />
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="ml-auto hidden h-10 w-full max-w-sm items-center gap-2 rounded-xl border bg-card px-3 text-sm text-muted-foreground shadow-xs hover:bg-accent md:flex"
            >
              <SearchIcon className="size-4" />
              Search products, customers, bills…
              <kbd className="ml-auto rounded-md border bg-muted px-1.5 text-[11px] font-medium">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1 md:ml-2">
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setSearchOpen(true)}>
                <SearchIcon className="size-5" />
              </Button>
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
          <OfflineBanner />
        </header>

        <main id="main" className="flex-1 px-4 pt-4 pb-32 md:px-6 md:pt-6 md:pb-12">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-safe backdrop-blur-md md:hidden">
        <div className="grid h-16 grid-cols-5">
          {MOBILE_TABS.map((item) => (
            <MobileTab key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", moreOpen ? "text-primary" : "text-muted-foreground")}
            aria-haspopup="dialog"
          >
            <MenuIcon className="size-[22px]" aria-hidden="true" />
            More
          </button>
        </div>
      </nav>

      <VoiceFab />

      <ResponsiveModal open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <div className="grid grid-cols-3 gap-2 pb-2">
          {visible(MORE_NAV).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMoreOpen(false)}
              className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-2 text-center text-[12.5px] font-medium hover:bg-accent"
            >
              <item.icon className="size-5 text-primary" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </div>
      </ResponsiveModal>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors",
        active ? "bg-primary-soft text-primary-soft-foreground" : "text-foreground/75 hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon className={cn("size-[18px]", active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
      {item.label}
    </Link>
  );
}

function MobileTab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
    >
      <item.icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
      {item.label}
    </Link>
  );
}

function MobileBusinessName() {
  const s = useSession();
  return <span className="truncate text-[15px] font-semibold md:hidden">{s.business.name}</span>;
}

function BusinessSwitcher() {
  const s = useSession();
  const others = s.businesses.filter((b) => b.id !== s.business.id);
  const trigger = (
    <div className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-[13px] font-bold text-primary">{initials(s.business.name)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold">{s.business.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{s.membership.roleName}</span>
      </span>
      {others.length > 0 && <ChevronsUpDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
    </div>
  );
  if (others.length === 0) return <div className="px-3 pb-2">{trigger}</div>;
  return (
    <div className="px-3 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger className="w-full rounded-xl" aria-label="Switch business">
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Switch business</DropdownMenuLabel>
          {others.map((b) => (
            <DropdownMenuItem
              key={b.id}
              onSelect={async () => {
                await apiPost("/auth/switch-business", { businessId: b.id });
                await clearOfflineData();
                window.location.assign("/dashboard");
              }}
            >
              {b.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function UserMenu() {
  const s = useSession();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-[13px] font-bold text-primary-soft-foreground"
        aria-label="Account menu"
      >
        {initials(s.user.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="text-foreground">
          <span className="block text-sm font-semibold">{s.user.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            +91 {s.user.mobile} · {s.membership.roleName}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/security">
            <UserIcon /> Account & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            await apiPost("/auth/logout").catch(() => undefined);
            await clearOfflineData();
            window.location.assign("/login");
          }}
        >
          <LogOutIcon /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
