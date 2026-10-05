// The « Planifier » page of the arrival SAS (specs/plugins-phase-3c-hourly-resources.md rule 12): the
// picker over the step's value — the blocks placed and the supplement the server prices for them.
import React from 'react';
import SasResourceSchedulingPage from './SasResourceSchedulingPage';

const sameBlock = (a, b) => Number(a.resourceId) === Number(b.resourceId) && a.date === b.date && a.start === b.start;

export default function SasSchedulingStep({ reservationId, data, value, onChange }) {
  return (
    <SasResourceSchedulingPage
      reservationId={reservationId}
      scheduling={data}
      blocks={value?.blocks || []}
      onAdd={(block) => onChange((prev) => ({ ...prev, blocks: [...(prev?.blocks || []), block] }))}
      onRemove={(idx, block) => onChange((prev) => ({ ...prev, blocks: (prev?.blocks || []).filter((b) => !sameBlock(b, block)) }))}
      onSupplement={(resourceId, amount) => onChange((prev) => ({ ...prev, supplements: { ...(prev?.supplements || {}), [resourceId]: amount } }))}
    />
  );
}
