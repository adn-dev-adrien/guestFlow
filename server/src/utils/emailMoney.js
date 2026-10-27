/**
 * One way to write an amount in a guest e-mail (specs/email-language-fr-en.md rules 4 and 10). Pure.
 *
 *   emailAmount(amount, lang)
 *     fr → « 1 234,56 € », « 45,50 € », « 500 € » — thousands grouped with a narrow no-break space
 *          (U+202F), a space before the sign, no « ,00 » on a whole amount
 *     en → « €1,234.56 », « €45.50 », « €500 »
 *
 * Every amount of the e-mail context (stay amount, deposit, balance, caution, complement, the prices
 * of the stay texts) goes through it, so « caution de 500 € » no longer sits beside « 45 € » written
 * « 500,00 € ».
 */

const NARROW_NBSP = '\u202F';

function group(digits, sep) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function emailAmount(amount, lang = 'fr') {
  const cents = Math.round(Number(amount || 0) * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100));
  const rest = abs % 100;
  const en = lang === 'en';
  const units = group(whole, en ? ',' : NARROW_NBSP);
  const decimals = rest ? `${en ? '.' : ','}${String(rest).padStart(2, '0')}` : '';
  return en ? `${sign}€${units}${decimals}` : `${sign}${units}${decimals} €`;
}

module.exports = { emailAmount, NARROW_NBSP };
