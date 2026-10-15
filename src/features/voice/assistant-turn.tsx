"use client";
import { AlertTriangleIcon, ArrowRightIcon, CheckCircle2Icon, InfoIcon, PencilIcon, SparklesIcon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Money, Qty } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssistantResponse } from "@/lib/api-types";
import { cn } from "@/lib/utils";

interface TurnHandlers {
  onConfirm: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onClarify: (choice: { optionId?: string; text?: string; slot?: string }) => void;
  busy: "confirm" | "clarify" | "cancel" | null;
}

/** Renders one assistant response: answer, clarification, confirmation card, result or error. */
export function AssistantTurn({ response, handlers, compact }: { response: AssistantResponse; handlers: TurnHandlers; compact?: boolean }) {
  const r = response;
  return (
    <div className="animate-rise space-y-3">
      {r.contextNote && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <InfoIcon className="size-3.5" aria-hidden="true" /> {r.contextNote}
        </p>
      )}
      {r.status === "PROPOSED" && r.proposal && <ConfirmationCard response={r} handlers={handlers} />}
      {r.status === "NEEDS_CLARIFICATION" && r.clarification && <ClarifyCard response={r} handlers={handlers} />}
      {r.status === "ANSWERED" && <AnswerCard response={r} />}
      {r.status === "CONFIRMED" && <DoneCard response={r} />}
      {r.status === "FAILED" && <ErrorCard response={r} />}
      {(r.status === "CANCELLED" || r.status === "EXPIRED") && (
        <p className="rounded-xl bg-muted px-3.5 py-2.5 text-[13.5px] text-muted-foreground">{r.status === "CANCELLED" ? "Cancelled — nothing was saved." : "This request expired — nothing was saved."}</p>
      )}
      {!compact && r.status === "PROPOSED" && r.expiresAt && <p className="text-center text-[11.5px] text-muted-foreground">Nothing is saved until you confirm.</p>}
    </div>
  );
}

function ConfirmationCard({ response, handlers }: { response: AssistantResponse; handlers: TurnHandlers }) {
  const p = response.proposal!;
  const v = p.view;
  return (
    <section aria-label="Confirm action" className="overflow-hidden rounded-2xl border bg-card shadow-lift">
      <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
        <div>
          <p className="text-[12px] font-medium text-muted-foreground">{response.message || "I understood:"}</p>
          <h3 className="text-[16px] font-semibold">{v.title}</h3>
        </div>
        {p.needsReview && <Badge variant="warning">Please check</Badge>}
      </header>
      <div className="space-y-3 px-4 py-3">
        <ul className="space-y-2">
          {v.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{l.label}</p>
                {l.detail && <p className="text-[12.5px] text-muted-foreground">{l.detail}</p>}
              </div>
              {l.amountPaise !== undefined && <Money paise={l.amountPaise} className="text-[15px] font-medium" />}
            </li>
          ))}
        </ul>
        {v.totals.length > 0 && (
          <dl className="space-y-1 border-t pt-2.5">
            {v.totals.map((t, i) => (
              <div key={i} className={cn("flex justify-between", t.emphasis ? "text-[17px] font-bold" : "text-[13.5px] text-muted-foreground")}>
                <dt>{t.label}</dt>
                <dd>
                  <Money paise={t.amountPaise} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {v.autoPicks?.map((a) => (
          <div key={a.slot} className="rounded-xl border border-dashed px-3 py-2.5 text-[13px]">
            <p>
              Picked <strong>{a.chosenName}</strong> for “{a.query}” <span className="text-muted-foreground">({a.reason})</span>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Other matches for ${a.query}`}>
              {a.options
                .filter((o) => o.id !== a.chosenId)
                .map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={handlers.busy !== null}
                    onClick={() => handlers.onClarify({ slot: a.slot, optionId: o.id })}
                    className="h-9 rounded-full border bg-background px-3 text-[12.5px] font-medium hover:border-primary hover:bg-primary-soft disabled:opacity-50"
                  >
                    {o.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
        {v.stockImpact.length > 0 && (
          <div className="rounded-xl bg-muted/60 p-3">
            <p className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Stock impact</p>
            <ul className="space-y-1">
              {v.stockImpact.map((s, i) => {
                const delta = s.afterMilli - s.beforeMilli;
                return (
                  <li key={i} className="flex items-center justify-between gap-2 text-[13.5px]">
                    <span className="truncate">{s.name}</span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <Qty milli={s.beforeMilli} />
                      <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="becomes" />
                      <Qty milli={s.afterMilli} unit={s.unit} className={s.afterMilli <= 0 ? "font-semibold text-destructive" : "font-semibold"} />
                      <span className={cn("text-[12px] font-semibold", delta < 0 ? "text-destructive" : "text-success")}>
                        ({delta > 0 ? "+" : ""}
                        <Qty milli={delta} />)
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {v.notes.length > 0 && (
          <ul className="space-y-0.5 text-[13px] text-muted-foreground">
            {v.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {v.warnings.map((w, i) => (
          <p key={i} className="flex gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {w}
          </p>
        ))}
      </div>
      <footer className="grid gap-2 border-t p-3">
        <Button size="lg" className="w-full" onClick={handlers.onConfirm} loading={handlers.busy === "confirm"} disabled={handlers.busy !== null && handlers.busy !== "confirm"}>
          <CheckCircle2Icon /> {v.confirmLabel}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={handlers.onEdit} disabled={handlers.busy !== null}>
            <PencilIcon /> Edit
          </Button>
          <Button variant="ghost" onClick={handlers.onCancel} loading={handlers.busy === "cancel"} disabled={handlers.busy !== null && handlers.busy !== "cancel"}>
            <XIcon /> Cancel
          </Button>
        </div>
      </footer>
    </section>
  );
}

function ClarifyCard({ response, handlers }: { response: AssistantResponse; handlers: TurnHandlers }) {
  const c = response.clarification!;
  const [text, setText] = React.useState("");
  return (
    <section aria-label="Question" className="rounded-2xl border bg-card p-4 shadow-soft">
      <p className="mb-3 text-[16px] font-semibold">{c.question}</p>
      {c.options.length > 0 && (
        <div className="grid gap-2">
          {c.options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              disabled={handlers.busy !== null}
              onClick={() => handlers.onClarify({ optionId: o.id })}
              className="flex min-h-12 items-center gap-3 rounded-xl border bg-background px-3.5 py-2 text-left transition-colors hover:border-primary hover:bg-primary-soft disabled:opacity-50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[13px] font-bold">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{o.label}</span>
                {o.sublabel && <span className="block text-[12.5px] text-muted-foreground">{o.sublabel}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {c.allowText && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) handlers.onClarify({ text: text.trim() });
          }}
        >
          <Input inputMode="decimal" placeholder={c.allowText === "amount" ? "Amount in ₹" : "Quantity"} value={text} onChange={(e) => setText(e.target.value)} aria-label={c.question} autoFocus />
          <Button type="submit" loading={handlers.busy === "clarify"}>
            OK
          </Button>
        </form>
      )}
      <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={handlers.onCancel} disabled={handlers.busy !== null}>
        Cancel
      </Button>
    </section>
  );
}

function AnswerCard({ response }: { response: AssistantResponse }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-soft">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
        <SparklesIcon className="size-3.5" aria-hidden="true" /> Suvakta
      </p>
      <p className="mt-1.5 text-[15.5px] leading-relaxed whitespace-pre-line">{response.message}</p>
      {response.answer?.actions?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {response.answer.actions.map((a) => (
            <Button key={a.href} asChild variant="soft" size="sm">
              <Link href={a.href}>{a.label}</Link>
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DoneCard({ response }: { response: AssistantResponse }) {
  return (
    <section role="status" className="flex gap-3 rounded-2xl border border-success/30 bg-success-soft p-4">
      <CheckCircle2Icon className="size-7 shrink-0 text-success" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[15.5px] font-semibold whitespace-pre-line">{response.message}</p>
        {response.result?.href && (
          <Link href={response.result.href} className="mt-1 inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
            View <ArrowRightIcon className="size-3.5" />
          </Link>
        )}
      </div>
    </section>
  );
}

function ErrorCard({ response }: { response: AssistantResponse }) {
  return (
    <section role="alert" className="rounded-2xl border border-warning/30 bg-warning-soft p-4">
      <p className="flex gap-2 text-[15px] font-medium text-warning-foreground">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="whitespace-pre-line">{response.message}</span>
      </p>
      {response.answer?.actions?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {response.answer.actions.map((a) => (
            <Button key={a.href} asChild variant="outline" size="sm">
              <Link href={a.href}>{a.label}</Link>
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
