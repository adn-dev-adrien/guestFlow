/**
 * IntegrationsSettingsPage — Paramètres → Intégrations (specs/settings-rationalization.md rule 2).
 *
 * The connections to other services: Google Agenda, Neat, the Météo-France key and the Sowel gate-keys
 * connector are the sections of their plugin modules (slot `settings.integrations`,
 * specs/plugins-phase-1-sdk.md rule 13; Neat since specs/plugins-phase-3b-neat.md rule 15), in their
 * `order`. A card with a draft (Neat, Météo) has no Save of its own: the bar saves it through its ref.
 *
 * specs/plugins-phase-0-foundation.md rule 25 — each plugin's first section carries the anchor
 * `#plugin-<id>` the Plugins card's « Configurer » opens, scrolled into view below the sticky bars
 * and kept there while the later sections load (rule 26).
 */
import React, { Suspense, useCallback, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Box } from '@mui/material';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import { useSlot } from '../../plugins/sdk/useSlot';
import useAnchorScroll from '../../hooks/useAnchorScroll';

export default function IntegrationsSettingsPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const form = useSettingsForm({ groups: [], navigate });
  const { setExternalDirty } = form;
  const sections = useSlot('settings.integrations');
  // Every plugin section that exposes save/reset.
  const cardRefs = useRef({});
  const [dirtyCards, setDirtyCards] = useState({});
  const handleDirty = useCallback((key) => (dirty) => {
    setDirtyCards((prev) => {
      if (Boolean(prev[key]) === dirty) return prev;
      const next = { ...prev, [key]: dirty };
      setExternalDirty(Object.values(next).some(Boolean));
      return next;
    });
  }, [setExternalDirty]);

  const handleSave = () => form.save({
    afterSettings: async () => {
      for (const [key, card] of Object.entries(cardRefs.current)) {
        if (card && dirtyCards[key]) await card.save();
      }
    },
  });

  const handleCancel = () => {
    form.cancel();
    Object.values(cardRefs.current).forEach((card) => { if (card && card.reset) card.reset(); });
  };

  const bindCard = (key) => ({
    ref: (el) => { cardRefs.current[key] = el; },
    onDirtyChange: handleDirty(key),
  });

  // The sections load lazily and grow as their data arrives: the anchor is placed once it exists and
  // kept in place while the page settles (specs/plugins-phase-0-foundation.md rule 26).
  useAnchorScroll(hash, { prefix: '#plugin-' });

  const anchored = new Set();
  const renderSection = ({ key, pluginId, Component }) => {
    const first = !anchored.has(pluginId);
    anchored.add(pluginId);
    return (
      <Box key={`${pluginId}:${key}`} id={first ? `plugin-${pluginId}` : undefined}>
        <Suspense fallback={null}>
          <Component {...bindCard(`${pluginId}:${key}`)} />
        </Suspense>
      </Box>
    );
  };

  return (
    <SettingsFormPage title="Intégrations" form={form} onSave={handleSave} onCancel={handleCancel}>
      {sections.map(renderSection)}
    </SettingsFormPage>
  );
}
