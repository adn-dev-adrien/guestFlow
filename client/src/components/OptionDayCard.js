/**
 * OptionDayCard — option-driven planning cards for a given day (specs/option-planning-card.md §3.3 + §6).
 *
 * Renders ONE card per selected occurrence, mirroring the order + layout of the arrival / departure
 * cards (Adrien 2026-06-17): a « fait » circle checkbox top-left, then the option title with the time
 * in a pill beside it; the detail block is indented to align under the title (property name, then a
 * person icon + client name + family composition). Keeps its own deep-purple background and stays a
 * touch more compact. Ticking the circle marks the occurrence « préparé » (persisted).
 *
 * Returns `null` when `data` is missing or carries no items.
 *
 * Props:
 *   data — { items: [{ reservationId, optionId, title, clientName, propertyName,
 *            adults, children, teens, babies, date, time, done }] }
 *   onItemClick   — `(reservationId) => void`. Optional. The detail block is clickable → fiche.
 *   onToggleDone  — `(item, nextDone) => void`. Optional. Fired when the circle is ticked.
 */
import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Checkbox, Tooltip } from '@mui/material';
import { deepPurple } from '@mui/material/colors';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PersonIcon from '@mui/icons-material/Person';
import EventNoteIcon from '@mui/icons-material/EventNote';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

const CARD_BG = deepPurple[50];
const CARD_BORDER = deepPurple[100];
const CARD_ACCENT = deepPurple[700];

function OccurrenceCard({ item, onItemClick, onToggleDone }) {
  const clickable = typeof onItemClick === 'function';
  const done = Boolean(item.done);
  const adults = Number(item.adults || 0);
  const children = Number(item.children || 0);
  const teens = Number(item.teens || 0);
  const babies = Number(item.babies || 0);
  const hasFamily = adults + children + teens + babies > 0;
  const chipSx = { height: 22, fontSize: 12 };
  const stop = (e) => e.stopPropagation();
  const openFiche = clickable ? () => onItemClick(item.reservationId) : undefined;
  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1, borderRadius: 2,
        bgcolor: done ? 'rgba(76,175,80,0.06)' : CARD_BG,
        borderColor: done ? 'success.main' : CARD_BORDER,
        opacity: done ? 0.75 : 1,
        transition: 'all 0.2s',
      }}
    >
      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        {/* Top row: « fait » circle + option title + time pill (mirrors the departure card). */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          {typeof onToggleDone === 'function' && (
            <Tooltip title={done ? 'Préparé' : 'Marquer comme préparé'}>
              <Checkbox
                icon={<RadioButtonUncheckedIcon sx={{ fontSize: 28, color: 'text.disabled' }} />}
                checkedIcon={<CheckCircleIcon sx={{ fontSize: 28, color: 'success.main' }} />}
                checked={done}
                onChange={() => onToggleDone(item, !done)}
                onClick={stop}
                sx={{ p: 0, flexShrink: 0 }}
                inputProps={{ 'aria-label': done ? 'Préparé' : 'Marquer comme préparé' }}
              />
            </Tooltip>
          )}
          <EventNoteIcon sx={{ fontSize: 20, color: CARD_ACCENT, flexShrink: 0 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: CARD_ACCENT, lineHeight: 1.2 }}>
            {item.title}
          </Typography>
          {item.time && (
            <Chip
              icon={<AccessTimeIcon sx={{ fontSize: 16, color: 'white !important' }} />}
              label={item.time}
              size="small"
              sx={{
                height: 22, fontSize: 13, fontWeight: 800, borderRadius: 1.5, color: 'white',
                bgcolor: done ? 'success.main' : CARD_ACCENT, '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
              }}
            />
          )}
          {/* « Fait » badge when prepared — same affordance as the arrival « Prêt » / departure « Effectué ». */}
          {done && <Chip label="Fait" size="small" color="success" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />}
        </Box>

        {/* Detail block indented to align under the title (pl ≈ circle width), clickable → fiche. */}
        <Box
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={openFiche}
          onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFiche(); } } : undefined}
          sx={{
            pl: '40px',
            cursor: clickable ? 'pointer' : 'default',
            '&:focus-visible': clickable ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } : undefined,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <HomeWorkIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>
              {item.propertyName}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <PersonIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.clientName}</Typography>
            {hasFamily && (
              <>
                {adults > 0 && <Chip label={`Adultes: ${adults}`} size="small" variant="outlined" sx={chipSx} />}
                {children > 0 && <Chip label={`Enfants: ${children}`} size="small" variant="outlined" sx={chipSx} />}
                {teens > 0 && <Chip label={`Ados: ${teens}`} size="small" variant="outlined" sx={chipSx} />}
                {babies > 0 && <Chip label={`Bébés: ${babies}`} size="small" variant="outlined" sx={chipSx} />}
              </>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function OptionDayCard({ data, onItemClick, onToggleDone }) {
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
  return (
    <Box>
      {data.items.map((item, idx) => (
        <OccurrenceCard
          // eslint-disable-next-line react/no-array-index-key
          key={`${item.reservationId}-${item.optionId}-${item.time || ''}-${idx}`}
          item={item}
          onItemClick={onItemClick}
          onToggleDone={onToggleDone}
        />
      ))}
    </Box>
  );
}
