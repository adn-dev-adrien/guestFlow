/**
 * EmailQueue — the emails awaiting the operator's approval (specs/control-plane-plans-and-access.md
 * rule 33): one line each with « Voir », « Envoyer », « Ignorer »; the buttons go under the line on
 * xs. Specific to the renewal emails; used on the home page and on a customer's page.
 *
 * Props:
 *   items: [{ id, companyName?, name, preparedOn, recipient, subject, body }]  (required)
 *   onSend(id), onIgnore(id): Promise                                          (required)
 *   showCustomer: boolean   show the customer's name (the home page), default true
 */
import React, { useState } from 'react';
import { Box, Button, Collapse, Typography } from '@mui/material';
import MailPreview from './MailPreview';

export default function EmailQueue({ items, onSend, onIgnore, showCustomer = true }) {
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);

  const run = async (id, fn) => {
    setBusy(id);
    try {
      await fn(id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box component="ul" sx={{ m: 0, p: 0 }}>
      {items.map((e) => (
        <Box component="li" key={e.id} sx={{ listStyle: 'none', py: 1, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'divider' } }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ flex: '1 1 220px', minWidth: 0 }}>
              {showCustomer && <strong>{e.companyName} · </strong>}{e.name} · préparé le {e.preparedOn}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
              <Button size="small" variant="outlined" sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }} onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>Voir</Button>
              <Button size="small" variant="contained" sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }} disabled={busy === e.id} onClick={() => run(e.id, onSend)}>Envoyer</Button>
              <Button size="small" variant="outlined" sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }} disabled={busy === e.id} onClick={() => run(e.id, onIgnore)}>Ignorer</Button>
            </Box>
          </Box>
          <Collapse in={open === e.id} unmountOnExit>
            <Box sx={{ mt: 1 }}><MailPreview to={e.recipient} subject={e.subject} body={e.body} /></Box>
          </Collapse>
        </Box>
      ))}
    </Box>
  );
}
