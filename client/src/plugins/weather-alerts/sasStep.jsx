// The arrival SAS « Alerte météo » step (specs/checkin-weather-alerts.md): fetched in the background
// when the arrival SAS opens, shown just before the recap when an orange/red alert overlaps the stay.
import React from 'react';
import { api } from '../sdk';
import SasWeatherAlertPage from './SasWeatherAlertPage';

export async function load({ reservationId }) {
  try {
    const res = await api.getReservationWeatherAlerts(reservationId);
    return Array.isArray(res?.alerts) ? res.alerts : [];
  } catch {
    return [];
  }
}

export default function SasWeatherStep({ data }) {
  return <SasWeatherAlertPage alerts={data || []} />;
}
