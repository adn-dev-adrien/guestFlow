// Top-level entries of the side menu that plugin modules add (slot `nav.items`, specs/plugins-phase-1-sdk.md
// rule 13): `{ path, label, Icon, after }`, drawn right after the core entry whose path is `after` (else after
// « Calendrier », the end of the day-to-day group). Each is visible through `canSeeRoute`, like every page — its
// plugin active, its roles allowed. A page under a submenu uses that submenu's own slot (`calendar.menu`, …).
import React from 'react';
import PLUGIN_MODULES from '../plugins';

export const NAV_ENTRIES = PLUGIN_MODULES.flatMap((mod) => ((mod.contributes && mod.contributes['nav.items']) || [])
  .map((entry) => ({ ...entry, pluginId: mod.id })));

/** The core items with the plugin entries placed after their anchor. */
export function withPluginEntries(coreItems, entries = NAV_ENTRIES) {
  const out = [];
  const placed = new Set();
  coreItems.forEach((item) => {
    out.push(item);
    entries.filter((e) => e.after === item.path).forEach((e) => {
      out.push({ label: e.label, path: e.path, icon: e.Icon ? React.createElement(e.Icon) : null });
      placed.add(e.path);
    });
  });
  const rest = entries.filter((e) => !placed.has(e.path));
  const anchor = out.findIndex((item) => item.path === '/calendar');
  out.splice(anchor < 0 ? out.length : anchor + 1, 0, ...rest.map((e) => ({ label: e.label, path: e.path, icon: e.Icon ? React.createElement(e.Icon) : null })));
  return out;
}
