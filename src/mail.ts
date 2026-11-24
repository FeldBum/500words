// Outgoing email (password resets only), sent through Resend.
export type Mail = { to: string; subject: string; text: string; html: string };

export const mailer = {
  enabled(): boolean {
    return !!process.env.RESEND_API_KEY || process.env.MAIL_DEV === "log";
  },
  async send(mail: Mail): Promise<void> {
    if (process.env.MAIL_DEV === "log" && !process.env.RESEND_API_KEY) {
      console.log(`[mail to ${mail.to}] ${mail.subject}\n${mail.text}`);
      return;
    }
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    const from = process.env.MAIL_FROM || "500words <hello@500words.org>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function resetEmail(username: string, displayName: string, link: string): Omit<Mail, "to"> {
  const text = `Hi ${displayName},

Someone (hopefully you) asked to reset the password for your 500words account, @${username}.

Choose a new password here (the link works for one hour, once):
${link}

If you didn't ask for this, you can ignore this email — your password hasn't changed.

— 500words`;
  const html = `<div style="font-family:Georgia,'Palatino Linotype',serif;max-width:520px;margin:0 auto;padding:28px;color:#2b2420;background:#f6f0e4;border-radius:12px">
<p style="font-size:20px;margin:0 0 18px"><b style="color:#a9864f">500</b>words</p>
<p style="font-size:17px;line-height:1.55">Hi ${esc(displayName)},</p>
<p style="font-size:17px;line-height:1.55">Someone (hopefully you) asked to reset the password for your 500words account, <b>@${esc(username)}</b>.</p>
<p style="margin:26px 0"><a href="${esc(link)}" style="background:#2f5b4c;color:#f7f2e7;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:17px;display:inline-block">Choose a new password</a></p>
<p style="font-size:15px;line-height:1.5;color:#6b5d52">The link works once, for one hour. If you didn't ask for this, ignore this email — your password hasn't changed.</p>
</div>`;
  return { subject: "Reset your 500words password", text, html };
}
