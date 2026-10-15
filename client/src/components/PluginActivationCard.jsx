/**
 * PluginActivationCard — the list of optional modules with an Activer / Désactiver switch each
 * (specs/plugin-engine-backport.md rule 11). Renders only: the page loads the list and owns the calls.
 * Replaced by the Plugins page when the plugins branch lands.
 *
 * Props:
 *   plugins:  Array<{ id, name, description, enabled }>      (required)
 *   busyId?:  string                                         id of the plugin whose switch is in flight
 *   onToggle: (id: string, enabled: boolean) => void         (required)
 */
import React from 'react';
import { Box, Card, CardContent, Switch, Typography } from '@mui/material';

export default function PluginActivationCard({ plugins, busyId = null, onToggle }) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Modules</Typography>
        {plugins.map((plugin, index) => (
          <Box
            key={plugin.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              py: 1.25,
              borderTop: index === 0 ? 'none' : 1,
              borderColor: 'divider',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{plugin.name}</Typography>
              <Typography variant="body2" color="text.secondary">{plugin.description}</Typography>
            </Box>
            <Switch
              checked={plugin.enabled}
              disabled={busyId === plugin.id}
              onChange={(event) => onToggle(plugin.id, event.target.checked)}
              slotProps={{ input: { 'aria-label': plugin.name } }}
              sx={{ minWidth: 58, minHeight: 44 }}
            />
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}
