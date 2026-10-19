// The core subjects of the home's attention (specs/shell-and-home-day-first.md rule 6), by the key
// the server gives them. Plugin subjects come from their `dashboard.alerts(.urgent)` contributions.
import PaymentDeadlinesAlert from './PaymentDeadlinesAlert';
import IcalDateDriftAlert from './IcalDateDriftAlert';
import IcalCancellationAlert from './IcalCancellationAlert';
import CancellationCompensationsPendingAlert from './CancellationCompensationsPendingAlert';
import RepairedReservationNumbersAlert from './RepairedReservationNumbersAlert';
import EmailReadinessAlert from './EmailReadinessAlert';
import NewReservationsAlert from './NewReservationsAlert';
import EmailPendingAlert from './EmailPendingAlert';
import UpdateAvailableAlert from './UpdateAvailableAlert';
import TwoFactorNudgeCard from './TwoFactorNudgeCard';

export const CORE_ATTENTION_SUBJECTS = Object.freeze({
  'payment-deadlines': PaymentDeadlinesAlert,
  'ical-date-drift': IcalDateDriftAlert,
  'ical-cancellation': IcalCancellationAlert,
  'cancellation-compensations': CancellationCompensationsPendingAlert,
  'repaired-reservation-numbers': RepairedReservationNumbersAlert,
  'email-readiness': EmailReadinessAlert,
  'new-reservations': NewReservationsAlert,
  'email-pending': EmailPendingAlert,
  'update-available': UpdateAvailableAlert,
  'two-factor': TwoFactorNudgeCard,
});
