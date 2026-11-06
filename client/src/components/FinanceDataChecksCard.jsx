/**
 * FinanceDataChecksCard — « À vérifier » at the bottom of the Suivi financier (specs/finance-data-checks.md
 * rules 12-17): reads `/finance/data-checks` for the page's exercise and logement and hands the checks to
 * the generic DataChecksPanel. A stay links to its fiche (back to this page), a month to the tourist-tax
 * page on that month. A refusal stays inside the card, with a retry: the page around it is untouched.
 * Feature-local (it knows the finance endpoint and the two link targets).
 *
 * Props:
 *   fiscalYear: number|string   the exercise the page shows (its end year)
 *   propertyId: string          the page's logement filter ('' = all)
 *   refreshKey: number          bumped by the page's refresh action
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import DataChecksPanel from './DataChecksPanel';
import Panel from './Panel';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import api from '../api';
import useLatestRequest from '../hooks/useLatestRequest';
import { withFrom } from '../utils/navigation';

const LABEL = 'À vérifier';
const EMPTY = 'Rien à vérifier sur l’exercice.';
const FAILED = 'Impossible de charger les contrôles.';

export default function FinanceDataChecksCard({ fiscalYear, propertyId, refreshKey }) {
  const location = useLocation();
  const from = `${location.pathname}${location.search}`;
  const [state, setState] = useState({ data: null, error: null });
  const begin = useLatestRequest();

  const load = useCallback(async () => {
    const current = begin();
    setState((s) => ({ data: s.data, error: null }));
    try {
      const data = await api.getFinanceDataChecks({ fiscalYear, propertyId });
      if (current()) setState({ data, error: null });
    } catch (err) {
      if (current()) setState({ data: null, error: (err && err.error) || FAILED });
    }
  }, [fiscalYear, propertyId, begin]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const itemHref = (item) => {
    if (item.reservationId != null) return withFrom(`/reservations/${item.reservationId}`, from);
    // specs/tourist-tax-report-v2.md rule 31 (review R4-6) — the logement the item was counted on goes with it.
    if (item.month) {
      const logement = propertyId ? `&propertyId=${encodeURIComponent(propertyId)}` : '';
      return withFrom(`/finance/tourist-tax?month=${encodeURIComponent(item.month)}${logement}`, from);
    }
    return null;
  };

  if (state.error) {
    return <Panel label={LABEL}><ErrorAlert message={state.error} onRetry={load} /></Panel>;
  }
  if (!state.data) {
    return <Panel label={LABEL}><LoadingState label="Chargement des contrôles…" py={2} /></Panel>;
  }
  return (
    <DataChecksPanel
      checks={state.data.checks}
      itemHref={itemHref}
      label={LABEL}
      caption={`Exercice ${state.data.exercise.label}`}
      emptyText={EMPTY}
    />
  );
}
