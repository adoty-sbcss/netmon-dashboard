/**
 * Email transport — the single seam the whole app sends through (alerts +
 * summary reports). Uses Azure Communication Services when configured
 * (ACS_CONNECTION_STRING set), and otherwise falls back to a LOG provider that
 * records what WOULD be sent — so the alert + report pipeline can be built and
 * exercised before the secret is wired, and a missing config can never crash a
 * request path.
 *
 * No `server-only` + no DB imports, so the scheduled report Job can import this
 * under tsx (same constraint as the other cron-path modules).
 */
import { EmailClient } from "@azure/communication-email";

/** Basic email-shape validation, shared by the user-admin + notification recipient forms. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export interface EmailMessage {
  to: string[];
  subject: string;
  /** HTML body. */
  html: string;
  /** Optional plaintext fallback. */
  text?: string;
  /** Optional category for logging / throttling, e.g. 'alert' | 'report'. */
  tag?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  /** 'acs' | 'log' | 'none' — which path handled it. */
  provider: string;
  error?: string;
}

// The Azure-managed domain's pre-provisioned sender. Override with EMAIL_FROM
// once a branded sbcss.net subdomain is verified on the ACS email service.
const DEFAULT_FROM = "donotreply@d2f9b17e-036b-4db4-a8db-4b5e48ecc94d.azurecomm.net";

function senderAddress(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

/** True when a real (ACS) transport is configured; false ⇒ the log fallback. */
export function emailConfigured(): boolean {
  return Boolean(process.env.ACS_CONNECTION_STRING);
}

async function sendViaAcs(msg: EmailMessage): Promise<SendResult> {
  const client = new EmailClient(process.env.ACS_CONNECTION_STRING as string);
  const poller = await client.beginSend({
    senderAddress: senderAddress(),
    content: {
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { plainText: msg.text } : {}),
    },
    recipients: { to: msg.to.map((address) => ({ address })) },
  });
  const result = await poller.pollUntilDone();
  return {
    ok: result.status === "Succeeded",
    id: result.id,
    provider: "acs",
    error: result.error?.message,
  };
}

function logEmail(msg: EmailMessage): SendResult {
  console.log(
    `[email:log] (ACS not configured) would send tag=${msg.tag ?? "-"} ` +
      `to=${msg.to.join(",")} from=${senderAddress()} ` +
      `subject=${JSON.stringify(msg.subject)} (${msg.html.length} chars html)`,
  );
  return { ok: true, provider: "log" };
}

/**
 * Send an email. NEVER throws — returns a SendResult. Uses ACS when configured,
 * otherwise logs, so callers (alerts, reports) don't special-case setup state.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!msg.to || msg.to.length === 0) {
    return { ok: false, provider: "none", error: "no recipients" };
  }
  if (!emailConfigured()) return logEmail(msg);
  try {
    const res = await sendViaAcs(msg);
    if (!res.ok) {
      console.warn(
        `[email:acs] send FAILED tag=${msg.tag ?? "-"} to=${msg.to.length} recipient(s) error=${res.error ?? "unknown"}`,
      );
    }
    return res;
  } catch (e) {
    const error = (e as Error).message;
    console.warn(`[email:acs] send THREW tag=${msg.tag ?? "-"} to=${msg.to.length} recipient(s) error=${error}`);
    return { ok: false, provider: "acs", error };
  }
}
