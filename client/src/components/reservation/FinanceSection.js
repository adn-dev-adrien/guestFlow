import React from 'react';
import { Box, Card, CardContent, Typography, Stack, Divider, Grid, TextField, Button, Switch, FormControlLabel, Tooltip } from '@mui/material';
import api from '../../api';
import ArithmeticTextField from '../ArithmeticTextField';
import { useReservationForm } from './ReservationFormContext';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Finance card: adjusted accommodation price + "Actualiser tarifs", deposit / balance / caution with paid toggles.
 * Reads everything from the reservation form context — no props.
 */
export default function FinanceSection() {
  const {
    formSectionCardSx, formSectionContentSx, sectionGridSx,
    form, updateForm, pricingQuote, accommodationBasePriceDisplay,
    isDevisMode, reservationId, editingReservationId, isReservationLocked, refreshToCurrentPricing,
  } = useReservationForm();

  return (
    <Card variant="outlined" sx={formSectionCardSx}>
      <CardContent sx={formSectionContentSx}>
        <Box sx={{ position: 'relative', zIndex: 10 }}>
          <Stack spacing={2.5}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 700, mb: 0 }}>Finance</Typography>
                {(isDevisMode || reservationId) && (
                  <Button variant="outlined" color="warning" size="small" onClick={refreshToCurrentPricing} disabled={isReservationLocked}>
                    Actualiser tarifs
                  </Button>
                )}
              </Box>

              <Grid container spacing={2} alignItems="stretch" sx={sectionGridSx}>
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Card variant="outlined" sx={{ height: '100%', bgcolor: '#f7fafc', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        Prix hébergement brut
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.5 }}>
                        {accommodationBasePriceDisplay ?? '—'}€
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Tarif calculé par le serveur
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: '100%',
                      borderColor: form.customPrice !== '' ? 'info.main' : 'divider',
                      bgcolor: form.customPrice !== '' ? 'rgba(33, 150, 243, 0.08)' : '#fff',
                    }}
                  >
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        Prix hébergement ajusté
                      </Typography>
                      {/* Accepts arithmetic: typing e.g. "100+20" commits 120 on Enter/blur
                          (specs/reservation-price-arithmetic.md). */}
                      <ArithmeticTextField
                        label="Prix ajusté"
                        value={form.customPrice}
                        onCommit={(v) => updateForm({ customPrice: v })}
                        fullWidth
                        sx={{ mt: 1 }}
                        size="small"
                      />
                      {form.customPrice !== '' && accommodationBasePriceDisplay && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {pricingQuote?.accommodationDeltaType === 'reduction'
                              ? `Réduction: ${Number(pricingQuote.accommodationDeltaAmount || 0).toFixed(2)}€`
                              : pricingQuote?.accommodationDeltaType === 'increase'
                                ? `Augmentation: ${Number(pricingQuote.accommodationDeltaAmount || 0).toFixed(2)}€`
                                : 'Aucun écart'}
                          </Typography>
                        </Box>
                      )}
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
                        <TextField
                          label="Réduction (%)"
                          type="number"
                          value={form.discountPercent}
                          onChange={(e) => updateForm({ discountPercent: Number(e.target.value), customPrice: '' })}
                          fullWidth
                          size="small"
                          slotProps={{
                            htmlInput: { min: 0, max: 100 }
                          }}
                        />
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>

            {String(form.platform || 'direct').toLowerCase() !== 'direct' && (() => {
              const grossRaw = form.clientGrossAmount;
              const grossNumber = grossRaw === '' || grossRaw == null ? null : Number(grossRaw);
              const net = Number(pricingQuote?.finalPrice || 0);
              const commission = grossNumber != null && Number.isFinite(grossNumber)
                ? Math.max(0, Math.round((grossNumber - net) * 100) / 100)
                : null;
              // specs/force-extras-complement-on-platform.md §10 (2026-06-08): the platform covers
              // the SOLDE only (extras/complément are collected on arrival), so the gross is
              // validated against the balance, not the full stay. Commission display is unchanged
              // (gross − net encaissé).
              const balanceRef = Number(pricingQuote?.balanceAmount || 0);
              const grossBelowNet = grossNumber != null && Number.isFinite(grossNumber) && grossNumber < balanceRef;
              return (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>Plateforme</Typography>
                    <Grid container spacing={2} sx={sectionGridSx} alignItems="flex-start">
                      <Grid
                        size={{
                          xs: 12,
                          md: 6
                        }}>
                        {/* Accepts arithmetic (e.g. "350+12,50"), committed on Enter/blur. */}
                        <ArithmeticTextField
                          label="Prix payé par le client"
                          value={form.clientGrossAmount ?? ''}
                          onCommit={(v) => updateForm({ clientGrossAmount: v })}
                          fullWidth
                          size="small"
                          error={grossBelowNet}
                          helperText={grossBelowNet
                            ? `Doit être ≥ ${balanceRef.toFixed(2)}€ (solde réglé via la plateforme).`
                            : 'Montant TTC réellement payé par le client sur la plateforme.'}
                        />
                      </Grid>
                      <Grid
                        size={{
                          xs: 12,
                          md: 6
                        }}>
                        <Box sx={{ p: 1.5, bgcolor: '#f7fafc', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                            Commission plateforme
                          </Typography>
                          <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.5 }}>
                            {commission == null ? '—' : `${commission.toFixed(2)}€`}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Calculée automatiquement : prix payé client − net encaissé ({net.toFixed(2)}€).
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>
                  </Box>
                </>
              );
            })()}

            <Divider />

            <Box>
              <Grid container spacing={2} sx={sectionGridSx}>
                {/* accounting-platform-commission-and-no-deposit.md §3.3 rule 5 + §3.8 rule 21.
                    Platform reservations are paid in a single bank transfer — no acompte.
                    The whole pre-arrival amount lands on the Solde block to the right. */}
                {String(form.platform || 'direct').toLowerCase() !== 'direct' ? (
                  <Grid
                    size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>Acompte</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      Pas d'acompte (réservation plateforme — virement unique). Le montant total est
                      encaissé en une fois via le Solde.
                    </Typography>
                  </Grid>
                ) : (
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ mb: 0 }}>Acompte</Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={Boolean(form.depositDisabled)}
                          onChange={(e) => updateForm({
                            depositDisabled: e.target.checked,
                            // When the operator disables the deposit, also clear the paid flags
                            // so the next save doesn't persist an inconsistent (disabled + paid)
                            // state. The server enforces the same on its side; the client mirror
                            // keeps the UI consistent immediately. See
                            // specs/disable-deposit-per-reservation.md.
                            ...(e.target.checked ? { depositPaid: false, depositPaidDate: '' } : {}),
                          })}
                          disabled={isReservationLocked && !editingReservationId}
                        />
                      }
                      label={<Typography variant="caption" color="text.secondary">Désactiver</Typography>}
                      labelPlacement="start"
                      sx={{ mr: 0, ml: 0 }}
                    />
                  </Box>

                  {form.depositDisabled ? (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
                      Acompte désactivé — ajouté au solde.
                    </Typography>
                  ) : (
                    <>
                      {/* Manual deposit override (specs/editable-deposit-amount.md). Empty = auto
                          (percentage). A value freezes the acompte; the solde absorbs tariff changes.
                          Hidden in devis mode (out of scope) and locked once the acompte is paid.
                          Accepts arithmetic like "Prix ajusté" (commit on Enter/blur). */}
                      {!isDevisMode && (
                        <ArithmeticTextField
                          label="Montant acompte (€)"
                          value={form.depositAmountOverride}
                          onCommit={(v) => updateForm({ depositAmountOverride: v })}
                          fullWidth
                          size="small"
                          disabled={isReservationLocked || Boolean(form.depositPaid)}
                          sx={{ mb: 1.5 }}
                          helperText={
                            form.depositPaid
                              ? 'Acompte payé, montant figé.'
                              : form.depositAmountOverride !== ''
                                ? 'Acompte figé — le solde absorbe les variations de tarif.'
                                : `Calcul automatique${pricingQuote?.property?.depositPercent != null ? ` (${pricingQuote.property.depositPercent}%)` : ''}. Saisir un montant pour le figer.`
                          }
                        />
                      )}
                      <TextField
                        label="Échéance acompte"
                        type="date"
                        value={form.depositDueDate}
                        disabled={isReservationLocked}
                        onChange={(e) => updateForm({ depositDueDate: e.target.value })}
                        fullWidth
                        slotProps={{
                          inputLabel: { shrink: true }
                        }}
                      />
                      <Button
                        fullWidth
                        variant={form.depositPaid ? 'contained' : 'outlined'}
                        color={form.depositPaid ? 'success' : 'inherit'}
                        onClick={async () => {
                          const next = !form.depositPaid;
                          const today = todayStr();
                          const date = next ? (form.depositPaidDate || today) : '';
                          if (isReservationLocked && editingReservationId) {
                            await api.markPayment(editingReservationId, { depositPaid: next, depositPaidDate: date || null });
                          }
                          updateForm({ depositPaid: next, depositPaidDate: date });
                        }}
                        sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                      >
                        {form.depositPaid ? 'Acompte payé' : 'Marquer acompte payé'}
                      </Button>
                      {form.depositPaid && (
                        <TextField
                          label="Payé le"
                          type="date"
                          value={form.depositPaidDate || ''}
                          onChange={async (e) => {
                            const v = e.target.value;
                            updateForm({ depositPaidDate: v });
                            if (isReservationLocked && editingReservationId) {
                              await api.markPayment(editingReservationId, { depositPaid: true, depositPaidDate: v || null });
                            }
                          }}
                          fullWidth
                          sx={{ mt: 1.5 }}
                          slotProps={{
                            inputLabel: { shrink: true }
                          }}
                        />
                      )}
                    </>
                  )}
                </Grid>
                )}

                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }} gutterBottom>Solde</Typography>
                  <TextField
                    label="Échéance solde"
                    type="date"
                    value={form.balanceDueDate}
                    disabled={isReservationLocked}
                    onChange={(e) => updateForm({ balanceDueDate: e.target.value })}
                    fullWidth
                    slotProps={{
                      inputLabel: { shrink: true }
                    }}
                  />
                  <Button
                    fullWidth
                    variant={form.balancePaid ? 'contained' : 'outlined'}
                    color={form.balancePaid ? 'success' : 'inherit'}
                    onClick={async () => {
                      const next = !form.balancePaid;
                      const today = todayStr();
                      const date = next ? (form.balancePaidDate || today) : '';
                      if (isReservationLocked && editingReservationId) {
                        await api.markPayment(editingReservationId, { balancePaid: next, balancePaidDate: date || null });
                      }
                      updateForm({ balancePaid: next, balancePaidDate: date });
                    }}
                    sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {form.balancePaid ? 'Solde payé' : 'Marquer solde payé'}
                  </Button>
                  {form.balancePaid && (
                    <TextField
                      label="Payé le"
                      type="date"
                      value={form.balancePaidDate || ''}
                      onChange={async (e) => {
                        const v = e.target.value;
                        updateForm({ balancePaidDate: v });
                        if (isReservationLocked && editingReservationId) {
                          await api.markPayment(editingReservationId, { balancePaid: true, balancePaidDate: v || null });
                        }
                      }}
                      fullWidth
                      sx={{ mt: 1.5 }}
                      slotProps={{
                        inputLabel: { shrink: true }
                      }}
                    />
                  )}
                </Grid>
              </Grid>
            </Box>

            {/* Per-item routing for the tourist tax (spec force-item-to-complement.md §6.4).
                When ON, the tax bypasses the auto deposit/balance split and lives 100 % in the
                Complément entry. Hidden when:
                  - no tax to route (touristTaxTotal === 0), OR
                  - the engine already routes the tax to Complément on its own — i.e. the
                    booking is on a non-direct platform configured to NOT collect the tax
                    (`touristTaxCollectedOnArrival = true`). In that case the toggle is moot:
                    the tax always lands in Complément, the user can't change it, showing the
                    Switch would only be confusing. */}
            {Number(pricingQuote?.touristTaxTotal || 0) > 0
              && !Boolean(pricingQuote?.touristTaxCollectedOnArrival) && (
              <>
                <Divider />
                <Box>
                  <Tooltip title="Lorsque cette option est activée, la taxe de séjour n'est pas comprise dans l'acompte ni le solde : elle est intégralement perçue dans le Complément à percevoir (par exemple, encaissée à l'arrivée)." arrow>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={Boolean(form.touristTaxInComplement)}
                          onChange={(e) => updateForm({ touristTaxInComplement: e.target.checked })}
                        />
                      }
                      label={
                        <Typography variant="body2">
                          Taxe de séjour en complément
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            ({Number(pricingQuote.touristTaxTotal).toFixed(2).replace('.', ',')} €)
                          </Typography>
                        </Typography>
                      }
                    />
                  </Tooltip>
                </Box>
              </>
            )}

            {Number(pricingQuote?.complementAmount || 0) > 0 && (
              <>
                <Divider />
                <Box>
                  <Grid container spacing={2} sx={sectionGridSx}>
                    <Grid
                      size={{
                        xs: 12,
                        md: 6
                      }}>
                      {/* Red border tant qu'impayé pour signaler le reste à percevoir ; bascule en visuel
                          neutre (= Acompte/Solde payé) une fois le complément encaissé. */}
                      <Box
                        sx={{
                          border: form.complementPaid ? 'none' : '1px solid',
                          borderColor: form.complementPaid ? 'transparent' : 'error.main',
                          borderRadius: 1,
                          p: form.complementPaid ? 0 : 1.5,
                        }}
                      >
                        <Typography variant="subtitle2" sx={{ mb: 2 }} gutterBottom>
                          Complément à percevoir
                          <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary', fontWeight: 500 }}>
                            ({Number(pricingQuote.complementAmount).toFixed(2).replace('.', ',')} €)
                          </Typography>
                        </Typography>
                        <Button
                          fullWidth
                          variant={form.complementPaid ? 'contained' : 'outlined'}
                          color={form.complementPaid ? 'success' : 'inherit'}
                          onClick={async () => {
                            const next = !form.complementPaid;
                            const today = todayStr();
                            const date = next ? (form.complementPaidDate || today) : '';
                            if (isReservationLocked && editingReservationId) {
                              await api.markPayment(editingReservationId, { complementPaid: next, complementPaidDate: date || null });
                            }
                            updateForm({ complementPaid: next, complementPaidDate: date });
                          }}
                          sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                        >
                          {form.complementPaid ? 'Complément payé' : 'Marquer complément payé'}
                        </Button>
                        {form.complementPaid && (
                          <TextField
                            label="Payé le"
                            type="date"
                            value={form.complementPaidDate || ''}
                            onChange={async (e) => {
                              const v = e.target.value;
                              updateForm({ complementPaidDate: v });
                              if (isReservationLocked && editingReservationId) {
                                await api.markPayment(editingReservationId, { complementPaid: true, complementPaidDate: v || null });
                              }
                            }}
                            fullWidth
                            sx={{ mt: 1.5 }}
                            slotProps={{
                              inputLabel: { shrink: true }
                            }}
                          />
                        )}
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
              </>
            )}

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1.5 }}>Caution</Typography>
              <Grid container spacing={1.5} sx={sectionGridSx}>
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Button
                    fullWidth
                    variant={form.cautionReceived ? 'contained' : 'outlined'}
                    color={form.cautionReceived ? 'info' : 'inherit'}
                    onClick={async () => {
                      const next = !form.cautionReceived;
                      const today = todayStr();
                      if (isReservationLocked && editingReservationId) {
                        const date = next ? today : '';
                        await api.markPayment(editingReservationId, { cautionReceived: next, cautionReceivedDate: date });
                        updateForm({ cautionReceived: next, cautionReceivedDate: date });
                      } else {
                        updateForm({ cautionReceived: next, cautionReceivedDate: next ? today : '' });
                      }
                    }}
                    sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {form.cautionReceived ? 'Caution reçue' : 'Marquer caution reçue'}
                  </Button>
                  <TextField
                    label="Date réception"
                    type="date"
                    value={form.cautionReceivedDate}
                    onChange={(e) => {
                      const selectedDate = e.target.value;
                      updateForm({
                        cautionReceivedDate: selectedDate,
                        cautionReceived: selectedDate ? true : form.cautionReceived,
                      });
                    }}
                    fullWidth
                    sx={{ mt: 2 }}
                    slotProps={{
                      inputLabel: { shrink: true }
                    }}
                  />
                </Grid>
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Button
                    fullWidth
                    variant={form.cautionReturned ? 'contained' : 'outlined'}
                    color={form.cautionReturned ? 'secondary' : 'inherit'}
                    onClick={async () => {
                      const next = !form.cautionReturned;
                      const today = todayStr();
                      if (isReservationLocked && editingReservationId) {
                        const date = next ? today : form.cautionReturnedDate;
                        await api.markPayment(editingReservationId, { cautionReturned: next, cautionReturnedDate: date });
                        updateForm({ cautionReturned: next, cautionReturnedDate: date });
                      } else {
                        updateForm({ cautionReturned: next, cautionReturnedDate: next ? today : form.cautionReturnedDate });
                      }
                    }}
                    sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {form.cautionReturned ? 'Caution restituée' : 'Marquer caution restituée'}
                  </Button>
                  <TextField
                    label="Date restitution"
                    type="date"
                    value={form.cautionReturnedDate}
                    onChange={(e) => updateForm({ cautionReturnedDate: e.target.value })}
                    fullWidth
                    sx={{ mt: 2 }}
                    slotProps={{
                      inputLabel: { shrink: true }
                    }}
                  />
                </Grid>
              </Grid>
            </Box>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
