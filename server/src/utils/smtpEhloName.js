/**
 * The name an SMTP client greets its server with (specs/admin-account-management.md rule 21): the domain of the address
 * the mail is sent From, lower-cased, never nodemailer's default (the machine's hostname, `[127.0.0.1]` on a VM), which
 * receiving filters read in the `Received` header as a sender that does not know its own name. Shared by the instance's
 * transports (utils/emailService) and the console's (control-plane mailer, through utils/gf). Accepts a bare address
 * or « Name <address> »; '' when no domain can be read (the caller then keeps nodemailer's default).
 */
function ehloName(from) {
  const text = String(from || '').trim();
  const bracketed = /<([^<>]*)>\s*$/.exec(text);
  const address = bracketed ? bracketed[1].trim() : text;
  const domain = address.split('@')[1] || '';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain) ? domain.toLowerCase() : '';
}

module.exports = { ehloName };
