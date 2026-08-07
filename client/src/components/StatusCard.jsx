/**
 * StatusCard — generic card for "feature health" views.
 *
 * Composes: StatusBadge + SummaryItem list + actions slot + optional alert slot.
 *
 * Props:
 *   title:           string                                                    (required)
 *   badge:           { status: 'success'|'warning'|'error'|'neutral', label, icon? }  (required)
 *   updatedAtLabel?: string                                                    (caption)
 *   items:           Array<{ label, value, valuePlaceholder? }>                (rendered via SummaryItem)
 *   actions?:        ReactNode                                                 (footer button row)
 *   alert?:          { severity: 'success'|'info'|'warning'|'error', message } (inline alert below actions)
 */
import React from 'react';
import { Card, CardContent, Box, Typography, Alert } from '@mui/material';
import StatusBadge from './StatusBadge';
import SummaryItem from './SummaryItem';

export default function StatusCard({
  title,
  badge,
  updatedAtLabel,
  items = [],
  actions,
  alert,
}) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            justifyContent: 'space-between',
            alignItems: { xs: 'flex-start', sm: 'center' },
            gap: 1,
            mb: 1,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
          {badge && <StatusBadge status={badge.status} label={badge.label} icon={badge.icon} />}
        </Box>

        {updatedAtLabel && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            {updatedAtLabel}
          </Typography>
        )}

        <Box sx={{ mt: 1 }}>
          {items.map((item, i) => (
            <SummaryItem
              key={`item-${i}`}
              label={item.label}
              value={item.value}
              valuePlaceholder={item.valuePlaceholder}
            />
          ))}
        </Box>

        {actions && (
          <Box
            sx={{
              mt: 2,
              display: 'flex',
              flexDirection: { xs: 'column-reverse', sm: 'row' },
              justifyContent: { sm: 'flex-end' },
              gap: 1,
              '& > *': { width: { xs: '100%', sm: 'auto' } },
            }}
          >
            {actions}
          </Box>
        )}

        {alert && (
          <Alert
            severity={alert.severity}
            sx={{ mt: 2, px: { xs: 1.5, sm: 2 }, py: { xs: 1, sm: 1 } }}
          >
            {alert.message}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
