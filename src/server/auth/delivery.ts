/**
 * Out-of-band message delivery (password reset today; OTP/WhatsApp/SMS later).
 * Implementations are chosen from the environment; business logic only sees the interface.
 */
import type { Logger } from "@/server/lib/logger";

export interface ResetRecipient {
  name: string;
  email: string | null;
  mobile: string;
}

export interface MessageDelivery {
  readonly channel: string;
  /** Returns true when the message was handed to a real transport. */
  sendPasswordReset(to: ResetRecipient, link: string): Promise<boolean>;
}

/** Development/test: writes the link to the log so developers can complete the flow. */
class LogDelivery implements MessageDelivery {
  readonly channel = "log";
  constructor(private logger: Logger) {}
  async sendPasswordReset(to: ResetRecipient, link: string) {
    this.logger.info("password reset link (dev delivery)", { to: to.mobile, resetLink: link });
    return true;
  }
}

/** Cloudflare Email Service via the `EMAIL` send_email binding. */
class EmailDelivery implements MessageDelivery {
  readonly channel = "email";
  constructor(
    private binding: NonNullable<Env["EMAIL"]>,
    private from: string,
    private logger: Logger,
  ) {}
  async sendPasswordReset(to: ResetRecipient, link: string) {
    if (!to.email) return false;
    try {
      await this.binding.send({
        from: this.from,
        to: to.email,
        subject: "Reset your DukaanOS password",
        text: `Namaste ${to.name},\n\nUse this link to set a new password (valid for 30 minutes):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
        html: `<p>Namaste ${escapeHtml(to.name)},</p><p>Use the link below to set a new password. It is valid for 30 minutes.</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
      });
      return true;
    } catch (err) {
      this.logger.error("password reset email failed", { error: String(err) });
      return false;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function getDelivery(env: Env, logger: Logger): MessageDelivery | null {
  if (env.EMAIL && env.EMAIL_FROM) return new EmailDelivery(env.EMAIL, env.EMAIL_FROM, logger);
  if (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") return new LogDelivery(logger);
  return null;
}
