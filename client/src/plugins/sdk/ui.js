// The generic components and services a settings page renders with — the subset of the SDK that pulls
// no plugin registry (specs/plugins-phase-3a-online-payment.md rule 17). The control plane renders the
// Paiements page of the online-payment module from here, without loading the instance's plugin graph.

export { default as api } from '../../api';
export { useToast } from '../../components/DialogProvider';
export { default as PageActionBar } from '../../components/PageActionBar';
export { default as ConfirmDialog } from '../../components/ConfirmDialog';
export { default as ErrorAlert } from '../../components/ErrorAlert';
export { default as StatusBadge } from '../../components/StatusBadge';
export { default as SummaryItem } from '../../components/SummaryItem';
export { default as MaskedTextField } from '../../components/MaskedTextField';
export { default as HelpedTextField } from '../../components/HelpedTextField';
export { default as useDirtyFormGuard } from '../../hooks/useDirtyFormGuard';
