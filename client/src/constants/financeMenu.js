/**
 * The « Suivi financier » submenu. The core's entries, then those plugin modules contribute to the
 * slot `finance.menu` (specs/plugins-phase-2-hosts.md rule 19), ranked by `order`. The sidebar, the
 * parent's visibility and « is this a finance page? » all read this list.
 *
 * Entry: { key, path, label, order, roles? } — `roles` narrows who sees the entry; the route's own
 * roles (constants/roles.js ROUTE_ROLES, or the contributed route's) and its plugin still apply.
 */
import PLUGIN_MODULES from '../plugins';
import { ADMIN, userHasRole, canSeeRoute } from './roles';
import { ACCOUNTING_EXPORT, isPluginEnabled } from './plugins';

export const COMPENSATIONS_PATH = '/finance/indemnites';

const CORE_ENTRIES = [
  { key: 'overview', path: '/finance', label: 'Vue générale', order: 10 },
  { key: 'tourist-tax', path: '/finance/tourist-tax', label: 'Taxe de séjour', order: 20 },
  // specs/plugins-phase-2-hosts.md rule 21 — core, after « Taxe de séjour ».
  { key: 'compensations', path: COMPENSATIONS_PATH, label: "Indemnités d'annulation", order: 30 },
];

export function financeMenu(modules = PLUGIN_MODULES) {
  const contributed = modules.flatMap((mod) => ((mod.contributes && mod.contributes['finance.menu']) || [])
    .map((entry) => ({ ...entry, pluginId: mod.id })));
  return [...CORE_ENTRIES, ...contributed].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export const FINANCE_MENU = financeMenu();

/** Every path under « Suivi financier » — for the parent's visibility. */
export const FINANCE_PATHS = FINANCE_MENU.map((entry) => entry.path);

/**
 * Whether `user` sees `entry`. The accountant's way into the finance pages is the accounting export
 * (rules 3, 21): without it, a non-admin account sees none of them.
 */
export function canSeeFinanceEntry(user, entry) {
  if (!canSeeRoute(user, entry.path)) return false;
  if (entry.roles && !entry.roles.some((role) => userHasRole(user, role))) return false;
  return userHasRole(user, ADMIN) || isPluginEnabled(user, ACCOUNTING_EXPORT);
}

/** True when the current page belongs to « Suivi financier » (opens the submenu, highlights the parent). */
export function isFinancePath(pathname) {
  return pathname.startsWith('/finance') || FINANCE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
