/**
 * StepperPage — a full-screen guided flow, one step per screen (specs/plugins-phase-p-productisation.md
 * rule 23). Generic: any multi-step flow outside the side menu.
 *
 * Props:
 *   brand        ReactNode — top-left mark (e.g. the GuestFlow wordmark)
 *   step, total  numbers — « Étape {step} sur {total} » and the progress bar
 *   title        string — the step's heading
 *   children     the step's content
 *   onNext       () => void — primary action; `nextLabel` (default « Suivant »)
 *   onBack       optional () => void — « Précédent »
 *   onLater      optional () => void — « Plus tard »
 *   busy         boolean — disables the actions and shows a spinner in the primary one
 *
 * Mobile: the actions stack and the primary one is full width.
 */
import React from 'react';
import { Box, Button, Card, CardContent, CircularProgress, LinearProgress, Stack, Typography } from '@mui/material';

export default function StepperPage({
  brand, step, total, title, children, onNext, nextLabel = 'Suivant', onBack, onLater, busy = false,
}) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', justifyContent: 'center', alignItems: { xs: 'stretch', sm: 'flex-start' }, py: { xs: 0, sm: 6 }, px: { xs: 0, sm: 2 } }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 600, borderRadius: { xs: 0, sm: 2 } }}>
        <CardContent sx={{ p: { xs: 2, sm: 4 } }}>
          <Stack spacing={2.5}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>{brand}</Box>
              <Typography variant="body2" color="text.secondary">{`Étape ${step} sur ${total}`}</Typography>
            </Box>
            <LinearProgress variant="determinate" value={(step / total) * 100} aria-label={`Étape ${step} sur ${total}`} />
            <Typography variant="pageTitle" component="h1">{title}</Typography>
            <Box>{children}</Box>
            <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end', pt: 1 }}>
              {onLater && <Button color="inherit" onClick={onLater} disabled={busy}>Plus tard</Button>}
              {onBack && <Button variant="outlined" color="inherit" onClick={onBack} disabled={busy}>Précédent</Button>}
              <Button
                variant="contained"
                onClick={onNext}
                disabled={busy}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
                sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 44 }}
              >
                {nextLabel}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
