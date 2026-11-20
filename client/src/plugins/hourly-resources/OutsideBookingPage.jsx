/**
 * OutsideBookingPage — « Passage », the fiche of a booking made outside a stay (specs/gift-voucher-campaigns.md rule 53), at `/passages/:bookingId`.
 *
 * It renders `GET /api/resource-bookings/:id/fiche` and computes nothing: the client, the session(s), the sale's lines with what paid each (the words their payer gave,
 * « Réglé par … »), the payments and the lines to refund, the terms accepted, the arrival or the absence, and the journal newest first. The page bar's « Arrivée »
 * opens the visit's mini SAS. From `md` the details sit left and the history right; on a phone one column, the history below.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router';
import {
  Alert, Box, Link, Paper, Typography,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import {
  api, formatCurrency, displayDate, ErrorAlert, LoadingState, PageActionBar, StatusBadge, SummaryItem, useToast,
} from '../sdk';
import ResourceArrivalDialog from './ResourceArrivalDialog';

const TEXTS = Object.freeze({
  title: 'Passage',
  back: 'Retour',
  arrival: 'Arrivée',
  client: 'Client',
  sessions: 'Séance',
  sales: 'Ventes',
  noSales: 'Aucune vente enregistrée.',
  paymentsTitle: 'Paiements',
  noPayments: 'Aucun paiement.',
  refunds: 'À rembourser',
  terms: 'Conditions générales acceptées',
  noTerms: 'Aucune acceptation enregistrée.',
  visit: 'Arrivée et absence',
  history: 'Historique',
  email: 'E-mail',
  phone: 'Téléphone',
  linked: 'Fiche client',
  notTaken: 'Non pris',
  paidBy: (label) => `Réglé par ${label}`,
  version: (v) => `version ${v}`,
  loadFailed: 'La fiche n’a pas pu être chargée.',
  arrivalDone: 'Arrivée enregistrée.',
  total: 'Total',
  paid: 'Déjà payé',
  remaining: 'Reste à payer',
});

const ARRIVAL_LABELS = Object.freeze({ expected: 'Attendu', arrived: 'Arrivé', noShow: 'Absent' });
const ARRIVAL_TONES = Object.freeze({ expected: 'info', arrived: 'success', noShow: 'warning' });

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const when = (at) => {
  const date = new Date(String(at).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(at) : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

function Block({ title, children }) {
  return (
    <Paper variant="outlined" component="section" aria-label={title} sx={{ p: { xs: 1.5, sm: 2 }, display: 'grid', gap: 1 }}>
      <Typography variant="subtitle2" component="h2">{title}</Typography>
      {children}
    </Paper>
  );
}

function ClientBlock({ client }) {
  return (
    <Block title={TEXTS.client}>
      <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{client.name}</Typography>
      {client.email && <SummaryItem label={TEXTS.email} value={client.email} />}
      {client.phone && <SummaryItem label={TEXTS.phone} value={client.phone} />}
      {client.clientId && (
        <Link component={RouterLink} to={`/clients?clientId=${client.clientId}`} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>{TEXTS.linked}</Link>
      )}
    </Block>
  );
}

function SalesBlock({ fiche }) {
  const { lines, totals } = fiche;
  return (
    <Block title={TEXTS.sales}>
      {!lines.length && <Typography variant="body2" color="text.secondary">{TEXTS.noSales}</Typography>}
      {lines.map((line) => (
        <Box key={line.ref} sx={{ display: 'grid', gap: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'baseline' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>
              {line.quantity > 1 ? `${line.quantity} × ` : ''}{line.label}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{euros(line.totalCents)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            <StatusBadge status={line.status === 'paid' ? 'success' : 'warning'} label={line.statusLabel} />
            {line.paidBy.map((paid) => <StatusBadge key={`${paid.kind}-${paid.label}`} status="info" label={TEXTS.paidBy(paid.label)} />)}
            {line.notTaken && <StatusBadge status="neutral" label={TEXTS.notTaken} />}
          </Box>
        </Box>
      ))}
      {totals && (
        <Box sx={{ display: 'grid', gap: 0.25, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <SummaryItem label={TEXTS.total} value={euros(totals.totalCents)} />
          <SummaryItem label={TEXTS.paid} value={euros(totals.paidCents)} />
          <SummaryItem label={TEXTS.remaining} value={euros(totals.remainingCents)} />
        </Box>
      )}
    </Block>
  );
}

function PaymentsBlock({ payments, refunds }) {
  return (
    <Block title={TEXTS.paymentsTitle}>
      {!payments.length && <Typography variant="body2" color="text.secondary">{TEXTS.noPayments}</Typography>}
      {payments.map((payment) => (
        <Box key={payment.id} sx={{ display: 'grid', gap: 0.25 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
            <Typography variant="body2">{when(payment.paidAt)}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euros(payment.receivedCents)}</Typography>
          </Box>
          {payment.tenders.map((tender, index) => (
            <Typography key={index} variant="caption" color="text.secondary">{`${tender.label} · ${euros(tender.amountCents)}`}</Typography>
          ))}
        </Box>
      ))}
      {refunds.length > 0 && (
        <Box sx={{ display: 'grid', gap: 0.5, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" component="h3">{TEXTS.refunds}</Typography>
          {refunds.map((row) => (
            <Alert key={row.id} severity="warning">{[row.label, row.detail].filter(Boolean).join(' · ')}</Alert>
          ))}
        </Box>
      )}
    </Block>
  );
}

function TermsBlock({ terms }) {
  return (
    <Block title={TEXTS.terms}>
      {!terms.length && <Typography variant="body2" color="text.secondary">{TEXTS.noTerms}</Typography>}
      {terms.map((accepted) => (
        <Typography key={`${accepted.activity}-${accepted.version}`} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {`${accepted.activityLabel} · ${TEXTS.version(accepted.version)} · ${when(accepted.acceptedAt)} · ${accepted.channelLabel}`}
        </Typography>
      ))}
    </Block>
  );
}

function HistoryBlock({ history }) {
  return (
    <Block title={TEXTS.history}>
      <Box component="ol" aria-label={TEXTS.history} sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.25 }}>
        {history.map((entry, index) => (
          <Box component="li" key={`${entry.at}-${index}`}>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{entry.text}</Typography>
            <Typography variant="caption" color="text.secondary">{[when(entry.at), entry.actor].filter(Boolean).join(' · ')}</Typography>
          </Box>
        ))}
      </Box>
    </Block>
  );
}

export default function OutsideBookingPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { showSuccess } = useToast();
  const [fiche, setFiche] = useState(null);
  const [error, setError] = useState(null);
  const [arrivalOpen, setArrivalOpen] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return api.getResourceBookingFiche(bookingId).then((res) => setFiche(res.fiche)).catch((e) => setError((e && e.message) || TEXTS.loadFailed));
  }, [bookingId]);
  useEffect(() => { setFiche(null); load(); }, [load]);

  const closeArrival = () => setArrivalOpen(false);
  let body;
  if (error) body = <ErrorAlert message={error} onRetry={load} />;
  else if (!fiche) body = <LoadingState />;
  else {
    const { booking, sessions, arrival } = fiche;
    body = (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.4fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <ClientBlock client={fiche.client} />
          <Block title={TEXTS.sessions}>
            {sessions.map((session) => (
              <Typography key={`${session.date}-${session.start}`} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {`${session.resourceName} · ${displayDate(session.date)} · ${session.start}–${session.end}`}
              </Typography>
            ))}
            {booking.notes && <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{booking.notes}</Typography>}
          </Block>
          <SalesBlock fiche={fiche} />
          <PaymentsBlock payments={fiche.payments} refunds={fiche.refunds} />
          <TermsBlock terms={fiche.terms} />
          <Block title={TEXTS.visit}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={ARRIVAL_TONES[arrival.state] || 'neutral'} label={ARRIVAL_LABELS[arrival.state] || arrival.state} />
              {arrival.at && <Typography variant="body2" color="text.secondary">{when(arrival.at)}</Typography>}
            </Box>
          </Block>
        </Box>
        <Box sx={{ minWidth: 0 }}><HistoryBlock history={fiche.history} /></Box>
      </Box>
    );
  }

  return (
    <Box>
      <PageActionBar
        title={fiche ? `${TEXTS.title} — ${fiche.client.name}` : TEXTS.title}
        onBack={() => navigate(-1)}
        actionsBefore={fiche ? [{ icon: <LoginIcon />, tooltip: TEXTS.arrival, onClick: () => setArrivalOpen(true), color: 'primary' }] : []}
      />
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>{body}</Box>
      {arrivalOpen && (
        <ResourceArrivalDialog
          open
          bookingId={Number(bookingId)}
          onClose={closeArrival}
          onDone={() => { closeArrival(); load(); showSuccess(TEXTS.arrivalDone); }}
        />
      )}
    </Box>
  );
}
