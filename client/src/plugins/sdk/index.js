// What a plugin's client files may import from the core (specs/plugins-phase-1-sdk.md rule 16).
// A plugin file imports its own folder, this module or an npm package — nothing else (rule 3).

export { default as api } from '../../api';
export { useAuth } from '../../hooks/useAuth';
export { usePlugin } from '../../hooks/usePlugins';
export { useAppDialogs, useToast } from '../../components/DialogProvider';
export { default as PageActionBar } from '../../components/PageActionBar';
export { default as FormDialog } from '../../components/FormDialog';
export { default as ConfirmDialog } from '../../components/ConfirmDialog';
export { default as LoadingState } from '../../components/LoadingState';
export { default as ErrorAlert } from '../../components/ErrorAlert';
export { default as EmptyState } from '../../components/EmptyState';
export { default as StatusBadge } from '../../components/StatusBadge';
export { default as SummaryItem } from '../../components/SummaryItem';
export { default as MaskedTextField } from '../../components/MaskedTextField';
export { default as SecretRevealField } from '../../components/SecretRevealField';
export { default as SasKeypadCode } from '../../components/sas/SasKeypadCode';
export { displayDate } from '../../utils/formatters';
// sas — what the guided arrival/departure dialog and its « Facturables » tab render with
// (specs/plugins-phase-2-hosts.md rule 8). The steps of other plugins reach it through the slots.
export { default as Slot } from './Slot';
export { useSlot } from './useSlot';
export { default as OccurrenceGrid } from '../../components/OccurrenceGrid';
export { default as SlotPickerGrid } from '../../components/SlotPickerGrid';
export { default as WheatIcon } from '../../components/WheatIcon';
export { default as BaguetteIcon } from '../../components/BaguetteIcon';
export { default as useDirtyFormGuard } from '../../hooks/useDirtyFormGuard';
export { formatCurrency, displayDateLong } from '../../utils/formatters';
export { getPlatformColor, formatPlatformLabel } from '../../constants/platforms';
export { PRICE_TYPE_LABELS } from '../../components/reservation/extrasLabels';
export { sasLockTitle, sasLockMessage } from '../../constants/receptionSasLock';
// The hourly-resource step keeps its phase 0 switch until phase 3 (rule 11).
export { HOURLY_RESOURCES } from '../../constants/plugins';
// accounting-export
export { default as MonthYearPicker } from '../../components/MonthYearPicker';
export { default as PlatformChip } from '../../components/PlatformChip';
export { ADMIN, userHasRole } from '../../constants/roles';
