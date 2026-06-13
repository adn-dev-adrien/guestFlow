/**
 * ReservationSasDialog — guided check-in / check-out wizard (specs/arrival-departure-sas.md).
 *
 * Launched from the Planning (arrival card → mode 'arrival', departure row → mode 'departure').
 * A forward-only sequence of single-purpose pages; every page has « Quitter » (closes, writes
 * NOTHING). All decisions are accumulated in memory and committed in ONE call at the final recap.
 *
 * Props: { open, reservationId, mode: 'arrival'|'departure', onClose, onCommitted }
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Stack,
  CircularProgress, Checkbox, TextField, Link, Divider, Chip, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import EmojiFoodBeverageIcon from '@mui/icons-material/EmojiFoodBeverage';
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import ConfirmDialog from '../ConfirmDialog';

function euro(n) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')} €`;
}
function frDate(iso) {
  if (!iso) return '';
  try { return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }); }
  catch { return iso; }
}

// Integer stepper for a labelled breakfast drink (icon + label, no price). Module-level so it
// keeps a stable identity across parent re-renders (an inline component would remount on every
// keystroke/click and detach its DOM nodes mid-interaction).
function CountStepper({ icon, label, value, onChange }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        {icon}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Button size="small" variant="outlined" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} sx={{ minWidth: 36 }}>−</Button>
        <TextField value={value} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} size="small" sx={{ width: 56 }} slotProps={{ htmlInput: { style: { textAlign: 'center' } } }} />
        <Button size="small" variant="outlined" onClick={() => onChange(value + 1)} sx={{ minWidth: 36 }}>+</Button>
      </Stack>
    </Stack>
  );
}

export default function ReservationSasDialog({ open, reservationId, mode = 'arrival', onClose, onCommitted }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [stepKey, setStepKey] = useState(null);

  // Decisions (in memory until commit)
  const [caution, setCaution] = useState(null);           // arrival: 'fait' | 'reporte'
  const [linenOk, setLinenOk] = useState(null);           // arrival linen verify: true | false
  const [missingBed, setMissingBed] = useState({});       // arrival: { itemId: qty }
  const [cleaningAdded, setCleaningAdded] = useState(false);
  const [cleaningOk, setCleaningOk] = useState(null);     // departure: true | false
  const [missingAsk, setMissingAsk] = useState(null);     // departure: true | false
  const [missingDep, setMissingDep] = useState({});       // departure: { itemId: qty }
  const [keysReceived, setKeysReceived] = useState(null); // departure
  const [cautionReturned, setCautionReturned] = useState(null); // departure
  // arrival breakfast page (specs/sas-breakfast-and-handover-note.md)
  const [breakfast, setBreakfast] = useState({ coffee: 0, tea: 0, chocolate: 0 });
  const [breakfastTime, setBreakfastTime] = useState('');
  const [breakfastNote, setBreakfastNote] = useState('');
  const [handoverNote, setHandoverNote] = useState(''); // arrival recap → shown at departure
  const [breakfastWarnOpen, setBreakfastWarnOpen] = useState(false);

  useEffect(() => {
    if (!open || !reservationId) return undefined;
    let cancelled = false;
    setLoading(true); setError(''); setData(null); setStepKey(null);
    setCaution(null); setLinenOk(null); setMissingBed({}); setCleaningAdded(false);
    setCleaningOk(null); setMissingAsk(null); setMissingDep({}); setKeysReceived(null); setCautionReturned(null);
    setBreakfast({ coffee: 0, tea: 0, chocolate: 0 }); setBreakfastTime(''); setBreakfastNote(''); setHandoverNote(''); setBreakfastWarnOpen(false);
    api.getReservationSas(reservationId)
      .then((d) => {
        if (cancelled) return;
        setData(d); setStepKey('intro');
        const b = d?.breakfast;
        if (b?.applicable) {
          setBreakfast({ coffee: Number(b.coffee) || 0, tea: Number(b.tea) || 0, chocolate: Number(b.chocolate) || 0 });
          setBreakfastTime(b.time || '');
          setBreakfastNote(b.note || '');
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Erreur de chargement.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, reservationId]);

  const r = data?.reservation;
  const bedItems = useMemo(() => (data?.linenItems || []).filter((i) => i.category === 'bed'), [data]);
  const allItems = useMemo(() => (data?.linenItems || []), [data]);

  // Ordered list of active page keys, given the data + current decisions.
  const activeKeys = useMemo(() => {
    if (!data) return [];
    if (mode === 'arrival') {
      const cautionDue = Number(r.cautionAmount || 0) > 0 && !r.cautionReceived;
      const hasOptions = (r.options || []).length > 0 || (r.resources || []).length > 0;
      return [
        'intro',
        data.portalCode ? 'portal' : null,
        cautionDue ? 'caution' : null,
        hasOptions ? 'options' : null,
        data.breakfast?.applicable ? 'breakfast' : null,
        r.bedLinenAlert ? 'linen' : null,
        (r.bedLinenAlert && linenOk === false) ? 'linenItems' : null,
        'cleaning',
        (cautionDue && caution === 'reporte') ? 'cautionReport' : null,
        'recap',
      ].filter(Boolean);
    }
    const cautionReturnable = Number(r.cautionAmount || 0) > 0 && r.cautionReceived && !r.cautionReturned;
    return [
      'intro',
      'cleaning',
      'missingAsk',
      missingAsk === true ? 'missingItems' : null,
      'keys',
      cautionReturnable ? 'cautionReturn' : null,
      'recap',
    ].filter(Boolean);
  }, [data, mode, r, linenOk, caution, missingAsk]);

  const goNext = useCallback(() => {
    const i = activeKeys.indexOf(stepKey);
    if (i >= 0 && i < activeKeys.length - 1) setStepKey(activeKeys[i + 1]);
  }, [activeKeys, stepKey]);

  // ---- totals ----
  const bedLines = useMemo(() => bedItems
    .filter((it) => Number(missingBed[it.id]) > 0)
    .map((it) => ({ label: it.label, amount: Math.round(Number(it.price) * Number(missingBed[it.id]) * 100) / 100, qty: Number(missingBed[it.id]) })), [bedItems, missingBed]);
  const cleaningLine = (mode === 'arrival' && cleaningAdded && data?.cleaning?.price)
    ? { label: 'Ménage', amount: Math.round(Number(data.cleaning.price) * 100) / 100, qty: 1 } : null;
  const arrivalAddedLines = [...bedLines, ...(cleaningLine ? [cleaningLine] : [])];
  const arrivalAdded = arrivalAddedLines.reduce((s, l) => s + l.amount, 0);

  const depMissingLines = useMemo(() => allItems
    .filter((it) => Number(missingDep[it.id]) > 0)
    .map((it) => ({ label: it.label, amount: Math.round(Number(it.price) * Number(missingDep[it.id]) * 100) / 100, qty: Number(missingDep[it.id]) })), [allItems, missingDep]);
  const depCleaningLine = (cleaningOk === false && data?.cleaning?.price)
    ? { label: 'Ménage de fin de séjour', amount: Math.round(Number(data.cleaning.price) * 100) / 100, qty: 1 } : null;
  const endOfStayLines = [...(depCleaningLine ? [depCleaningLine] : []), ...depMissingLines];
  const endOfStayTotal = endOfStayLines.reduce((s, l) => s + l.amount, 0);

  const commit = async () => {
    setCommitting(true); setError('');
    try {
      if (mode === 'arrival') {
        const payload = {
          cautionReceived: caution === 'fait',
          complementItems: arrivalAddedLines.map((l) => ({ label: l.label, amount: l.amount })),
          departureHandoverNote: handoverNote,
        };
        if (data.breakfast?.applicable) {
          payload.breakfastTime = breakfastTime;
          payload.breakfastCoffee = breakfast.coffee;
          payload.breakfastTea = breakfast.tea;
          payload.breakfastChocolate = breakfast.chocolate;
          payload.breakfastNote = breakfastNote;
        }
        await api.commitArrivalSas(reservationId, payload);
      } else {
        await api.commitDepartureSas(reservationId, {
          cautionReturned: cautionReturned === true,
          endOfStayComplementAmount: endOfStayTotal,
          endOfStayComplementDetail: endOfStayLines,
        });
      }
      if (onCommitted) onCommitted();
      if (onClose) onClose();
    } catch (e) {
      setError(e?.message || "Échec de l'enregistrement.");
    } finally {
      setCommitting(false);
    }
  };

  // ---- quantity stepper for a linen item row ----
  const QtyRow = ({ item, qtyMap, setQtyMap }) => {
    const qty = Number(qtyMap[item.id] || 0);
    const set = (v) => setQtyMap({ ...qtyMap, [item.id]: Math.max(0, v) });
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.label}</Typography>
          <Typography variant="caption" color="text.secondary">{euro(item.price)} / unité</Typography>
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Button size="small" variant="outlined" onClick={() => set(qty - 1)} disabled={qty <= 0} sx={{ minWidth: 36 }}>−</Button>
          <TextField value={qty} onChange={(e) => set(Math.floor(Number(e.target.value) || 0))} size="small" sx={{ width: 56 }} slotProps={{ htmlInput: { style: { textAlign: 'center' } } }} />
          <Button size="small" variant="outlined" onClick={() => set(qty + 1)} sx={{ minWidth: 36 }}>+</Button>
        </Stack>
      </Stack>
    );
  };

  // Breakfast coherence: total drinks vs the server-resolved morning person count (soft warning, rule 4b).
  const breakfastTotal = Number(breakfast.coffee) + Number(breakfast.tea) + Number(breakfast.chocolate);
  const breakfastPersons = Number(data?.breakfast?.persons || 0);
  const breakfastMismatch = breakfastTotal !== breakfastPersons;

  // ---- page renderers ----
  function renderBody() {
    if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>;
    if (error && !data) return <Typography color="error">{error}</Typography>;
    if (!data) return null;

    switch (stepKey) {
      case 'intro':
        return (
          <Stack spacing={1}>
            <Typography variant="h6">{r.firstName} {r.lastName}</Typography>
            <Typography variant="body2"><strong>{r.propertyName}</strong>{r.platform && r.platform !== 'direct' ? ` · ${r.platform}` : ''}</Typography>
            <Typography variant="body2">Arrivée : {frDate(r.startDate)} à {r.checkInTime || '15:00'}</Typography>
            <Typography variant="body2">Départ : {frDate(r.endDate)} avant {r.checkOutTime || '10:00'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {(Number(r.adults || 0) + Number(r.teens || 0) + Number(r.children || 0) + Number(r.babies || 0))} personne(s)
            </Typography>
            {mode === 'departure' && r.departureHandoverNote && (
              <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'rgba(255, 193, 7, 0.12)', border: '1px solid', borderColor: 'warning.light' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.dark', display: 'block' }}>Note laissée à l'arrivée</Typography>
                <Typography variant="body2">{r.departureHandoverNote}</Typography>
              </Box>
            )}
          </Stack>
        );
      case 'portal':
        return (
          <Stack spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
            <Typography variant="body1">Code du portail à communiquer au client :</Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: 2 }}>{data.portalCode}</Typography>
          </Stack>
        );
      case 'caution':
      case 'cautionReport':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Caution à percevoir : <strong>{euro(r.cautionAmount)}</strong></Typography>
            <Typography variant="body2" color="text.secondary">Encaisser la caution (chèque / empreinte) avant de continuer.</Typography>
            {caution === 'fait' && <Chip label="Marquée comme perçue" color="success" sx={{ alignSelf: 'flex-start' }} />}
            {caution === 'reporte' && stepKey === 'caution' && <Chip label="Reportée — réaffichée à la fin" color="warning" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'options': {
        const opts = (r.options || []);
        const reslist = (r.resources || []);
        return (
          <Stack spacing={1}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Prestations réservées</Typography>
            {opts.length === 0 && reslist.length === 0 && <Typography variant="body2" color="text.secondary">Aucune.</Typography>}
            {opts.map((o, i) => <Typography key={`o${i}`} variant="body2">• {o.title}{o.quantity > 1 ? ` × ${o.quantity}` : ''}</Typography>)}
            {reslist.map((o, i) => <Typography key={`r${i}`} variant="body2">• {o.name}{o.quantity > 1 ? ` × ${o.quantity}` : ''}</Typography>)}
          </Stack>
        );
      }
      case 'breakfast':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Petit déjeuner</Typography>
            <TextField
              label="Heure du petit déjeuner"
              type="time"
              value={breakfastTime}
              onChange={(e) => setBreakfastTime(e.target.value)}
              size="small"
              sx={{ maxWidth: 200 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Divider />
            <Stack spacing={0.5} divider={<Divider />}>
              <CountStepper icon={<LocalCafeIcon color="action" />} label="Café" value={Number(breakfast.coffee)} onChange={(v) => setBreakfast((b) => ({ ...b, coffee: v }))} />
              <CountStepper icon={<EmojiFoodBeverageIcon color="action" />} label="Thé" value={Number(breakfast.tea)} onChange={(v) => setBreakfast((b) => ({ ...b, tea: v }))} />
              <CountStepper icon={<FreeBreakfastIcon sx={{ color: '#795548' }} />} label="Chocolat chaud" value={Number(breakfast.chocolate)} onChange={(v) => setBreakfast((b) => ({ ...b, chocolate: v }))} />
            </Stack>
            <Typography variant="caption" sx={{ color: breakfastMismatch ? 'warning.main' : 'text.secondary', fontWeight: breakfastMismatch ? 700 : 400 }}>
              {breakfastTotal} boisson{breakfastTotal > 1 ? 's' : ''} pour {breakfastPersons} personne{breakfastPersons > 1 ? 's' : ''}
            </Typography>
            <TextField
              label="Note petit déjeuner (optionnel)"
              value={breakfastNote}
              onChange={(e) => setBreakfastNote(e.target.value)}
              size="small"
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        );
      case 'linen':
        return (
          <Stack spacing={1.5}>
            {r.bedLinenAlert?.type === 'capacity' ? (
              <Typography variant="body1">Le linge de lit prévu ne couvre pas le nombre de personnes ({r.bedLinenAlert.capacity} couchage(s) pour {r.bedLinenAlert.required} pers.). <strong>Vérifier les draps avec le client.</strong></Typography>
            ) : (
              <Typography variant="body1">Le client n'a pas pris le linge de lit. <strong>Vérifier avec lui.</strong></Typography>
            )}
            <Typography variant="body2" color="text.secondary">« Pas OK » → sélectionner les éléments manquants à facturer.</Typography>
          </Stack>
        );
      case 'linenItems':
        return (
          <Stack spacing={0.5} divider={<Divider />}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Éléments de linge manquants</Typography>
            {bedItems.length === 0 && <Typography variant="body2" color="text.secondary">Aucun tarif configuré (Réglages → Blanchisserie).</Typography>}
            {bedItems.map((it) => <QtyRow key={it.id} item={it} qtyMap={missingBed} setQtyMap={setMissingBed} />)}
          </Stack>
        );
      case 'cleaning':
        if (mode === 'departure') {
          return (
            <Stack spacing={1}>
              <Typography variant="body1">Le ménage de fin de séjour a-t-il été fait correctement ?</Typography>
              {cleaningOk === false && data.cleaning.price != null && (
                <Typography variant="body2" color="warning.main">Ménage à facturer : {euro(data.cleaning.price)}.</Typography>
              )}
            </Stack>
          );
        }
        if (data.cleaning.included) {
          return (
            <Stack spacing={1}>
              <Typography variant="body1">✅ Le ménage est inclus.</Typography>
              <Typography variant="body2" color="text.secondary">Rappeler au client : la vaisselle doit être faite et rangée, et les poubelles vidées.</Typography>
            </Stack>
          );
        }
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Le ménage n'a pas été pris.</Typography>
            {data.cleaning.price != null
              ? <Typography variant="body2">Tarif ménage pour ce logement : <strong>{euro(data.cleaning.price)}</strong>. Proposer au client ?</Typography>
              : <Typography variant="body2" color="text.secondary">Aucun tarif de ménage configuré pour ce logement.</Typography>}
            {cleaningAdded && <Chip label={`Ménage ajouté (${euro(data.cleaning.price)})`} color="info" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'missingAsk':
        return <Typography variant="body1">Des serviettes ou des draps sont-ils manquants ?</Typography>;
      case 'missingItems':
        return (
          <Stack spacing={0.5} divider={<Divider />}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Éléments manquants</Typography>
            {allItems.length === 0 && <Typography variant="body2" color="text.secondary">Aucun tarif configuré (Réglages → Blanchisserie).</Typography>}
            {allItems.map((it) => <QtyRow key={it.id} item={it} qtyMap={missingDep} setQtyMap={setMissingDep} />)}
          </Stack>
        );
      case 'keys':
        return (
          <Stack spacing={1}>
            <Typography variant="body1">Avez-vous récupéré les clés du logement ?</Typography>
            {keysReceived === false && <Chip label="Clés non récupérées" color="warning" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'cautionReturn':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body1">Rendre la caution de <strong>{euro(r.cautionAmount)}</strong>.</Typography>
            {cautionReturned === true && <Chip label="Caution rendue" color="success" sx={{ alignSelf: 'flex-start' }} />}
            {cautionReturned === false && <Chip label="Litige / dégât — caution conservée" color="error" sx={{ alignSelf: 'flex-start' }} />}
          </Stack>
        );
      case 'recap':
        if (mode === 'arrival') {
          const existing = Number(r.complementAmount || 0);
          const total = Math.round((existing + arrivalAdded) * 100) / 100;
          return (
            <Stack spacing={1}>
              <Typography variant="h6">Récapitulatif — complément à percevoir</Typography>
              {existing > 0 && <Typography variant="body2">Déjà dû : <strong>{euro(existing)}</strong></Typography>}
              {arrivalAddedLines.map((l, i) => <Typography key={i} variant="body2">+ {l.label}{l.qty > 1 ? ` × ${l.qty}` : ''} : {euro(l.amount)}</Typography>)}
              <Divider />
              <Typography variant="h6">Total : {euro(total)}</Typography>
              {caution === 'fait' && <Typography variant="body2" color="success.main">Caution marquée comme perçue.</Typography>}
              {Number(r.complementPaid || 0) === 1 && arrivalAdded > 0 && (
                <Typography variant="body2" color="warning.main">⚠ Le complément était déjà marqué payé : encaisser le supplément ({euro(arrivalAdded)}) manuellement.</Typography>
              )}
              <Divider />
              <TextField
                label="Note pour le départ (optionnel)"
                value={handoverNote}
                onChange={(e) => setHandoverNote(e.target.value)}
                size="small"
                multiline
                minRows={2}
                fullWidth
                helperText="Affichée au check-out (SAS départ + carte planning)."
              />
            </Stack>
          );
        }
        return (
          <Stack spacing={1}>
            <Typography variant="h6">Récapitulatif fin de séjour</Typography>
            {endOfStayLines.length === 0 && <Typography variant="body2" color="text.secondary">Aucun complément de fin de séjour.</Typography>}
            {endOfStayLines.map((l, i) => <Typography key={i} variant="body2">{l.label}{l.qty > 1 ? ` × ${l.qty}` : ''} : {euro(l.amount)}</Typography>)}
            {endOfStayTotal > 0 && (<><Divider /><Typography variant="h6">Total à percevoir : {euro(endOfStayTotal)}</Typography></>)}
            {cautionReturned === true && <Typography variant="body2" color="success.main">Caution rendue.</Typography>}
            {keysReceived === false && <Typography variant="body2" color="warning.main">⚠ Clés non récupérées.</Typography>}
          </Stack>
        );
      default:
        return null;
    }
  }

  // ---- footer (page-specific forward actions) ----
  function renderActions() {
    if (loading || !data) return <Button onClick={onClose}>Quitter</Button>;
    const quit = <Button color="inherit" onClick={onClose} disabled={committing}>Quitter</Button>;
    const next = (label = 'Suivant') => <Button variant="contained" onClick={goNext}>{label}</Button>;

    switch (stepKey) {
      case 'intro': return <>{quit}{next('Commencer')}</>;
      case 'portal': return <>{quit}{next()}</>;
      case 'caution':
      case 'cautionReport':
        return <>{quit}
          <Button color="warning" onClick={() => { setCaution('reporte'); goNext(); }}>Reporté</Button>
          <Button variant="contained" color="success" onClick={() => { setCaution('fait'); goNext(); }}>Fait</Button>
        </>;
      case 'options': return <>{quit}{next()}</>;
      case 'breakfast':
        return <>{quit}
          <Button variant="contained" onClick={() => { if (breakfastMismatch) setBreakfastWarnOpen(true); else goNext(); }}>Suivant</Button>
        </>;
      case 'linen':
        return <>{quit}
          {/* « Pas OK » opens the conditional linen-items page — navigate to it explicitly: the
              activeKeys goNext() reads is computed before this setState lands, so it wouldn't yet
              contain 'linenItems'. */}
          <Button color="error" onClick={() => { setLinenOk(false); setStepKey('linenItems'); }}>Pas OK</Button>
          <Button variant="contained" onClick={() => { setLinenOk(true); goNext(); }}>OK</Button>
        </>;
      case 'linenItems': return <>{quit}{next()}</>;
      case 'cleaning':
        if (mode === 'departure') {
          return <>{quit}
            <Button color="error" onClick={() => { setCleaningOk(false); goNext(); }}>Pas OK</Button>
            <Button variant="contained" color="success" onClick={() => { setCleaningOk(true); goNext(); }}>OK</Button>
          </>;
        }
        if (data.cleaning.included) return <>{quit}{next()}</>;
        return <>{quit}
          <Button onClick={() => { setCleaningAdded(false); goNext(); }}>Non merci</Button>
          <Button variant="contained" disabled={data.cleaning.price == null} onClick={() => { setCleaningAdded(true); goNext(); }}>Ajouter le ménage</Button>
        </>;
      case 'missingAsk':
        return <>{quit}
          <Button onClick={() => { setMissingAsk(false); goNext(); }}>Non</Button>
          {/* « Oui » opens the conditional missing-items page — navigate explicitly (see linen above). */}
          <Button variant="contained" onClick={() => { setMissingAsk(true); setStepKey('missingItems'); }}>Oui</Button>
        </>;
      case 'missingItems': return <>{quit}{next()}</>;
      case 'keys':
        return <>{quit}
          <Button color="warning" onClick={() => { setKeysReceived(false); goNext(); }}>Non</Button>
          <Button variant="contained" color="success" onClick={() => { setKeysReceived(true); goNext(); }}>Oui</Button>
        </>;
      case 'cautionReturn':
        return <>{quit}
          <Button color="error" onClick={() => { setCautionReturned(false); goNext(); }}>Dégât / litige</Button>
          <Button variant="contained" color="success" onClick={() => { setCautionReturned(true); goNext(); }}>Rendue</Button>
        </>;
      case 'recap':
        return <>{quit}
          <Button variant="contained" onClick={commit} disabled={committing} startIcon={committing ? <CircularProgress size={16} color="inherit" /> : null}>Valider et terminer</Button>
        </>;
      default: return quit;
    }
  }

  const title = mode === 'arrival' ? 'Arrivée' : 'Départ';
  return (
    <>
    <Dialog open={open} onClose={committing ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <span>{title}{r ? ` — ${r.firstName} ${r.lastName}` : ''}</span>
        {r && (
          <Link component="button" type="button" variant="caption" underline="hover"
            onClick={() => navigate(`/reservations/${reservationId}`)}>Ouvrir la fiche</Link>
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 180 }}>
        {renderBody()}
        {error && data && <Typography color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions>{renderActions()}</DialogActions>
    </Dialog>
    <ConfirmDialog
      open={breakfastWarnOpen}
      onClose={() => setBreakfastWarnOpen(false)}
      onConfirm={() => { setBreakfastWarnOpen(false); goNext(); }}
      title="Boissons ≠ personnes"
      message={`Le nombre de boissons (${breakfastTotal}) ne correspond pas au nombre de personnes (${breakfastPersons}). Continuer quand même ?`}
      confirmLabel="Continuer"
      cancelLabel="Modifier"
      confirmColor="warning"
    />
    </>
  );
}
