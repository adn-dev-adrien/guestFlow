/**
 * PlanningOrderCard — a « Commande client » on the planning day of its delivery time (specs/guest-app.md rules 41bis,
 * 43): the time (« À retirer 18 h » in pickup mode), the lodging and the guest, what to prepare, how it is paid, and
 * the « Livrée » / « Retirée » circle. Ticking it marks the order delivered for the guest too (« Mes commandes »);
 * there is no way back from the planning, as on the « Commandes clients » page.
 *
 * Props (slot `planning.days`, timed): entry `{ item }`, reload(), onOpenReservation?(reservationId)
 */
import React, { useState } from 'react';
import {
  Box, Card, CardContent, Checkbox, Chip, Tooltip, Typography,
} from '@mui/material';
import RoomServiceOutlinedIcon from '@mui/icons-material/RoomServiceOutlined';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { useToast } from '../sdk';
import guestAppApi from './guestAppApi';

export default function PlanningOrderCard({ entry, reload, onOpenReservation }) {
  const card = entry.item;
  const { showError } = useToast();
  const [done, setDone] = useState(Boolean(card.delivered));
  const [busy, setBusy] = useState(false);
  const open = onOpenReservation ? () => onOpenReservation(card.reservationId) : undefined;
  const markTitle = card.fulfilment === 'pickup' ? 'Marquer retirée' : 'Marquer livrée';

  const mark = async () => {
    if (done || busy) return;
    setBusy(true);
    setDone(true);
    try {
      await guestAppApi.markDelivered(card.orderId);
      reload();
    } catch (e) {
      setDone(false);
      showError(e.message || 'La commande n’a pas pu être marquée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      variant="outlined"
      sx={(t) => ({
        mb: 1, borderRadius: 2,
        bgcolor: done ? t.palette.success.soft : t.palette.background.paper,
        borderColor: done ? 'success.main' : 'divider',
        opacity: done ? 0.8 : 1,
      })}
    >
      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Tooltip title={done ? card.doneLabel : markTitle}>
            <span>
              <Checkbox
                icon={<RadioButtonUncheckedIcon sx={{ fontSize: 28, color: 'text.disabled' }} />}
                checkedIcon={<CheckCircleIcon sx={{ fontSize: 28, color: 'success.main' }} />}
                checked={done}
                disabled={done || busy}
                onChange={mark}
                sx={{ p: 0, flexShrink: 0 }}
                slotProps={{ input: { 'aria-label': done ? card.doneLabel : `${markTitle} — commande n° ${card.orderId}` } }}
              />
            </span>
          </Tooltip>
          <RoomServiceOutlinedIcon sx={{ fontSize: 20, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'primary.main', lineHeight: 1.2 }}>
            Commande client
          </Typography>
          <Chip
            label={card.timeLabel}
            size="small"
            sx={{
              height: 22, fontSize: 13, fontWeight: 800, borderRadius: 1.5, color: 'common.white',
              bgcolor: done ? 'success.main' : 'primary.main', fontVariantNumeric: 'tabular-nums',
            }}
          />
          {done && <Chip label={card.doneLabel} size="small" color="success" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />}
        </Box>

        <Box
          role={open ? 'button' : undefined}
          tabIndex={open ? 0 : undefined}
          onClick={open}
          onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
          sx={{
            pl: '40px',
            cursor: open ? 'pointer' : 'default',
            '&:focus-visible': open ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } : undefined,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25, minWidth: 0 }}>
            <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2, minWidth: 0 }}>
              {card.lodging}
            </Typography>
          </Box>
          {card.guest && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <PersonIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{card.guest}</Typography>
            </Box>
          )}
          <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5 }}>
            {(card.lines || []).map((line, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Typography key={i} component="li" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{line}</Typography>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {`${card.paymentLabel} · commande n° ${card.orderId}`}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
