/**
 * IntegrationsSettingsPage — Paramètres → Intégrations (specs/settings-rationalization.md rule 2).
 *
 * The connections to other services: Google Agenda (self-contained OAuth card), the Neat
 * cancellation insurance (its own endpoints, written by this page's Save), the Météo-France key
 * (a masked setting of the settings form), and the Sowel gate-keys connector — a read-only card
 * (specs/gate-access-sowel-connector.md §3.6 rule 29).
 *
 * Then the sections of the plugin modules (slot `settings.integrations`) and the « Modules » card that
 * switches them on and off (specs/plugin-engine-backport.md rule 11). A card with a draft has no Save of
 * its own: the bar saves it through its ref.
 */
import React, { Suspense, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsGoogleCalendarSection from '../../components/SettingsGoogleCalendarSection';
import SettingsNeatSection from '../../components/SettingsNeatSection';
import SettingsWeatherSection from '../../components/SettingsWeatherSection';
import SettingsGateAccessSection from '../../components/SettingsGateAccessSection';
import PluginsActivationSection from '../../components/PluginsActivationSection';
import { useSlot } from '../../plugins/sdk/useSlot';

export default function IntegrationsSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['weather'], navigate });
  const { setExternalDirty } = form;
  const sections = useSlot('settings.integrations');
  // The Neat card and every plugin section that exposes save/reset keep their own data and endpoints but
  // not their own Save (specs/settings-one-save-and-automatic-webhook.md rules 1-4).
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
  const bindCard = (key) => ({
    ref: (el) => { cardRefs.current[key] = el; },
    onDirtyChange: handleDirty(key),
  });

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

  return (
    <SettingsFormPage title="Intégrations" form={form} onSave={handleSave} onCancel={handleCancel}>
      <SettingsGoogleCalendarSection />
      <SettingsNeatSection {...bindCard('neat')} />
      <SettingsWeatherSection
        values={form.draft.weather}
        onChangeApiKey={(value) => form.setField('weather', 'apiKeyDraft', value)}
      />
      <SettingsGateAccessSection />
      {sections.map(({ key, pluginId, Component }) => (
        <Suspense key={`${pluginId}:${key}`} fallback={null}>
          <Component {...bindCard(`${pluginId}:${key}`)} />
        </Suspense>
      ))}
      <PluginsActivationSection />
    </SettingsFormPage>
  );
}
