/**
 * NeatInsuranceStatus — the Neat subscription state under the cancellation-insurance line of the fiche
 * (specs/neat-cancellation-insurance-subscription.md §3.3 rules 13-16; specs/plugins-phase-3b-neat.md
 * rule 16). A `reservation.optionLine` contribution: the core row draws it, the plugin owns it.
 *
 * Props (from the slot):
 *   block          the server-shaped `pluginBlocks.neat` of the stay, or null (nothing to show)
 *   onBlockChange  (block) => void — replaces the block with the server's answer
 *   reservationId  the stay
 *   guestName      named in the void confirmation
 */
import React from 'react';
import {
  Box, Button, Stack, Tooltip, Typography,
} from '@mui/material';
import {
  api, StatusBadge, formatCurrency, useAppDialogs, useToast,
} from '../sdk';

const BADGE = { active: 'success', pending: 'neutral', voided: 'neutral', line_removed_active: 'warning' };
const LABEL = {
  active: 'Neat : souscrite',
  pending: 'Neat : en attente',
  voided: 'Neat : résiliée',
  line_removed_active: 'Ligne retirée — souscription active',
};

export default function NeatInsuranceStatus({ block, onBlockChange, reservationId, guestName }) {
  const { confirm, alert } = useAppDialogs();
  const { showSuccess } = useToast();
  if (!block) return null;

  const retry = async () => {
    try {
      const res = await api.retryNeatSubscription(reservationId);
      onBlockChange(res.neat || null);
      if (res.neat && res.neat.status === 'active') showSuccess('Souscription Neat effectuée.');
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Nouvelle tentative impossible.' });
    }
  };

  // Voiding is always a confirmed, manual act (feature spec rule 15).
  const voidSubscription = async () => {
    const ok = await confirm({
      title: 'Résilier la souscription Neat ?',
      message: `Résilier la souscription Neat de ${guestName || 'ce client'} ? Le client ne sera plus couvert.`,
      confirmLabel: 'Résilier',
      confirmColor: 'error',
    });
    if (!ok) return;
    try {
      const res = await api.voidNeatSubscription(reservationId);
      onBlockChange(res.neat || null);
      showSuccess('Souscription Neat résiliée.');
    } catch (e) {
      await alert({ title: 'Erreur', message: e.message || 'Résiliation impossible.' });
    }
  };

  const active = block.status === 'active' || block.status === 'line_removed_active';
  return (
    <Box sx={{ mt: 1 }}>
      {block.status === 'failed' ? (
        <Tooltip title={block.lastError || ''} arrow>
          <span><StatusBadge status="error" label="Neat : en échec" /></span>
        </Tooltip>
      ) : (
        <StatusBadge status={BADGE[block.status] || 'neutral'} label={LABEL[block.status] || block.status} />
      )}
      {block.premiumAmount != null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {`Prime Neat ${formatCurrency(block.premiumAmount)}`}
          {block.marginPercent != null ? ` • marge +${block.marginPercent} % • arrondi €↑` : ''}
        </Typography>
      )}
      {block.status === 'line_removed_active' && (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
          Ligne retirée, police Neat toujours active : rétablir la ligne ou résilier chez Neat.
        </Typography>
      )}
      {(block.status === 'failed' || active) && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.5 }}>
          {block.status === 'failed' && (
            <Button size="small" variant="outlined" onClick={retry} sx={{ minHeight: 44 }}>
              Réessayer maintenant
            </Button>
          )}
          {active && (
            <Button size="small" variant="outlined" color="error" onClick={voidSubscription} sx={{ minHeight: 44 }}>
              Résilier chez Neat
            </Button>
          )}
        </Stack>
      )}
    </Box>
  );
}
