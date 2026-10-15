import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { getPageSession } from "@/server/auth/page-session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession();
  if (session?.membership) redirect(session.membership.onboardedAt ? "/dashboard" : "/onboarding");
  if (session?.user.platformRole === "SUPER_ADMIN") redirect("/admin");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-brand p-12 text-brand-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 text-lg font-bold">
          <span className="rounded-xl bg-white/15 p-1">
            <Logo compact />
          </span>
          Suvakta
        </div>
        <div className="mt-auto max-w-md space-y-6">
          <p className="text-4xl leading-tight font-semibold tracking-tight">Run your business by simply talking to it.</p>
          <div className="space-y-3 text-[15px] text-brand-foreground/85">
            {["“Aaj 20 Coke aur 10 Sprite biki”", "“Ramesh ne ₹500 diye”", "“Kaunsa product low stock hai?”"].map((q) => (
              <div key={q} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 backdrop-blur-sm">
                <span aria-hidden="true">🎙</span>
                {q}
              </div>
            ))}
          </div>
          <p className="text-sm text-brand-foreground/70">Sales · Stock · Khata · GST-ready · Works offline</p>
        </div>
        <div aria-hidden="true" className="absolute -top-24 -right-24 size-96 rounded-full bg-white/5" />
      </aside>
      <main className="flex min-h-dvh flex-col px-4 py-6 sm:px-8">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-8">{children}</div>
      </main>
    </div>
  );
}
