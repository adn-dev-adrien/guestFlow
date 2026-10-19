/**
 * InsightCard — one « fait marquant »: a toned icon, a bold line and a caption
 * (specs/finance-dashboard-redesign.md rules 11, 43). Generic: the text comes ready-made from the
 * server; it wraps inside any column width, never clipped.
 *
 * Props:
 *   tone:   'success' | 'warning' | 'error' | 'info'
 *   title:  string
 *   text:   string
 *   icon?:  ReactNode   defaults to an icon matching the tone
 *   actionLabel?, onAction?: an optional text button under the caption (rule 35: « Voir les séjours »)
 */
import React from 'react';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import ScheduleIcon from '@mui/icons-material/Schedule';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

const TONES = {
  success: { bg: '#E6EFE7', fg: 'success.main', icon: <TrendingUpIcon fontSize="small" /> },
  warning: { bg: '#F6EDD7', fg: 'warning.main', icon: <SavingsOutlinedIcon fontSize="small" /> },
  error: { bg: '#F7E8E5', fg: 'error.main', icon: <ScheduleIcon fontSize="small" /> },
  info: { bg: '#E4EDF3', fg: 'info.main', icon: <InfoOutlinedIcon fontSize="small" /> },
};

export default function InsightCard({ tone = 'info', title, text, icon, actionLabel, onAction }) {
  const t = TONES[tone] || TONES.info;
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', '&:last-child': { pb: 2 } }}>
        <Box sx={{ width: 36, height: 36, borderRadius: '8px', bgcolor: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 36px' }}>
          {icon || t.icon}
        </Box>
        {/* Rule 43 — the text column may shrink below its longest word: it wraps, it is never cut. */}
        <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">{text}</Typography>
          {actionLabel && onAction && (
            <Button size="small" onClick={onAction} sx={{ mt: 0.5, ml: -1, minHeight: 44, textTransform: 'none' }}>{actionLabel}</Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
