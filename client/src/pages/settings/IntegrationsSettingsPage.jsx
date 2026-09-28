/**
 * IntegrationsSettingsPage — Paramètres → Intégrations (specs/settings-rationalization.md rule 2).
 *
 * The connections to other services. The Neat card is core code; Google Agenda, the Météo-France key
 * and the Sowel gate-keys connector are the sections of their plugin modules (slot
 * `settings.integrations`, specs/plugins-phase-1-sdk.md rule 13), ordered around Neat by their
 * `order`. A card with a draft (Neat, Météo) has no Save of its own: the bar saves it through its ref.
 */
import React, { Suspense, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsNeatSection from '../../components/SettingsNeatSection';
import PluginGate from '../../components/PluginGate';
import { NEAT } from '../../constants/plugins';
import { useSlot } from '../../plugins/sdk/useSlot';

const NEAT_ORDER = 20;

export default function IntegrationsSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: [], navigate });
  const { setExternalDirty } = form;
  const sections = useSlot('settings.integrations');
  // Every card with a draft: Neat (core) and the plugin sections that expose save/reset.
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

  const before = sections.filter((s) => (s.order ?? 100) < NEAT_ORDER);
  const after = sections.filter((s) => (s.order ?? 100) >= NEAT_ORDER);
  const renderSection = ({ key, pluginId, Component }) => (
    <Suspense key={`${pluginId}:${key}`} fallback={null}>
      <Component {...bindCard(`${pluginId}:${key}`)} />
    </Suspense>
  );

  return (
    <SettingsFormPage title="Intégrations" form={form} onSave={handleSave} onCancel={handleCancel}>
      {before.map(renderSection)}
      <PluginGate id={NEAT}><SettingsNeatSection {...bindCard('neat')} /></PluginGate>
      {after.map(renderSection)}
    </SettingsFormPage>
  );
}
