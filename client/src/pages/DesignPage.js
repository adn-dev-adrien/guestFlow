import React, { useState } from 'react';
import {
  Box, Button, Card, CardContent, Divider, Grid, Stack, TableCell, TableRow, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import InboxIcon from '@mui/icons-material/Inbox';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import StatusBadge from '../components/StatusBadge';
import PlatformChip from '../components/PlatformChip';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import {
  formatCurrency, formatCurrencyRounded,
  displayDate, displayDateShort, displayDateLong, displayDateTime,
} from '../utils/formatters';

/**
 * DesignPage — living showcase of the « Maison » design system (specs/design-system.md §3.8).
 *
 * v1 (phase 1): tokens (palette, typography roles, spacing scale, radius/shadow) + display formats.
 * The page reads everything from the REAL theme and the REAL formatters — no duplicated values —
 * so any token drift is immediately visible here. The component catalogue arrives with phase 2.
 * Admin-only route (ROUTE_ROLES).
 */

function Swatch({ label, value, textColor }) {
  return (
    <Stack sx={{ minWidth: 132 }}>
      <Box sx={{
        height: 52, borderRadius: 1.5, bgcolor: value, border: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'flex-end', p: 0.75,
      }}
      >
        <Typography variant="caption" sx={{ color: textColor || '#fff', fontWeight: 600 }}>{label}</Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
        {String(value)}
      </Typography>
    </Stack>
  );
}

function Section({ title, children }) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="sectionHeader" sx={{ display: 'block', mb: 2 }}>{title}</Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function FormatRow({ code, value }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.25, sm: 2 }} sx={{ py: 0.75 }}>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', minWidth: 320, color: 'text.secondary' }}>{code}</Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{value}</Typography>
    </Stack>
  );
}

const DEMO_ROWS = [
  { id: 1, client: 'Jean Dupont', logement: 'Le Moulin', montant: 642 },
  { id: 2, client: 'Marie Martin', logement: 'La Grange', montant: 1218.5 },
  { id: 3, client: 'Paul Roux', logement: 'Tente Lodge', montant: 480 },
];

export default function DesignPage() {
  const theme = useTheme();
  const p = theme.palette;
  const semantics = ['success', 'warning', 'error', 'info'];
  const { confirm, alert, openForm } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [unsavedOpen, setUnsavedOpen] = useState(false);

  return (
    <Box>
      <PageActionBar title="Design system" />
      <Box sx={{ maxWidth: 1240, mx: 'auto', p: { xs: 1.5, sm: 3 } }}>

        <Section title="Palette — « Maison »">
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
            <Swatch label="primary" value={p.primary.main} />
            <Swatch label="secondary" value={p.secondary.main} />
            <Swatch label="background" value={p.background.default} textColor={p.text.primary} />
            <Swatch label="paper" value={p.background.paper} textColor={p.text.primary} />
            <Swatch label="text.primary" value={p.text.primary} />
            <Swatch label="text.secondary" value={p.text.secondary} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Sémantiques — les puces de statut utilisent le fond doux (<code>soft</code>) + texte foncé,
            jamais de Chip semi-plein.
          </Typography>
          <Grid container spacing={2}>
            {semantics.map((k) => (
              <Grid key={k} size={{ xs: 6, sm: 3 }}>
                <Stack spacing={1}>
                  <Swatch label={`${k}.main`} value={p[k].main} />
                  <Box sx={{
                    bgcolor: p[k].soft, color: p[k].main, borderRadius: 999, px: 1.5, py: 0.4,
                    fontSize: 12.5, fontWeight: 600, alignSelf: 'flex-start',
                  }}
                  >
                    {k}.soft
                  </Box>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Section>

        <Section title="Typographie — rôles">
          <Stack spacing={1.5} divider={<Divider />}>
            <Box>
              <Typography variant="caption" color="text.secondary">pageTitle — serif, titre de page (PageActionBar / PageHeader)</Typography>
              {/* component="p": specimens must not inject real <h1>/<h2> into the page outline
                  (post-merge review finding, specs/ds-components.md §3.6). */}
              <Typography variant="pageTitle" component="p" sx={{ display: 'block' }}>Planning — semaine du 6 juillet</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">sectionHeader — serif, tête de section</Typography>
              <Typography variant="sectionHeader" component="p" sx={{ display: 'block' }}>Réservations à venir</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">kpiValue + kpiLabel — chiffres en sans, tabulaires (jamais de serif sur un montant)</Typography>
              <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>À encaisser</Typography>
              <Typography variant="kpiValue">{formatCurrency(2340.5)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">body1 / body2 — Inter</Typography>
              <Typography variant="body1">Le client arrive à 15h00, la caution de 500 € est à percevoir.</Typography>
              <Typography variant="body2" color="text.secondary">Ligne secondaire — détail, aide, légende.</Typography>
            </Box>
          </Stack>
        </Section>

        <Section title="Espacements & rayons">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Échelle bénie : <code>0.5, 1, 1.5, 2, 3</code> (× {theme.spacing(1)}) — rien d'autre.
            Rayon global : <code>{theme.shape.borderRadius}px</code>.
          </Typography>
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[0.5, 1, 1.5, 2, 3].map((s) => (
              <Stack key={s} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: theme.spacing(s), height: theme.spacing(s), bgcolor: 'primary.main', borderRadius: 0.5 }} />
                <Typography variant="caption" color="text.secondary">{s}</Typography>
              </Stack>
            ))}
            <Box sx={{
              ml: { sm: 3 }, px: 3, py: 1.5, bgcolor: 'background.paper', borderRadius: 1,
              boxShadow: theme.components.MuiCard.styleOverrides.root.boxShadow,
            }}
            >
              <Typography variant="body2">Carte — rayon {theme.shape.borderRadius}px, ombre chaude</Typography>
            </Box>
          </Stack>
        </Section>

        <Section title="Composants — états">
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="caption" color="text.secondary">LoadingState (spinner)</Typography>
              <LoadingState py={2} label="Chargement…" />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="caption" color="text.secondary">LoadingState (skeleton)</Typography>
              <LoadingState variant="skeleton" rows={2} />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="caption" color="text.secondary">EmptyState</Typography>
              <EmptyState
                icon={<InboxIcon />}
                message="Aucune réservation sur cette période."
                actionLabel="Créer une réservation"
                onAction={() => showSuccess('Action déclenchée depuis EmptyState.')}
                py={2}
              />
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">ErrorAlert (avec « Réessayer »)</Typography>
          <ErrorAlert onRetry={() => showSuccess('Réessayer déclenché.')} sx={{ mt: 0.5 }} />
        </Section>

        <Section title="Composants — feedback & dialogues">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            <code>useToast()</code> est le seul canal de feedback post-action ; les dialogues partagés
            passent en plein écran sous <code>sm</code>.
          </Typography>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={() => showSuccess('Enregistré.')}>Toast succès</Button>
            <Button variant="contained" color="error" onClick={() => showError("Échec de l'enregistrement.")}>Toast erreur</Button>
            <Button variant="outlined" onClick={() => confirm({ title: 'Supprimer le logement', message: 'Cette action est irréversible.', confirmLabel: 'Supprimer' })}>ConfirmDialog</Button>
            <Button variant="outlined" onClick={() => alert({ title: 'Information', message: 'Le paiement a été vérifié.' })}>Alert dialog</Button>
            <Button variant="outlined" onClick={() => openForm({ title: 'Nouveau client', content: <Typography variant="body2">Contenu du formulaire…</Typography> })}>FormDialog</Button>
            <Button variant="outlined" onClick={() => setUnsavedOpen(true)}>UnsavedChangesDialog</Button>
          </Stack>
          <UnsavedChangesDialog
            open={unsavedOpen}
            onStay={() => setUnsavedOpen(false)}
            onDiscard={() => { setUnsavedOpen(false); showError('Modifications perdues (démo).'); }}
            onSaveAndQuit={() => { setUnsavedOpen(false); showSuccess('Enregistré et quitté (démo).'); }}
          />
        </Section>

        <Section title="Composants — badges & puces">
          <Typography variant="caption" color="text.secondary">StatusBadge — fond doux + texte foncé, une seule variante par sémantique</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5, mb: 2 }}>
            <StatusBadge status="success" label="Payé" />
            <StatusBadge status="info" label="Acompte reçu" />
            <StatusBadge status="warning" label="Solde à venir" />
            <StatusBadge status="error" label="Caution à percevoir" />
            <StatusBadge status="neutral" label="Brouillon" />
          </Stack>
          <Typography variant="caption" color="text.secondary">PlatformChip — couleur plateforme, texte blanc</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
            <PlatformChip platform="Airbnb" />
            <PlatformChip platform="Booking" />
            <PlatformChip platform="Direct" />
          </Stack>
        </Section>

        <Section title="Composants — ResponsiveTable">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Tableau sur <code>md+</code>, cartes empilées sur <code>xs</code> — redimensionne la fenêtre
            pour voir la bascule. Montants à droite en chiffres tabulaires (règle §3.5).
          </Typography>
          <ResponsiveTable
            items={DEMO_ROWS}
            getKey={(r) => r.id}
            minWidth={480}
            head={(
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Montant</TableCell>
              </TableRow>
            )}
            renderRow={(r) => (
              <TableRow key={r.id} hover>
                <TableCell>{r.client}</TableCell>
                <TableCell>{r.logement}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatCurrency(r.montant)}</TableCell>
              </TableRow>
            )}
            renderMobileCard={(r) => (
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.client}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.logement}</Typography>
                </Box>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(r.montant)}</Typography>
              </Stack>
            )}
          />
        </Section>

        <Section title="Formats d'affichage (utils/formatters.js)">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            La seule façon d'écrire montants et dates — jamais de <code>toFixed</code> ni de
            <code> toLocaleDateString</code> local dans une page.
          </Typography>
          <Stack divider={<Divider />}>
            <FormatRow code="formatCurrency(1234.5)" value={formatCurrency(1234.5)} />
            <FormatRow code="formatCurrencyRounded(1234.5) — KPI / graphiques" value={formatCurrencyRounded(1234.5)} />
            <FormatRow code="displayDate('2026-07-10')" value={displayDate('2026-07-10')} />
            <FormatRow code="displayDateShort('2026-07-10')" value={displayDateShort('2026-07-10')} />
            <FormatRow code="displayDateLong('2026-07-10')" value={displayDateLong('2026-07-10')} />
            <FormatRow code="displayDateTime('2026-07-10 14:35')" value={displayDateTime('2026-07-10 14:35')} />
            <FormatRow code="formatCurrency(null) — cellule vide" value={formatCurrency(null)} />
          </Stack>
        </Section>

      </Box>
    </Box>
  );
}
