/**
 * PricingNotices — the warnings of the pricing summary, worded by the server
 * (`quote.notices`, server/src/utils/fichePricingNotices.js): a commission far above the platform's
 * rate, a tourist tax the fiche stores differently from what is computed now. It renders them and
 * compares nothing. Renders nothing for an empty list. Generic: a notice is `{ code, text, action? }`.
 *
 * Props:
 *   notices   Array<{ code: string, text: string, action?: string }> | undefined
 *   onAction  (action: string) => void — called by the button a notice with an `action` carries
 */
import React from 'react';
import { Alert, Button } from '@mui/material';
import { PRICING_NOTICE_ACTIONS } from '../../constants/pricingSummaryStrings';

export default function PricingNotices({ notices, onAction }) {
  if (!Array.isArray(notices) || notices.length === 0) return null;
  return notices.map((notice) => {
    const actionLabel = notice.action ? PRICING_NOTICE_ACTIONS[notice.action] : null;
    return (
      <Alert
        key={notice.code}
        severity="warning"
        icon={false}
        data-testid={`pricing-notice-${notice.code}`}
        action={actionLabel && onAction ? (
          <Button color="inherit" size="small" onClick={() => onAction(notice.action)} sx={{ minHeight: 44 }}>{actionLabel}</Button>
        ) : undefined}
        sx={{ mb: 2, borderRadius: '10px', px: 1.5, py: 1, alignItems: 'center' }}
      >
        {notice.text}
      </Alert>
    );
  });
}
