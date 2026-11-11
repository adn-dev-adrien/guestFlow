// The « Planifier » page of the arrival SAS (specs/plugins-phase-3c-hourly-resources.md rule 12): the
// picker over the step's value — the blocks placed. What they owe is the server's to say: the arrival
// preview bills it through this plugin's `sasCommit` hook (specs/sas-arrival-total-server-side.md
// rule 10).
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
      onRemove={(idx, block) => onChange((prev) => ({ ...prev, blocks: (prev?.blocks || []).filter((b) => !sameBlock(b, block)) }))}    />
  );
}
