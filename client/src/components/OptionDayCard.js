/**
 * OptionDayCard — option-driven planning cards for a given day (specs/option-planning-card.md §3.3 + §6).
 *
 * Renders ONE card per selected occurrence, in the arrival/departure layout (a « fait » circle, the
 * option title with the time in a pill, the property, then a person line). Themable so the breakfast
 * option reuses the EXACT same look while keeping its amber background + breakfast extras
 * (specs/breakfast-option-planning-card.md + sas-breakfast-milk-and-food.md): the morning
 * headcount + café/thé/chocolat/lait + viennoiseries/céréales + note.
 *
 * Returns `null` when `data` is missing or carries no items.
 *
 * Props:
 *   data — { items: [{ reservationId, optionId, title, clientName, propertyName, date, time, done,
 *            adults?, children?, teens?, babies?,          // generic option family chips
 *            breakfastPersons?, coffee?, tea?, chocolate?, milk?, pastries?, cereals?, note? }] }   // breakfast extras
 *   onItemClick   — `(reservationId) => void`. The detail block is clickable → fiche.
 *   onToggleDone  — `(item, nextDone) => void`. Fired when the circle is ticked.
 *   theme         — 'option' (default, deep-purple) | 'breakfast' (amber).
 */
import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Checkbox, Tooltip } from '@mui/material';
import { deepPurple, amber, teal } from '@mui/material/colors';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PersonIcon from '@mui/icons-material/Person';
import EventNoteIcon from '@mui/icons-material/EventNote';
import BakeryDiningIcon from '@mui/icons-material/BakeryDining';
import HotTubIcon from '@mui/icons-material/HotTub';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import EmojiFoodBeverageIcon from '@mui/icons-material/EmojiFoodBeverage';
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast';
import LocalDrinkIcon from '@mui/icons-material/LocalDrink';
import RiceBowlIcon from '@mui/icons-material/RiceBowl';

const THEMES = {
  option: { bg: deepPurple[50], border: deepPurple[100], accent: deepPurple[700], Icon: EventNoteIcon },
  breakfast: { bg: amber[50], border: amber[200], accent: amber[800], Icon: BakeryDiningIcon },
  resource: { bg: teal[50], border: teal[100], accent: teal[800], Icon: HotTubIcon },
};

function pluralBreakfasts(n) { return n > 1 ? 'petits déjeuners' : 'petit déjeuner'; }

function OccurrenceCard({ item, onItemClick, onToggleDone, theme }) {
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
  const drinks = [
    { key: 'coffee', icon: <LocalCafeIcon sx={{ fontSize: 16 }} />, label: 'Café', n: Number(item.coffee) || 0 },
    { key: 'tea', icon: <EmojiFoodBeverageIcon sx={{ fontSize: 16 }} />, label: 'Thé', n: Number(item.tea) || 0 },
    { key: 'chocolate', icon: <FreeBreakfastIcon sx={{ fontSize: 16 }} />, label: 'Chocolat', n: Number(item.chocolate) || 0 },
    { key: 'milk', icon: <LocalDrinkIcon sx={{ fontSize: 16 }} />, label: 'Lait', n: Number(item.milk) || 0 },
  ].filter((d) => d.n > 0);
  const food = [
    { key: 'pastries', icon: <BakeryDiningIcon sx={{ fontSize: 16 }} />, label: 'Viennoiseries', n: Number(item.pastries) || 0 },
    { key: 'cereals', icon: <RiceBowlIcon sx={{ fontSize: 16 }} />, label: 'Céréales', n: Number(item.cereals) || 0 },
  ].filter((d) => d.n > 0);
  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1, borderRadius: 2,
        bgcolor: done ? 'rgba(76,175,80,0.06)' : theme.bg,
        borderColor: done ? 'success.main' : theme.border,
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
                slotProps={{ input: { 'aria-label': done ? 'Préparé' : 'Marquer comme préparé' } }}
              />
            </Tooltip>
          )}
          <theme.Icon sx={{ fontSize: 20, color: theme.accent, flexShrink: 0 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: theme.accent, lineHeight: 1.2 }}>
            {item.title}
          </Typography>
          {item.time && (
            <Chip
              icon={<AccessTimeIcon sx={{ fontSize: 16, color: 'white !important' }} />}
              label={item.time}
              size="small"
              sx={{
                height: 22, fontSize: 13, fontWeight: 800, borderRadius: 1.5, color: 'white',
                bgcolor: done ? 'success.main' : theme.accent, '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
              }}
            />
          )}
          {done && <Chip label="Fait" size="small" color="success" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />}
        </Box>

        {/* Detail block indented under the title, clickable → fiche. */}
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
            {/* Breakfast: show the morning headcount (= reservation persons). */}
            {item.breakfastPersons != null && (
              <Chip
                label={`${Number(item.breakfastPersons) || 0} ${pluralBreakfasts(Number(item.breakfastPersons) || 0)}`}
                size="small" sx={{ ...chipSx, fontWeight: 700, bgcolor: 'rgba(255,255,255,0.6)' }}
              />
            )}
            {hasFamily && (
              <>
                {adults > 0 && <Chip label={`Adultes: ${adults}`} size="small" variant="outlined" sx={chipSx} />}
                {children > 0 && <Chip label={`Enfants: ${children}`} size="small" variant="outlined" sx={chipSx} />}
                {teens > 0 && <Chip label={`Ados: ${teens}`} size="small" variant="outlined" sx={chipSx} />}
                {babies > 0 && <Chip label={`Bébés: ${babies}`} size="small" variant="outlined" sx={chipSx} />}
              </>
            )}
          </Box>
          {drinks.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
              {drinks.map((d) => (
                <Chip key={d.key} size="small" variant="outlined" icon={d.icon} label={`${d.label} ${d.n}`}
                  sx={{ height: 22, fontWeight: 600, bgcolor: 'rgba(255,255,255,0.6)' }} />
              ))}
            </Box>
          )}
          {food.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
              {food.map((d) => (
                <Chip key={d.key} size="small" variant="outlined" icon={d.icon} label={`${d.label} ${d.n}`}
                  sx={{ height: 22, fontWeight: 600, bgcolor: 'rgba(255,255,255,0.6)' }} />
              ))}
            </Box>
          )}
          {item.note && (
            <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic', mt: 0.5, display: 'block' }}>
              {item.note}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export default function OptionDayCard({ data, onItemClick, onToggleDone, theme = 'option' }) {
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
  const resolvedTheme = THEMES[theme] || THEMES.option;
  return (
    <Box>
      {data.items.map((item, idx) => (
        <OccurrenceCard
          // eslint-disable-next-line react/no-array-index-key
          key={`${item.reservationId}-${item.optionId}-${item.time || ''}-${idx}`}
          item={item}
          onItemClick={onItemClick}
          onToggleDone={onToggleDone}
          theme={resolvedTheme}
        />
      ))}
    </Box>
  );
}
