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
 * Phone (specs/design-system-reference.md §9, UI/UX review 2026-10-18 decision 5 — the SAS rule): the
 * actions stack in a bar kept at the bottom of the screen, the primary one filled and LAST, under the
 * thumb; « Précédent » and « Plus tard » above it, neutral.
 * (specs/plugins-phase-p-productisation.md rule 44.)
 */
import React from 'react';
import { Box, Button, Card, CardContent, CircularProgress, LinearProgress, Stack, Typography } from '@mui/material';

export default function StepperPage({
  brand, step, total, title, children, onNext, nextLabel = 'Suivant', onBack, onLater, busy = false,
}) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', justifyContent: 'center', alignItems: { xs: 'stretch', sm: 'flex-start' }, py: { xs: 0, sm: 6 }, px: { xs: 0, sm: 2 } }}>
      {/* Phone: the card fills the screen (100dvh) so a short step still puts its actions at the
          bottom, under the thumb; a long step keeps them in view with `sticky`. */}
      <Card
        variant="outlined"
        sx={{
          width: '100%', maxWidth: 600, borderRadius: { xs: 0, sm: 2 }, overflow: { xs: 'visible', sm: 'hidden' },
          display: { xs: 'flex', sm: 'block' }, flexDirection: 'column', minHeight: { xs: '100dvh', sm: 0 },
        }}
      >
        <CardContent sx={{ p: { xs: 2, sm: 4 }, flex: { xs: 1, sm: 'none' }, display: { xs: 'flex', sm: 'block' }, flexDirection: 'column' }}>
          <Stack spacing={2.5} useFlexGap sx={{ flex: { xs: 1, sm: 'none' } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>{brand}</Box>
              <Typography variant="body2" color="text.secondary">{`Étape ${step} sur ${total}`}</Typography>
            </Box>
            <LinearProgress variant="determinate" value={(step / total) * 100} aria-label={`Étape ${step} sur ${total}`} />
            <Typography variant="pageTitle" component="h1">{title}</Typography>
            <Box>{children}</Box>
            <Stack
              data-testid="stepper-actions"
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{
                justifyContent: 'flex-end',
                mt: { xs: 'auto', sm: 0 },
                pt: 1,
                // Phone: a bar stuck to the bottom of the screen, the primary action last, under the thumb.
                position: { xs: 'sticky', sm: 'static' },
                bottom: { xs: 0 },
                zIndex: 1,
                bgcolor: 'background.paper',
                pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 0 },
                borderTopStyle: { xs: 'solid', sm: 'none' },
                borderTopWidth: 1,
                borderTopColor: 'divider',
                '& .MuiButton-root': { minHeight: 44, width: { xs: '100%', sm: 'auto' } },
              }}
            >
              {onLater && <Button color="inherit" onClick={onLater} disabled={busy}>Plus tard</Button>}
              {onBack && <Button variant="outlined" color="inherit" onClick={onBack} disabled={busy}>Précédent</Button>}
              <Button
                variant="contained"
                onClick={onNext}
                disabled={busy}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
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
