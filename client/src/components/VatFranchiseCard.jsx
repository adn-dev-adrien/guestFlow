/**
 * VatFranchiseCard — « Seuil de franchise » of the Suivi financier (specs/vat-optional-mode.md rules
 * 35-41, §6.7): the calendar year's collected turnover and its projection to 31 December against the
 * threshold the operator typed. Feature-local: it renders the `/finance/vat-franchise` payload as is —
 * the level, its words, the ratios and the action all come from the server.
 *
 * Props:
 *   data:   the payload (`{ applies: false }` renders nothing)
 *   onOpen: (path) => void   opens Paramètres › TVA & exercice (« Saisir le seuil » adds #seuil-franchise: the field is focused)
 */
import React from 'react';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import StatusBadge from './StatusBadge';
import ThresholdMeter from './ThresholdMeter';
import { formatCurrencyRounded } from '../utils/formatters';

const percent = (x) => `${Math.max(0, Math.round(x * 100))} %`;
const dayMonth = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const TEXT_COLOR = { neutral: 'text.primary', warning: 'warning.text', error: 'error.text' };

function Figure({ label, value, muted }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.55rem', fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: muted ? 'text.secondary' : 'text.primary' }}>{value}</Typography>
    </Box>
  );
}

export default function VatFranchiseCard({ data, onOpen }) {
  if (!data || !data.applies) return null;
  const hasThreshold = data.threshold != null;
  const over = data.level === 'over';
  return (
    <Card component="section" aria-label="Seuil de franchise" sx={{ mb: 2, ...(over ? { borderColor: 'error.main' } : {}) }} variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader" component="h2">Seuil de franchise</Typography>
          {hasThreshold && <StatusBadge status={data.tone} label={data.title} />}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Année civile {data.year} · tous logements{hasThreshold ? ` · au ${dayMonth(data.asOf)}` : ''}
        </Typography>

        {!hasThreshold ? (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography>Encaissé {data.year} : <b>{formatCurrencyRounded(data.collected)}</b></Typography>
            <Button onClick={() => onOpen(`${data.settingsPath}#seuil-franchise`)} sx={{ minHeight: 44, textTransform: 'none', width: { xs: '100%', sm: 'auto' } }}>Saisir le seuil</Button>
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 1, sm: 2 }, mb: 0.5 }}>
              <Figure label="Encaissé" value={formatCurrencyRounded(data.collected)} />
              <Figure label="Projection au 31/12" value={formatCurrencyRounded(data.projected)} muted />
            </Box>
            <ThresholdMeter
              value={data.collected}
              projected={data.projected}
              limit={data.threshold}
              tone={data.tone}
              limitLabel="seuil"
              ariaLabel="Encaissé par rapport au seuil"
              ariaValueText={data.text}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', color: 'text.secondary', fontSize: 13 }}>
              <span><b>{percent(data.ratio)}</b> du seuil de {formatCurrencyRounded(data.threshold)}</span>
              <span>projection {percent(data.projectedRatio)}</span>
            </Box>
            <Typography sx={{ fontWeight: 600, mt: 1.25, color: TEXT_COLOR[data.tone] }}>{data.text}</Typography>
          </>
        )}

        {(data.previousYear || data.action) && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {data.previousYear ? `${data.previousYear.year} : ${formatCurrencyRounded(data.previousYear.collected)}` : ''}
            </Typography>
            {data.action && (
              <Button variant="contained" color="error" onClick={() => onOpen(data.action.path)} sx={{ minHeight: 44, textTransform: 'none', width: { xs: '100%', sm: 'auto' } }}>
                {data.action.label}
              </Button>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
