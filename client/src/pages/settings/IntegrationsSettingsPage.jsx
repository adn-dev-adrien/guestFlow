/**
 * IntegrationsSettingsPage — Paramètres → Intégrations (specs/settings-rationalization.md rule 2).
 *
 * The connections to other services: Google Agenda, Neat, the Météo-France key and the Sowel gate-keys
 * connector are the sections of their plugin modules (slot `settings.integrations`,
 * specs/plugins-phase-1-sdk.md rule 13; Neat since specs/plugins-phase-3b-neat.md rule 15), in their
 * `order`. A card with a draft (Neat, Météo) has no Save of its own: the bar saves it through its ref.
 */
import React, { Suspense, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import { useSlot } from '../../plugins/sdk/useSlot';

export default function IntegrationsSettingsPage() {
  const navigate = useNavigate();
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

  const renderSection = ({ key, pluginId, Component }) => (
    <Suspense key={`${pluginId}:${key}`} fallback={null}>
      <Component {...bindCard(`${pluginId}:${key}`)} />
    </Suspense>
  );

  return (
    <SettingsFormPage title="Intégrations" form={form} onSave={handleSave} onCancel={handleCancel}>
      {sections.map(renderSection)}
    </SettingsFormPage>
  );
}
