// SMS sending sits behind an interface so the provider can be chosen later
// (docs/system-design/03-architecture.md, "Vendor choices").

import { maskPhone } from "@dispatch/shared";

export interface SmsSender {
  send(to: string, message: string): Promise<void>;
}

/** Development: prints messages to the log instead of sending them. */
export class ConsoleSmsSender implements SmsSender {
  constructor(private readonly log: (msg: string) => void = console.log) {}

  async send(to: string, message: string): Promise<void> {
    this.log(`[sms → ${maskPhone(to)}] ${message}`);
  }
}

/** Tests: keeps messages in memory so they can be read back. */
export class MemorySmsSender implements SmsSender {
  readonly sent: { to: string; message: string }[] = [];

  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message });
  }

  /** The 6-digit code from the most recent message to this number. */
  lastCodeFor(to: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === to);
    const code = msg?.message.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`No OTP sent to ${to}`);
    return code;
  }
}
