/**
 * The plugin registry (specs/plugins-phase-4-registry.md rule 8): upload one or more `.tgz` packages,
 * see every published version, withdraw one. The server validates each package and re-signs the
 * index; a refusal is shown with the file's name. A table on desktop, cards on a phone.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import PageActionBar from '@gf/components/PageActionBar';
import ConfirmDialog from '@gf/components/ConfirmDialog';
import LoadingState from '@gf/components/LoadingState';
import ErrorAlert from '@gf/components/ErrorAlert';
import EmptyState from '@gf/components/EmptyState';
import StatusBadge from '@gf/components/StatusBadge';
import { useToast } from '@gf/components/DialogProvider';
import api from '../api';

export default function RegistryPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { showSuccess } = useToast();
  const input = useRef(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refusals, setRefusals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(null);

  const load = () => { setError(null); api.registry().then(setRows).catch((err) => setError(err.message)); };
  useEffect(load, []);

  async function upload(files) {
    setBusy(true);
    setRefusals([]);
    const refused = [];
    let published = 0;
    for (const file of files) {
      try {
        await api.uploadPackage(file); // eslint-disable-line no-await-in-loop
        published += 1;
      } catch (err) {
        refused.push(err.message);
      }
    }
    setRefusals(refused);
    setBusy(false);
    if (published) showSuccess(published > 1 ? `${published} paquets publiés.` : 'Paquet publié.');
    load();
  }

  async function withdraw() {
    const { id, version } = withdrawing;
    setWithdrawing(null);
    try {
      await api.withdrawPackage(id, version);
      showSuccess(`${id} ${version} retiré du registre.`);
      load();
    } catch (err) {
      setRefusals([err.message]);
    }
  }

  const bar = (
    <PageActionBar
      title="Registre"
      titleOnXs
      actionsBefore={[{ icon: <UploadFileIcon />, tooltip: 'Publier des paquets', onClick: () => input.current && input.current.click(), color: 'primary', disabled: busy }]}
    />
  );
  const status = (r) => <StatusBadge status={r.withdrawnAt ? 'neutral' : 'success'} label={r.statusLabel} />;
  const withdrawButton = (r) => (r.withdrawnAt ? null : (
    <Button color="error" size="small" onClick={() => setWithdrawing(r)} sx={{ minHeight: 44 }}>Retirer</Button>
  ));

  let body;
  if (error) body = <ErrorAlert message={error} onRetry={load} />;
  else if (!rows) body = <LoadingState />;
  else if (!rows.length) body = <EmptyState icon={<UploadFileIcon />} message="Aucun paquet publié." />;
  else if (isMobile) {
    body = (
      <Stack spacing={1.5}>
        {rows.map((r) => (
          <Card key={`${r.id}@${r.version}`} variant="outlined">
            <CardContent>
              <Typography sx={{ fontWeight: 700 }}>{r.name} {r.version}</Typography>
              <Typography variant="body2" color="text.secondary">{r.id} · {r.sizeLabel} · {r.publishedLabel}</Typography>
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>{status(r)}{withdrawButton(r)}</Box>
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  } else {
    body = (
      <Card variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Plugin</TableCell><TableCell>Version</TableCell><TableCell>Taille</TableCell>
              <TableCell>SHA-256</TableCell><TableCell>Publié le</TableCell><TableCell>État</TableCell><TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.id}@${r.version}`}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.version}</TableCell>
                <TableCell>{r.sizeLabel}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.sha256.slice(0, 12)}</TableCell>
                <TableCell>{r.publishedLabel}</TableCell>
                <TableCell>{status(r)}</TableCell>
                <TableCell align="right">{withdrawButton(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  }

  return (
    <>
      {bar}
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
        <input
          ref={input}
          type="file"
          accept=".tgz,application/gzip"
          multiple
          hidden
          data-testid="registry-upload"
          onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) upload(files); }}
        />
        {refusals.map((message) => <Alert key={message} severity="error" sx={{ mb: 1.5 }}>{message}</Alert>)}
        {body}
      </Box>
      <ConfirmDialog
        open={Boolean(withdrawing)}
        onClose={() => setWithdrawing(null)}
        onConfirm={withdraw}
        title="Retirer du registre"
        message={withdrawing ? `${withdrawing.name} ${withdrawing.version} ne sera plus proposé. Les instances qui l’utilisent le gardent.` : ''}
        confirmLabel="Retirer"
      />
    </>
  );
}
