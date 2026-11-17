/**
 * MollieClearingCard — what the accountant needs beside the Mollie entries of the month
 * (specs/mollie-rolling-reserve-and-incoming-payments.md rules 30-31): the balance of the clearing account at the
 * end of the month with its detail (the clients whose reserve Mollie still holds), and the Mollie credits no payment
 * explains yet — listed, never booked (no line is produced for them).
 *
 * Every figure, date and name is the server's (`sales.mollie`); nothing is added up here.
 *
 * Props:
 *   mollie:               { clearing: { account, asOf, balance, clients: [{ reservationId, saleKey, clientName, balance }] },
 *                           unattached: [{ date, amount, qontoReference, settlementReference, counterparty }] }
 *   canOpenReservation:   boolean — the viewer may open a fiche (admins; accountants are read-only on the accounting);
 *                         a client from a sale outside a stay (`reservationId` null, `saleKey` set) has no fiche
 *   onOpenReservation:    (reservationId) → void
 */
import React from 'react';
import { Box, Card, CardContent, Divider, Link, Stack, Typography } from '@mui/material';
import { displayDate, formatCurrency, TransactionRef } from '../sdk';

const AMOUNT_SX = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 600 };

export default function MollieClearingCard({ mollie, canOpenReservation = false, onOpenReservation = () => {} }) {
  if (!mollie) return null;
  const { clearing, unattached = [] } = mollie;
  return (
    <Card variant="outlined" sx={{ mb: 3 }} data-testid="mollie-clearing">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="sectionHeader">Compte d’attente Mollie</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          L’argent que Mollie détient encore pour le compte du domaine : paiements en transit et retenues. Aide au rapprochement du cabinet.
        </Typography>

        {clearing && (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="body2">Solde du compte {clearing.account} au {displayDate(clearing.asOf)}</Typography>
              <Typography sx={{ ...AMOUNT_SX, fontSize: '1.15rem', fontWeight: 700 }}>{formatCurrency(clearing.balance)}</Typography>
            </Box>
            {clearing.clients.length > 0 && (
              <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
                {clearing.clients.map((client) => (
                  <Box key={client.reservationId == null ? `sale:${client.saleKey}` : client.reservationId} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1, minHeight: 44, alignItems: 'center' }}>
                    {canOpenReservation && client.reservationId != null ? (
                      <Link component="button" type="button" underline="hover" onClick={() => onOpenReservation(client.reservationId)} sx={{ textAlign: 'left', minHeight: 44, overflowWrap: 'anywhere' }}>
                        {client.clientName}
                      </Link>
                    ) : (
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{client.clientName}</Typography>
                    )}
                    <Typography variant="body2" sx={AMOUNT_SX}>{formatCurrency(client.balance)}</Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </>
        )}

        {unattached.length > 0 && (
          <Box sx={{ mt: clearing ? 3 : 0 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Versement Mollie non rattaché</Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Aucune écriture n’est produite pour ces crédits tant qu’aucun paiement ne les explique.
            </Typography>
            <Stack divider={<Divider flexItem />}>
              {unattached.map((credit) => (
                <Box key={credit.qontoReference || `${credit.date}-${credit.amountCents}`} sx={{ py: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{displayDate(credit.date)} · {credit.counterparty}</Typography>
                    <Typography variant="body2" sx={AMOUNT_SX}>{formatCurrency(credit.amount)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
                    <TransactionRef label="Qonto" value={credit.qontoReference} />
                    <TransactionRef label="Lot Mollie" value={credit.settlementReference} />
                  </Box>
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
