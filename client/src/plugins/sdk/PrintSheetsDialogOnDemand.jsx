/**
 * PrintSheetsDialogOnDemand — the SDK's `PrintSheetsDialog`: the same component and props as
 * components/PrintSheetsDialog (open, onClose, title, initialCount, fetchLayout, onPrint), loaded on its first opening
 * so its code stays out of the initial JavaScript (scripts/check-bundle-budget.mjs). Once loaded it stays mounted, so
 * its closing transition plays.
 */
import { lazy, Suspense, useEffect, useState } from 'react';

const PrintSheetsDialog = lazy(() => import('../../components/PrintSheetsDialog'));

export default function PrintSheetsDialogOnDemand(props) {
  const { open } = props;
  const [wanted, setWanted] = useState(Boolean(open));
  useEffect(() => {
    if (open) setWanted(true);
  }, [open]);
  if (!wanted && !open) return null;
  return (
    <Suspense fallback={null}>
      <PrintSheetsDialog {...props} />
    </Suspense>
  );
}
