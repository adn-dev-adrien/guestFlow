/**
 * The host alerts (specs/hosting-h1-fleet-runtime.md rules 16–17): opened by the probe or the weekly
 * restore, shown with the console's other alerts, emailed to the operators once — then again every
 * 24 h while they stay open, never every minute — and closed by themselves when the condition clears.
 */

const REPEAT_MS = 24 * 60 * 60 * 1000;

function createHostAlerts({ hosting, operators, mailer, now, consoleUrl, log = (msg) => console.log(msg) }) {
  const stamp = () => now().toISOString();

  return {
    open: ({ key, customerId = null, kind, severity = 'error', text }) => hosting.openAlert({ key, customerId, kind, severity, text, at: stamp() }),
    close: (key) => hosting.closeAlert(key, stamp()),
    list: () => hosting.openAlerts(),

    // Rule 17: what is due to be sent now — never sent, or last sent 24 h ago.
    due() {
      const t = now().getTime();
      return hosting.openAlerts().filter((a) => !a.last_sent_at || t - new Date(a.last_sent_at).getTime() >= REPEAT_MS);
    },

    async sendDue() {
      const due = this.due();
      if (!due.length) return 0;
      const recipients = operators.list();
      const text = [
        ...due.map((a) => `• ${a.text}${a.customer_id ? ` ${consoleUrl}/clients/${a.customer_id}` : ''}`),
        '',
        `Ouvrir la console : ${consoleUrl}/`,
      ].join('\n');
      // Sent as soon as one operator received it: a failing address never makes the others get
      // the same email every minute (review 2026-10-17).
      let delivered = 0;
      for (const op of recipients) {
        try {
          await mailer.send({ to: op.email, subject: `Console GuestFlow — ${due.length} alerte(s) d’hébergement`, text });
          delivered += 1;
        } catch (err) {
          log(`[alerts] email to ${op.email} failed: ${err.message}`);
        }
      }
      if (!delivered) return 0;
      for (const a of due) hosting.markAlertSent(a.key, stamp());
      return due.length;
    },
  };
}

module.exports = { createHostAlerts, REPEAT_MS };
