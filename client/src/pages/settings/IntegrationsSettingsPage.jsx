/**
 * IntegrationsSettingsPage — Paramètres → Intégrations (specs/settings-rationalization.md rule 2).
 *
 * The connections to other services: Google Agenda (self-contained OAuth card), the Neat
 * cancellation insurance (its own endpoints, written by this page's Save), the Météo-France key
 * (a masked setting of the settings form), and the Sowel gate-keys connector — a read-only card
 * (specs/gate-access-sowel-connector.md §3.6 rule 29).
 */
import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import useSettingsForm from '../../hooks/useSettingsForm';
import SettingsFormPage from '../../components/SettingsFormPage';
import SettingsGoogleCalendarSection from '../../components/SettingsGoogleCalendarSection';
import SettingsNeatSection from '../../components/SettingsNeatSection';
import SettingsWeatherSection from '../../components/SettingsWeatherSection';
import SettingsGateAccessSection from '../../components/SettingsGateAccessSection';
import PluginGate from '../../components/PluginGate';
import { GOOGLE_CALENDAR, NEAT, WEATHER_ALERTS, GATE_ACCESS } from '../../constants/plugins';

export default function IntegrationsSettingsPage() {
  const navigate = useNavigate();
  const form = useSettingsForm({ groups: ['weather'], navigate });
  const { setExternalDirty } = form;
  // The Neat card keeps its own data and endpoints but not its own Save
  // (specs/settings-one-save-and-automatic-webhook.md rules 1-4).
  const neatRef = useRef(null);
  const [neatDirty, setNeatDirty] = useState(false);
  const handleNeatDirty = useCallback((dirty) => {
    setNeatDirty(dirty);
    setExternalDirty(dirty);
  }, [setExternalDirty]);

  const handleSave = () => form.save({
    afterSettings: async () => {
      if (neatDirty && neatRef.current) await neatRef.current.save();
    },
  });

  const handleCancel = () => {
    form.cancel();
    if (neatRef.current) neatRef.current.reset();
  };

  return (
    <SettingsFormPage title="Intégrations" form={form} onSave={handleSave} onCancel={handleCancel}>
      {/* One section per plugin (specs/plugins-phase-0-foundation.md rules 16-17). */}
      <PluginGate id={GOOGLE_CALENDAR}><SettingsGoogleCalendarSection /></PluginGate>
      <PluginGate id={NEAT}><SettingsNeatSection ref={neatRef} onDirtyChange={handleNeatDirty} /></PluginGate>
      <PluginGate id={WEATHER_ALERTS}>
        <SettingsWeatherSection
          values={form.draft.weather}
          onChangeApiKey={(value) => form.setField('weather', 'apiKeyDraft', value)}
        />
      </PluginGate>
      <PluginGate id={GATE_ACCESS}><SettingsGateAccessSection /></PluginGate>
    </SettingsFormPage>
  );
}
