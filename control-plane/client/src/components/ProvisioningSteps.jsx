/**
 * ProvisioningSteps — the steps of a customer's creation or deprovisioning, each green, red, to do
 * or skipped, with its one action (specs/control-plane-plans-and-access.md rules 7, 20). Specific to
 * the console.
 *
 * Props:
 *   steps:    [{ step, label, kind, status, detail, action }] — from the server   (required)
 *   onAction: (step, action) => void                                              (required)
 *   busy:     string | null — the step whose action is running
 */
import React from 'react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import RemoveIcon from '@mui/icons-material/Remove';

const ACTION_LABELS = { done: 'Marquer fait', undo: 'Rouvrir', retry: 'Réessayer' };

function Dot({ status }) {
  const common = { width: 26, height: 26, borderRadius: '50%', flex: '0 0 26px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (status === 'ok') return <Box sx={{ ...common, bgcolor: 'success.main', color: '#fff' }}><CheckIcon sx={{ fontSize: 18 }} /></Box>;
  if (status === 'failed') return <Box sx={{ ...common, bgcolor: 'error.main', color: '#fff' }}><PriorityHighIcon sx={{ fontSize: 18 }} /></Box>;
  if (status === 'skipped') return <Box sx={{ ...common, bgcolor: 'grey.300', color: 'text.secondary' }}><RemoveIcon sx={{ fontSize: 18 }} /></Box>;
  return <Box sx={{ ...common, border: 2, borderColor: 'divider' }} />;
}

export default function ProvisioningSteps({ steps, onAction, busy = null }) {
  return (
    <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
      {steps.map((s) => (
        <Box key={s.step} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 1.25, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
          <Dot status={s.status} />
          <Box sx={{ flex: 1, minWidth: 180 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.label}</Typography>
            {s.detail && <Typography variant="caption" color={s.status === 'failed' ? 'error' : 'text.secondary'} sx={{ overflowWrap: 'anywhere' }}>{s.detail}</Typography>}
          </Box>
          {s.action && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => onAction(s.step, s.action)}
              disabled={Boolean(busy)}
              sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
            >
              {busy === s.step ? <CircularProgress size={18} /> : ACTION_LABELS[s.action]}
            </Button>
          )}
        </Box>
      ))}
    </Stack>
  );
}
