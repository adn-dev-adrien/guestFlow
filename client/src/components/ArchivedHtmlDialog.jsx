/**
 * ArchivedHtmlDialog — shows an immutable HTML document produced by the server (an archived CGV
 * version, later a sent email) through SandboxedHtmlFrame, so the document can never act on the
 * application.
 *
 * Props:
 *   open:       boolean
 *   onClose:    () => void
 *   title:      string
 *   subtitle?:  ReactNode        — a line under the title (version, date…)
 *   documents:  [{ key, label, html }]  — one tab per document (e.g. Français / English);
 *                                          no tab bar when there is only one
 *   loading?:   boolean
 *   error?:     string
 *
 * fullScreen under `sm` (CLAUDE.md dialog rule).
 */
import React, { useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import PageTabs from './PageTabs';
import SandboxedHtmlFrame from './SandboxedHtmlFrame';

export default function ArchivedHtmlDialog({
  open, onClose, title, subtitle = null, documents = [], loading = false, error = '',
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [tab, setTab] = useState(0);
  const current = documents[Math.min(tab, Math.max(documents.length - 1, 0))];

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="md">
      <DialogTitle>
        {title}
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        {documents.length > 1 && (
          <Box sx={{ px: 2 }}>
            <PageTabs
              value={tab}
              onChange={setTab}
              variant="card"
              ariaLabel="Version du document"
              items={documents.map((d, i) => ({ value: i, label: d.label }))}
            />
          </Box>
        )}
        {loading && <LoadingState />}
        {error && <Box sx={{ p: 2 }}><ErrorAlert message={error} /></Box>}
        {!loading && !error && current && (
          <SandboxedHtmlFrame html={current.html} title={current.label || title} minHeight={{ xs: '70vh', sm: 480 }} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  );
}
