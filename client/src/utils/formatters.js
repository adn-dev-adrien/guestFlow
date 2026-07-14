/**
 * Shared display formatters (specs/design-system.md §3.7) — the ONLY place client code formats money
 * and dates for display. Role-based: pick the named role, never re-implement locally.
 *
 *   formatCurrency         12,50 € / 1 234,50 €   — rows, totals, any exact amount
 *   formatCurrencyRounded  1 235 €                — KPI tiles & chart labels (overview style)
 *   displayDate            10/07/2026             — plain date columns/fields
 *   displayDateShort       10 juil. 2026          — compact humanized (alert cards, dialogs)
 *   displayDateLong        10 juillet 2026        — prose-like contexts (SAS, notices)
 *   displayDateTime        10/07/2026 14:35       — timestamps (history, logs)
 *
 * Amounts use REGULAR spaces (grouping + before €) on purpose — not Intl's narrow no-break spaces —
 * so rendered strings stay greppable/assertable and match the app's historical output.
 */

export function formatCurrency(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const rounded = Math.round(num * 100) / 100;
  const [int, dec] = Math.abs(rounded).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '-' : ''}${grouped},${dec} €`;
}

export function formatCurrencyRounded(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const rounded = Math.round(num);
  const grouped = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '-' : ''}${grouped} €`;
}

export function displayDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export function displayDateShort(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function displayDateLong(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function displayDateTime(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
