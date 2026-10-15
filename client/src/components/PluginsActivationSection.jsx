/**
 * PluginsActivationSection — loads the plugins and wires the « Modules » card to the server
 * (specs/plugin-engine-backport.md rule 11): each switch activates or deactivates at once, then the
 * auth context is refreshed so the slots of that plugin appear or vanish without a reload.
 * Renders nothing until there is a plugin to list.
 */
import React, { useEffect, useState } from 'react';
import PluginActivationCard from './PluginActivationCard';
import { useAuth } from '../hooks/useAuth';
import api from '../api';

export default function PluginsActivationSection() {
  const { refresh } = useAuth();
  const [plugins, setPlugins] = useState([]);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { api.getPlugins().then(setPlugins).catch(() => {}); }, []);

  const toggle = async (id, enabled) => {
    setBusyId(id);
    try {
      await (enabled ? api.activatePlugin(id) : api.deactivatePlugin(id));
      setPlugins(await api.getPlugins());
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (plugins.length === 0) return null;
  return <PluginActivationCard plugins={plugins} busyId={busyId} onToggle={toggle} />;
}
