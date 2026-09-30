/**
 * LifecycleChip — a subscription state as GuestFlow's StatusBadge
 * (specs/control-plane-plans-and-access.md rule 14). Generic across the console: fleet rows, the
 * customer page, the alerts.
 *
 * Props:
 *   state: 'trial' | 'active' | 'due' | 'grace' | 'read_only' | 'suspended' | 'archived'  (required)
 *   label: string — the French label the server sends                                      (required)
 */
import React from 'react';
import StatusBadge from '@gf/components/StatusBadge';

const STATUS = { trial: 'info', active: 'success', due: 'info', grace: 'warning', read_only: 'error', suspended: 'error', archived: 'neutral' };

export default function LifecycleChip({ state, label }) {
  return <StatusBadge status={STATUS[state] || 'neutral'} label={label} />;
}
