/**
 * TariffChangeJournal — la frise des changements tarifaires (specs/tariff-change-journal.md §6).
 *
 * Un changement de grille se fait en deux temps : la recette est appliquée dans GuestFlow, puis les
 * prix sont mis en ligne sur les plateformes. C'est le second qui change ce qu'un voyageur voit.
 * Le composant affiche les deux, du plus récent au plus ancien, et permet d'en déclarer un.
 *
 * Spécifique au journal, pas générique : il porte le libellé des natures et la règle d'affichage
 * « date d'effet ≠ date de saisie ». Tout ce qu'il montre vient du serveur déjà trié et libellé.
 *
 * Props :
 *   events:      Array   événements servis par GET /tariff-recipes/journal
 *   properties:  Array   logements proposés dans le formulaire ({ id, name })
 *   declareOpen: bool    ouverture du dialogue, pilotée par la page (bouton de la PageActionBar)
 *   onDeclareClose: () => void
 *   onCreate:    (payload) => Promise
 *   onDelete:    (eventId) => Promise
 */
import React, { useMemo, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Chip, IconButton, Tooltip, MenuItem, TextField, Stack,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import FormDialog from './FormDialog';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';

const KINDS = [
  { value: 'platforms', label: 'Mise en ligne sur les plateformes' },
  { value: 'recipe', label: 'Recette appliquée' },
];

const KIND_COLOR = { recipe: 'success', platforms: 'info' };

// 'YYYY-MM-DD HH:MM:SS' → « 12 août 2026 à 16:08 ». Purement présentationnel : la donnée métier,
// elle, reste la chaîne SQLite servie par le serveur.
function formatMoment(value) {
  if (!value) return '';
  const [date, time = ''] = String(value).split(' ');
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return value;
  const libelle = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  const hhmm = time.slice(0, 5);
  return hhmm && hhmm !== '00:00' ? `${libelle} à ${hhmm}` : libelle;
}

// Même jour ⇒ inutile de préciser « enregistré le … » : la saisie a suivi le changement.
function sameDay(a, b) {
  return String(a || '').slice(0, 10) === String(b || '').slice(0, 10);
}

function nowForInput() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export default function TariffChangeJournal({
  events = [], properties = [], declareOpen = false, onDeclareClose, onCreate, onDelete,
}) {
  const [propertyId, setPropertyId] = useState('');
  const [kind, setKind] = useState('platforms');
  const [occurredAt, setOccurredAt] = useState(nowForInput);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const defaultProperty = useMemo(
    () => (properties.length === 1 ? String(properties[0].id) : ''),
    [properties],
  );
  const chosenProperty = propertyId || defaultProperty;

  const close = () => {
    onDeclareClose?.();
    setNote('');
    setOccurredAt(nowForInput());
  };

  const submit = async () => {
    if (!chosenProperty || !kind || !occurredAt || saving) return;
    setSaving(true);
    try {
      await onCreate?.({
        propertyId: Number(chosenProperty),
        kind,
        occurredAt: occurredAt.replace('T', ' '),
        note,
      });
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      {events.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon />}
          message="Aucun changement enregistré pour l'instant."
          py={4}
        />
      ) : (
        <Stack spacing={1}>
          {events.map((event) => (
            <Card key={event.id} variant="outlined">
              <CardContent
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  '&:last-child': { pb: { xs: 1.5, sm: 2 } },
                  display: 'flex',
                  flexDirection: { xs: 'column', md: 'row' },
                  alignItems: { xs: 'flex-start', md: 'center' },
                  gap: { xs: 1, md: 2 },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip
                      size="small"
                      label={event.kindLabel}
                      color={KIND_COLOR[event.kind] || 'default'}
                      variant="outlined"
                    />
                    {event.inferred && (
                      <Tooltip title="Date déduite de la dernière modification de la fiche logement : le journal n'existait pas encore lors de cette application.">
                        <Chip size="small" label="date déduite" color="warning" variant="outlined" />
                      </Tooltip>
                    )}
                  </Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 0.5 }}>
                    {event.propertyName}
                  </Typography>
                  {event.recipeId && (
                    <Typography variant="caption" color="text.secondary">
                      {event.recipeId}
                      {event.recipeVersion ? ` · v${event.recipeVersion}` : ''}
                    </Typography>
                  )}
                  {event.note && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {event.note}
                    </Typography>
                  )}
                </Box>

                <Box sx={{ textAlign: { xs: 'left', md: 'right' }, minWidth: { md: 200 } }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoment(event.occurredAt)}
                  </Typography>
                  {!sameDay(event.occurredAt, event.createdAt) && (
                    <Typography variant="caption" color="text.secondary">
                      enregistré le {formatMoment(event.createdAt)}
                    </Typography>
                  )}
                </Box>

                <Tooltip title="Supprimer cet événement">
                  <IconButton
                    size="small"
                    onClick={() => setToDelete(event)}
                    aria-label={`Supprimer l'événement du ${formatMoment(event.occurredAt)}`}
                    sx={{ minWidth: 44, minHeight: 44, alignSelf: { xs: 'flex-end', md: 'center' } }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <FormDialog
        open={declareOpen}
        onClose={close}
        title="Déclarer un changement tarifaire"
        onSubmit={submit}
        submitLabel="Enregistrer"
        submitDisabled={!chosenProperty || !kind || !occurredAt || saving}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Logement"
            value={chosenProperty}
            onChange={(e) => setPropertyId(e.target.value)}
            fullWidth
          >
            {properties.map((p) => (
              <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Nature du changement"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            fullWidth
          >
            {KINDS.map((k) => (
              <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            type="datetime-local"
            label="Date et heure d'effet"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Le moment où le changement a pris effet, pas celui de la saisie."
            fullWidth
          />
          <TextField
            label="Note (facultatif)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          const target = toDelete;
          setToDelete(null);
          if (target) await onDelete?.(target.id);
        }}
        title="Supprimer cet événement ?"
        message="Il ne sera plus possible de dater ce changement."
        confirmLabel="Supprimer"
      />
    </Box>
  );
}
