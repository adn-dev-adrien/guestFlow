/**
 * IntegrationsSettingsPage — Paramètres → Intégrations (specs/settings-rationalization.md rule 2).
 *
 * The connections to other services are the sections plugin modules contribute to the slot
 * `settings.integrations` (specs/plugins-phase-1-sdk.md rule 13), one tab per plugin
 * (specs/integrations-tab-per-plugin.md): a plugin's sections share its tab, in their `order`, and a
 * single plugin draws no tab strip. The open tab is the URL's `?tab=<pluginId>`; the older
 * `#plugin-<id>` anchor and the Google OAuth return (`?google=…`) open their plugin's tab.
 *
 * A section mounts the first time its tab opens and stays mounted, so a draft survives a switch. A
 * card with a draft (Neat, Météo) has no Save of its own: the bar saves every dirty card, tab by
 * tab, and stops on the first refusal, which opens its tab.
 */
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Box } from '@mui/material';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import PageTabs from '../../components/PageTabs';
import TabDot from '../../components/TabDot';
import { useSlot } from '../../plugins/sdk/useSlot';
import { GOOGLE_CALENDAR } from '../../constants/plugins';
import api from '../../api';

const ANCHOR_PREFIX = '#plugin-';

/** Rule 1 — the contributions grouped by plugin, in the order of each plugin's first section. */
function tabsOf(sections) {
  const byPlugin = new Map();
  sections.forEach((section) => {
    if (!byPlugin.has(section.pluginId)) byPlugin.set(section.pluginId, []);
    byPlugin.get(section.pluginId).push(section);
  });
  return [...byPlugin.entries()].map(([pluginId, own]) => ({
    pluginId,
    sections: own,
    tabLabel: (own.find((s) => s.tabLabel) || {}).tabLabel || null,
  }));
}

// Rule 6 — `#plugin-<id>`; a hash that does not decode is read as typed.
function anchorId(hash) {
  if (!String(hash || '').startsWith(ANCHOR_PREFIX)) return null;
  const raw = hash.slice(ANCHOR_PREFIX.length);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export default function IntegrationsSettingsPage() {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const form = useSettingsForm({ groups: [], navigate });
  const { setExternalDirty } = form;
  const tabs = tabsOf(useSlot('settings.integrations'));
  const ids = tabs.map((t) => t.pluginId);
  const strip = tabs.length > 1;

  // Rules 5–7 — the URL names the tab; an old anchor or the Google return stand in for it.
  const params = new URLSearchParams(search);
  const asked = [params.get('tab'), anchorId(hash), params.get('google') ? GOOGLE_CALENDAR : null]
    .find((id) => id && ids.includes(id));
  const tab = asked || ids[0] || null;

  useEffect(() => {
    if (!tab) return;
    const next = new URLSearchParams(search);
    if (strip) next.set('tab', tab); else next.delete('tab');
    if (next.toString() === new URLSearchParams(search).toString() && !hash) return;
    navigate({ pathname, search: next.toString() ? `?${next}` : '', hash: '' }, { replace: true });
  }, [tab, strip, pathname, search, hash, navigate]);

  const selectTab = useCallback((id) => {
    const next = new URLSearchParams(search);
    next.set('tab', id);
    navigate({ pathname, search: `?${next}` }, { replace: true });
  }, [pathname, search, navigate]);

  // Rule 9 — a tab's sections mount at its first opening and stay.
  const [opened, setOpened] = useState(() => new Set());
  useEffect(() => {
    if (tab && !opened.has(tab)) setOpened((prev) => new Set(prev).add(tab));
  }, [tab, opened]);

  // Rules 4 and 11 — the catalogue names and setup states, as the Plugins page reads them.
  const [catalogue, setCatalogue] = useState({});
  const loadCatalogue = useCallback(() => api.getPlugins()
    .then((list) => setCatalogue(Object.fromEntries((list || []).map((p) => [p.id, p]))))
    .catch(() => {}), []);
  useEffect(() => { loadCatalogue(); }, [loadCatalogue]);

  const cardRefs = useRef({});
  const [dirtyCards, setDirtyCards] = useState({});
  const [refused, setRefused] = useState(null);
  const handleDirty = useCallback((key) => (dirty) => {
    setDirtyCards((prev) => {
      if (Boolean(prev[key]) === dirty) return prev;
      const next = { ...prev, [key]: dirty };
      setExternalDirty(Object.values(next).some(Boolean));
      return next;
    });
  }, [setExternalDirty]);

  // Rule 10 — every dirty card, tab by tab; the first refusal stops the run and opens its tab.
  const handleSave = async () => {
    setRefused(null);
    await form.save({
      afterSettings: async () => {
        for (const { pluginId, sections } of tabs) {
          for (const { key } of sections) {
            const card = cardRefs.current[`${pluginId}:${key}`];
            if (!card || !dirtyCards[`${pluginId}:${key}`]) continue;
            try {
              await card.save();
            } catch (err) {
              setRefused(pluginId);
              if (pluginId !== tab) selectTab(pluginId);
              throw err;
            }
          }
        }
      },
    });
    loadCatalogue();
  };

  const handleCancel = () => {
    form.cancel();
    setRefused(null);
    Object.values(cardRefs.current).forEach((card) => { if (card && card.reset) card.reset(); });
  };

  const bindCard = (key) => ({
    ref: (el) => { cardRefs.current[key] = el; },
    onDirtyChange: handleDirty(key),
  });

  // Rule 11 — one dot at a time: refused, then modified, then still to set up.
  const dotOf = (pluginId) => {
    if (refused === pluginId) return <TabDot color="error" label="refusé" />;
    if (Object.entries(dirtyCards).some(([key, dirty]) => dirty && key.startsWith(`${pluginId}:`))) {
      return <TabDot color="primary" label="modifié" />;
    }
    const setup = catalogue[pluginId] && catalogue[pluginId].setup;
    return setup && setup.needed ? <TabDot color="warning" label="à configurer" /> : null;
  };

  const labelOf = (t) => t.tabLabel || (catalogue[t.pluginId] && catalogue[t.pluginId].name) || t.pluginId;

  return (
    <SettingsFormPage
      title="Intégrations"
      form={form}
      onSave={handleSave}
      onCancel={handleCancel}
      tabs={strip ? (
        <PageTabs
          value={tab}
          onChange={selectTab}
          items={tabs.map((t) => ({ value: t.pluginId, label: labelOf(t), badge: dotOf(t.pluginId) }))}
          ariaLabel="Intégrations"
        />
      ) : null}
    >
      {tabs.filter((t) => t.pluginId === tab || opened.has(t.pluginId)).map((t) => (
        <Box
          key={t.pluginId}
          role={strip ? 'tabpanel' : undefined}
          aria-label={strip ? labelOf(t) : undefined}
          hidden={t.pluginId !== tab}
          sx={{
            animation: 'gfIntegrationTabIn 160ms ease-out',
            '@keyframes gfIntegrationTabIn': { from: { opacity: 0 }, to: { opacity: 1 } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {t.sections.map(({ key, Component }) => (
            <Suspense key={key} fallback={null}>
              <Component {...bindCard(`${t.pluginId}:${key}`)} />
            </Suspense>
          ))}
        </Box>
      ))}
    </SettingsFormPage>
  );
}
