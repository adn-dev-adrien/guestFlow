import React, { createContext, useContext } from 'react';

/**
 * Shared context for the reservation/devis form sections.
 *
 * ReservationPage owns all state, the pricing pipeline, derived values and handlers; it assembles them
 * into a single (memoized) value and exposes it here. The form section components
 * (StaySection / GuestsBedsSection / ExtrasSection / FinanceSection) consume what they need via
 * `useReservationForm()` — no prop-drilling. This is an exposure layer, not a relocation of logic.
 */
const ReservationFormContext = createContext(null);

export function ReservationFormProvider({ value, children }) {
  return (
    <ReservationFormContext.Provider value={value}>
      {children}
    </ReservationFormContext.Provider>
  );
}

export function useReservationForm() {
  const ctx = useContext(ReservationFormContext);
  if (!ctx) {
    throw new Error('useReservationForm must be used within a ReservationFormProvider');
  }
  return ctx;
}

export default ReservationFormContext;
