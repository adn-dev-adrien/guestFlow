/**
 * Une ligne de l'historique des « notes en séjour » — specs/adjustable-complement-amounts.md §3.4.
 *
 * Deux états : lecture (date — montant — mode, avec ✎ et ✕) et édition en place (montant, date,
 * CB / caisse interne). Extrait de `FinanceSection` parce que la ligne porte désormais son propre
 * état local et que le bloc Finance dépasse déjà les mille lignes.
 *
 * Props :
 *   - note        `{ id, paidDate, paidCash, total, lines[] }`
 *   - settled     le complément de fin de séjour est encaissé → plus rien ne bouge
 *   - onCancel()  supprimer l'encaissement (les prestations redeviennent à percevoir)
 *   - onAdjust({ total?, paidDate?, cash? })  → Promise ; rejette avec le message serveur
 */
import React, { useState } from 'react';
import { Box, Button, Stack, Typography, Tooltip } from '@mui/material';
import ArithmeticTextField from '../ArithmeticTextField';
import DateField from '../DateField';
import { formatCurrency, displayDate } from '../../utils/formatters';

// « 06/08 » — l'historique est dense, l'année n'apporte rien (un séjour n'en enjambe pas deux).
function shortDate(iso) {
  const full = displayDate(iso);
  return full ? full.slice(0, 5) : '';
}

export default function MidStayNoteRow({ note, settled = false, onCancel, onAdjust }) {
  const [editing, setEditing] = useState(false);
  const [total, setTotal] = useState(Number(note.total || 0));
  const [paidDate, setPaidDate] = useState(note.paidDate || '');
  const [cash, setCash] = useState(Number(note.paidCash || 0) === 1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const open = () => {
    setTotal(Number(note.total || 0));
    setPaidDate(note.paidDate || '');
    setCash(Number(note.paidCash || 0) === 1);
    setError('');
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onAdjust({ total: total === '' ? undefined : Number(total), paidDate, cash });
      setEditing(false);
    } catch (err) {
      setError((err && err.message) || 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = settled ? 'Complément de fin de séjour déjà encaissé — décochez-le pour modifier la note.' : '';

  return (
    <Box sx={{ mt: 1, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
      {!editing && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {shortDate(note.paidDate)} — {formatCurrency(note.total)} — {note.paidCash ? 'Caisse interne' : 'CB'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title={disabledReason || 'Modifier la note'}>
                <span>
                  <Button
                    size="small"
                    disabled={settled}
                    onClick={open}
                    aria-label="Modifier la note"
                    sx={{ textTransform: 'none', minWidth: 44, minHeight: 44 }}
                  >
                    ✎
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={disabledReason || "Annuler l'encaissement"}>
                <span>
                  <Button
                    size="small"
                    color="error"
                    disabled={settled}
                    onClick={onCancel}
                    aria-label="Annuler l'encaissement"
                    sx={{ textTransform: 'none', minWidth: 44, minHeight: 44 }}
                  >
                    ✕
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Box>
          {(note.lines || []).map((line, i) => (
            <Typography key={i} variant="body2" sx={{ color: 'text.secondary' }}>
              {line.label} : {formatCurrency(line.amount || 0)}
            </Typography>
          ))}
        </>
      )}

      {editing && (
        <Stack spacing={1} sx={{ py: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <ArithmeticTextField
              label="Montant (€)"
              value={total}
              onCommit={(v) => setTotal(v)}
              size="small"
              fullWidth
              error={Boolean(error)}
              helperText={error || ''}
            />
            <DateField
              label="Payé le"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant={cash ? 'outlined' : 'contained'}
              onClick={() => setCash(false)}
              sx={{ textTransform: 'none', flex: 1, minHeight: 44 }}
            >
              CB
            </Button>
            <Button
              size="small"
              variant={cash ? 'contained' : 'outlined'}
              color={cash ? 'success' : 'inherit'}
              onClick={() => setCash(true)}
              sx={{ textTransform: 'none', flex: 1, minHeight: 44 }}
            >
              Caisse interne
            </Button>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" disabled={busy} onClick={save} sx={{ textTransform: 'none' }}>
              Enregistrer
            </Button>
            <Button size="small" disabled={busy} onClick={() => setEditing(false)} sx={{ textTransform: 'none' }}>
              Annuler
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Baisser une note remet la différence à percevoir en fin de séjour.
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
