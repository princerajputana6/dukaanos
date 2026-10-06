import {
  BarChart3Icon,
  BellIcon,
  BookUserIcon,
  BotIcon,
  HistoryIcon,
  HomeIcon,
  PackageIcon,
  ReceiptIndianRupeeIcon,
  SettingsIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TruckIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/domain";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Extra path prefixes that should mark this item active. */
  match?: string[];
}

export const SIDEBAR_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/sales", label: "Sales", icon: ShoppingCartIcon },
  { href: "/purchases", label: "Purchases", icon: ShoppingBagIcon, permission: "purchase.create" },
  { href: "/inventory", label: "Inventory", icon: PackageIcon, match: ["/products"] },
  { href: "/customers", label: "Customers", icon: BookUserIcon },
  { href: "/suppliers", label: "Suppliers", icon: TruckIcon, permission: "supplier.create" },
  { href: "/expenses", label: "Expenses", icon: WalletIcon, permission: "expense.create" },
  { href: "/reports", label: "Reports", icon: BarChart3Icon, permission: "reports.view" },
  { href: "/ai", label: "AI Assistant", icon: BotIcon },
];

export const SIDEBAR_FOOTER_NAV: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: BellIcon },
  { href: "/audit", label: "Audit log", icon: HistoryIcon, permission: "audit.view" },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: HomeIcon },
  { href: "/sales", label: "Sales", icon: ReceiptIndianRupeeIcon },
  { href: "/inventory", label: "Inventory", icon: PackageIcon, match: ["/products"] },
  { href: "/customers", label: "Khata", icon: BookUserIcon },
];

/** Items shown in the mobile "More" sheet. */
export const MORE_NAV: NavItem[] = [
  { href: "/purchases", label: "Purchases", icon: ShoppingBagIcon, permission: "purchase.create" },
  { href: "/suppliers", label: "Suppliers", icon: TruckIcon, permission: "supplier.create" },
  { href: "/expenses", label: "Expenses", icon: WalletIcon, permission: "expense.create" },
  { href: "/reports", label: "Reports", icon: BarChart3Icon, permission: "reports.view" },
  { href: "/ai", label: "AI Assistant", icon: BotIcon },
  { href: "/notifications", label: "Notifications", icon: BellIcon },
  { href: "/audit", label: "Audit log", icon: HistoryIcon, permission: "audit.view" },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function isActive(pathname: string, item: NavItem): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
