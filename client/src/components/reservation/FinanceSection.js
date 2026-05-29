import React from 'react';
import { Box, Card, CardContent, Typography, Stack, Divider, Grid, TextField, Button } from '@mui/material';
import api from '../../api';
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
                <Grid item xs={12} md={6}>
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
                <Grid item xs={12} md={6}>
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
                      <TextField
                        label="Prix ajusté"
                        type="number"
                        value={form.customPrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateForm({ customPrice: val === '' ? '' : Math.max(0, Number(val) || 0) });
                        }}
                        onFocus={(e) => e.target.select()}
                        fullWidth
                        inputProps={{ min: 0, step: 0.01 }}
                        sx={{
                          mt: 1,
                          '& input[type=number]': {
                            MozAppearance: 'textfield',
                          },
                          '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': {
                            WebkitAppearance: 'none',
                            margin: 0,
                          }
                        }}
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
                          inputProps={{ min: 0, max: 100 }}
                          size="small"
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
              const grossBelowNet = grossNumber != null && Number.isFinite(grossNumber) && grossNumber < net;
              return (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>Plateforme</Typography>
                    <Grid container spacing={2} sx={sectionGridSx} alignItems="flex-start">
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Prix payé par le client"
                          type="number"
                          value={form.clientGrossAmount ?? ''}
                          onChange={(e) => updateForm({ clientGrossAmount: e.target.value === '' ? '' : Number(e.target.value) })}
                          onFocus={(e) => e.target.select()}
                          fullWidth
                          size="small"
                          inputProps={{ min: 0, step: 0.01 }}
                          error={grossBelowNet}
                          helperText={grossBelowNet
                            ? `Doit être ≥ ${net.toFixed(2)}€ (montant net que tu touches).`
                            : 'Montant TTC réellement payé par le client sur la plateforme.'}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
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
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }} gutterBottom>Acompte</Typography>
                  <TextField
                    label="Échéance acompte"
                    type="date"
                    value={form.depositDueDate}
                    disabled={isReservationLocked}
                    InputLabelProps={{ shrink: true }}
                    onChange={(e) => updateForm({ depositDueDate: e.target.value })}
                    fullWidth
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
                      InputLabelProps={{ shrink: true }}
                      onChange={async (e) => {
                        const v = e.target.value;
                        updateForm({ depositPaidDate: v });
                        if (isReservationLocked && editingReservationId) {
                          await api.markPayment(editingReservationId, { depositPaid: true, depositPaidDate: v || null });
                        }
                      }}
                      fullWidth
                      sx={{ mt: 1.5 }}
                    />
                  )}
                </Grid>

                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }} gutterBottom>Solde</Typography>
                  <TextField
                    label="Échéance solde"
                    type="date"
                    value={form.balanceDueDate}
                    disabled={isReservationLocked}
                    InputLabelProps={{ shrink: true }}
                    onChange={(e) => updateForm({ balanceDueDate: e.target.value })}
                    fullWidth
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
                      InputLabelProps={{ shrink: true }}
                      onChange={async (e) => {
                        const v = e.target.value;
                        updateForm({ balancePaidDate: v });
                        if (isReservationLocked && editingReservationId) {
                          await api.markPayment(editingReservationId, { balancePaid: true, balancePaidDate: v || null });
                        }
                      }}
                      fullWidth
                      sx={{ mt: 1.5 }}
                    />
                  )}
                </Grid>
              </Grid>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1.5 }}>Caution</Typography>
              <Grid container spacing={1.5} sx={sectionGridSx}>
                <Grid item xs={12} md={6}>
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
                    InputLabelProps={{ shrink: true }}
                    onChange={(e) => {
                      const selectedDate = e.target.value;
                      updateForm({
                        cautionReceivedDate: selectedDate,
                        cautionReceived: selectedDate ? true : form.cautionReceived,
                      });
                    }}
                    fullWidth
                    sx={{ mt: 2 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
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
                    InputLabelProps={{ shrink: true }}
                    onChange={(e) => updateForm({ cautionReturnedDate: e.target.value })}
                    fullWidth
                    sx={{ mt: 2 }}
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
