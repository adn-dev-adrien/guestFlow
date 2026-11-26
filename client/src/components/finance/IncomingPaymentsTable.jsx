/**
 * IncomingPaymentsTable — the detail of the « Versements à venir » tile of the Suivi financier
 * (specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 22-27): what the bank is still to receive, one
 * bordered block per client, one line per sum — date, nature (drawn icon + words + detail), amount, state.
 *
 * Feature-specific (one page, one payload). It renders `GET /api/finance/incoming` as it comes: the grouping, the
 * order (late first), every amount, date, state wording and tone are the server's (rule 26). The only thing done
 * here is hiding the kinds the operator switched off, on the rows already received, and the « Reçus récemment »
 * toggle, which asks the server for the other payload.
 *
 * Colour carries the STATE only (neutral / red / green badge); a nature is never a colour (rule 22).
 *
 * Props:
 *   data:               the payload ({ totals, kinds[], clients[] })
 *   recent:             boolean — the « Reçus ces 30 derniers jours » switch
 *   onRecentChange:     (boolean) → void
 *   onOpenReservation:  (reservationId) → void — a client with one stay opens it from the block's header; a client
 *                       with several stays opens each stay from its own lines. A sale outside a stay
 *                       (`reservationId` null, `saleKey` set) opens nothing
 *
 * Responsive: a line is one row (date | nature | amount | state) from 720 px of block width (container query),
 * otherwise nature on top, then date + amount + state. The header is a ≥ 44 px tap target.
 */
import React, { useState } from 'react';
import { Box, ButtonBase, Chip, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import HourglassBottomIcon from '@mui/icons-material/HourglassBottom';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import StatusBadge from '../StatusBadge';
import EmptyState from '../EmptyState';
import TransactionRef from '../TransactionRef';
import { formatCurrency } from '../../utils/formatters';

const ICONS = { hourglass: HourglassBottomIcon, card: CreditCardIcon, calendar: CalendarMonthIcon, house: HomeWorkIcon };
const TAB = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const WIDE = '@container (min-width: 720px)';
const EMPTY = 'Rien à recevoir : tout ce qui était attendu est arrivé.';
const EMPTY_RECENT = 'Rien de reçu ces 30 derniers jours.';

// One key per block: the server's `key` when it sends one, else the client, else what its stays are (a sale outside a
// stay or a stay without client has no `clientId`, and two of them may share a name).
const blockKey = (client) => {
  if (client.key != null) return String(client.key);
  if (client.clientId != null) return `client:${client.clientId}`;
  const stays = client.stays.map((stay) => (stay.reservationId != null ? `r${stay.reservationId}` : `s${stay.saleKey}`)).join('|');
  return stays ? `stays:${stays}` : `label:${client.name}`;
};

function KindIcon({ name, sx }) {
  const Icon = ICONS[name] || HourglassBottomIcon;
  return <Icon aria-hidden sx={{ fontSize: 18, ...sx }} />;
}

function Legend() {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 12.5 }}>
      <span>La couleur ne dit que l’état :</span>
      <StatusBadge status="neutral" label="À venir" />
      <StatusBadge status="error" label="En retard" />
      <StatusBadge status="success" label="Reçu" />
    </Box>
  );
}

function Line({ item, stayLabel, onOpen }) {
  const content = (
    <Box
      sx={{
        display: 'grid',
        columnGap: 2,
        rowGap: 0.5,
        alignItems: 'center',
        textAlign: 'left',
        width: '100%',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas: '"nature nature nature" "date amount state"',
        [WIDE]: {
          gridTemplateColumns: '110px minmax(0, 1fr) 110px 190px',
          gridTemplateAreas: '"date nature amount state"',
        },
      }}
    >
      <Typography component="span" variant="body2" sx={{ gridArea: 'date', fontWeight: 600, ...TAB }}>{item.dateLabel}</Typography>
      <Box sx={{ gridArea: 'nature', display: 'flex', gap: 1, alignItems: 'flex-start', minWidth: 0 }}>
        <KindIcon name={item.icon} sx={{ color: 'text.secondary', mt: '2px', flex: 'none' }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="span" variant="body2" sx={{ fontWeight: 600, display: 'block', overflowWrap: 'anywhere' }}>{item.natureLabel}</Typography>
          <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
            {[item.natureDetail, stayLabel].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      </Box>
      <Typography component="span" variant="body2" sx={{ gridArea: 'amount', justifySelf: 'end', fontWeight: 700, ...TAB }}>{formatCurrency(item.amountCents / 100)}</Typography>
      <Box sx={{ gridArea: 'state', justifySelf: 'end', [WIDE]: { justifySelf: 'start' } }}>
        <StatusBadge status={item.tone} label={item.stateLabel} />
      </Box>
    </Box>
  );
  const refs = item.refs || {};
  const hasRefs = Boolean(refs.qonto || refs.mollieSettlement || refs.molliePayment);
  return (
    <Box component="li" data-line={item.key} sx={{ listStyle: 'none', borderTop: '1px solid', borderColor: 'divider' }}>
      {onOpen ? (
        <ButtonBase onClick={onOpen} aria-label={`Ouvrir la fiche : ${item.natureLabel}, ${item.dateLabel}`} sx={{ display: 'block', width: '100%', minHeight: 44, px: 1.5, py: 1, textAlign: 'left' }}>{content}</ButtonBase>
      ) : (
        <Box sx={{ px: 1.5, py: 1, minHeight: 44 }}>{content}</Box>
      )}
      {hasRefs && (
        <Box sx={{ px: 1.5, pb: 1, display: 'flex', flexWrap: 'wrap', columnGap: 2, [WIDE]: { pl: '142px' } }}>
          <TransactionRef label="Qonto" value={refs.qonto} />
          <TransactionRef label="Lot Mollie" value={refs.mollieSettlement} />
          <TransactionRef label="Paiement Mollie" value={refs.molliePayment} />
        </Box>
      )}
    </Box>
  );
}

function ClientBlock({ client, items, filtered, recent, onOpenReservation }) {
  const single = client.stays.length === 1;
  // A sale outside a stay (`reservationId` null) has no fiche to open: its header and lines are plain text.
  const openable = single && client.stays[0].reservationId != null;
  const visible = items.length;
  const head = (
    <>
      <Box sx={{ gridArea: 'name', minWidth: 0 }}>
        <Typography component="span" sx={{ fontWeight: 700, display: 'block', overflowWrap: 'anywhere' }}>{client.name}</Typography>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
          {client.stays.map((stay) => stay.label).join(' · ')}
        </Typography>
      </Box>
      <Box sx={{ gridArea: 'figures', display: 'flex', alignItems: { xs: 'baseline', sm: 'flex-end' }, columnGap: 1.5, flexDirection: { xs: 'row', sm: 'column' }, textAlign: { xs: 'left', sm: 'right' } }}>
        {!filtered && <Typography component="span" sx={{ fontWeight: 700, display: 'block', ...TAB }}>{formatCurrency(client.totalCents / 100)}</Typography>}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {recent ? `${visible} reçu${visible > 1 ? 's' : ''}` : `${visible} à venir`}
        </Typography>
      </Box>
      {openable && (
        <Box component="span" sx={{ gridArea: 'open', justifySelf: 'end', display: 'inline-flex', alignItems: 'center', color: 'primary.main', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
          Ouvrir la fiche<ChevronRightIcon sx={{ fontSize: 18 }} />
        </Box>
      )}
    </>
  );
  // xs: the name takes the whole first row, the figures and the open affordance share the second; from sm, one row.
  const headSx = {
    display: 'grid', alignItems: 'center', columnGap: 2, rowGap: 0.5, width: '100%',
    gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(0, 1fr) auto auto' },
    gridTemplateAreas: { xs: '"name name" "figures open"', sm: '"name figures open"' }, minHeight: 44, px: 1.5, py: 1, textAlign: 'left', bgcolor: client.late ? 'error.soft' : 'grey.50' };
  return (
    <Box
      component="section"
      aria-label={client.name}
      data-client={blockKey(client)}
      data-late={client.late ? 'true' : undefined}
      sx={{ border: '1px solid', borderColor: client.late ? 'error.main' : 'divider', borderRadius: 2, overflow: 'hidden', containerType: 'inline-size', bgcolor: 'background.paper' }}
    >
      {openable ? (
        <ButtonBase onClick={() => onOpenReservation(client.stays[0].reservationId)} aria-label={`Ouvrir la fiche : ${client.name}`} sx={headSx}>{head}</ButtonBase>
      ) : (
        <Box sx={headSx}>{head}</Box>
      )}
      <Box component="ul" sx={{ m: 0, p: 0 }}>
        {items.map(({ item, stay }) => (
          <Line
            key={item.key}
            item={item}
            stayLabel={single ? '' : stay.label}
            onOpen={single || stay.reservationId == null ? null : () => onOpenReservation(stay.reservationId)}
          />
        ))}
      </Box>
    </Box>
  );
}

export default function IncomingPaymentsTable({ data, recent, onRecentChange, onOpenReservation }) {
  const [hidden, setHidden] = useState(() => new Set());
  const toggleKind = (key) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const kinds = data.kinds || [];
  // The server names an icon on each item: a kind's chip draws the one its items carry.
  const iconByKind = {};
  data.clients.forEach((client) => client.stays.forEach((stay) => stay.items.forEach((item) => { iconByKind[item.kind] = item.icon; })));
  const blocks = data.clients
    .map((client) => ({
      client,
      items: client.stays.flatMap((stay) => stay.items.map((item) => ({ item, stay }))).filter(({ item }) => !hidden.has(item.kind)),
    }))
    .filter((block) => block.items.length > 0);

  return (
    <Box data-testid="incoming-payments">
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        {kinds.length > 0 && (
          <Stack direction="row" role="group" aria-label="Natures affichées" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
            {kinds.map((kind) => {
              const on = !hidden.has(kind.key);
              return (
                <Chip
                  key={kind.key}
                  component="button"
                  type="button"
                  clickable
                  aria-pressed={on}
                  onClick={() => toggleKind(kind.key)}
                  variant={on ? 'filled' : 'outlined'}
                  color={on ? 'primary' : 'default'}
                  icon={<KindIcon name={iconByKind[kind.key]} />}
                  label={`${kind.label} · ${kind.count}`}
                  sx={{ minHeight: 36, '@media (pointer: coarse)': { minHeight: 44 }, fontWeight: 600 }}
                />
              );
            })}
          </Stack>
        )}
        <FormControlLabel
          sx={{ ml: { sm: 'auto' }, minHeight: 44 }}
          control={<Switch checked={Boolean(recent)} onChange={(e) => onRecentChange(e.target.checked)} />}
          label="Reçus ces 30 derniers jours"
        />
      </Stack>
      <Box sx={{ mb: 1.5 }}><Legend /></Box>
      {blocks.length === 0 ? (
        <EmptyState message={recent ? EMPTY_RECENT : EMPTY} py={3} />
      ) : (
        <Stack spacing={1.5}>
          {blocks.map(({ client, items }) => (
            <ClientBlock
              key={blockKey(client)}
              client={client}
              items={items}
              filtered={hidden.size > 0}
              recent={recent}
              onOpenReservation={onOpenReservation}
            />
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        « En attente de règlement » dit ce que les clients doivent ; « Versements à venir » dit ce que la banque va recevoir.
        Les échéances d’un échéancier figurent dans les deux.
      </Typography>
    </Box>
  );
}

