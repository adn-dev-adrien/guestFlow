/**
 * InsightCard — one « fait marquant »: a toned icon, a bold line and a caption
 * (specs/finance-dashboard-redesign.md rule 11). Generic: the text comes ready-made from the server.
 *
 * Props:
 *   tone:   'success' | 'warning' | 'error' | 'info'
 *   title:  string
 *   text:   string
 *   icon?:  ReactNode   defaults to an icon matching the tone
 */
import React from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';
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

export default function InsightCard({ tone = 'info', title, text, icon }) {
  const t = TONES[tone] || TONES.info;
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', '&:last-child': { pb: 2 } }}>
        <Box sx={{ width: 36, height: 36, borderRadius: '8px', bgcolor: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 36px' }}>
          {icon || t.icon}
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">{text}</Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
