/**
 * CampaignsPage — « Bons cadeaux › Campagnes » (specs/gift-voucher-campaigns.md rules 2, 6, 8, 10, §4.2): the campaigns with their state, kind, validity and contents
 * as the server describes them, and why one cannot be offered. A table on `md+`, stacked cards on `xs`. « Importer une recette » sends an archive to the server, which
 * refuses it whole with the field of each problem. Admin only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert, Box, Card, CardActionArea, CardContent, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';
import {
  EmptyState, ErrorAlert, LoadingState, PageActionBar, StatusBadge, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import GiftVoucherTabs from './GiftVoucherTabs';
import { CAMPAIGN_KINDS, CAMPAIGN_STATES, CAMPAIGN_TEXTS as T } from './giftVoucherTexts';

function StateBadge({ state }) {
  const badge = CAMPAIGN_STATES[state] || CAMPAIGN_STATES.draft;
  return <StatusBadge status={badge.status} label={badge.label} />;
}

const reasonOf = (c) => (c.pricing && !c.pricing.priceable ? `${T.notPriced}${c.pricing.reason}` : null);

function CampaignCards({ items, onOpen }) {
  return (
    <Stack spacing={1}>
      {items.map((c) => (
        <Card key={c.id} variant="outlined">
          <CardActionArea onClick={() => onOpen(c.id)} sx={{ minHeight: 44 }}>
            <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{c.name}</Typography>
                <StateBadge state={c.state} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{c.summary}</Typography>
              <Typography variant="body2" color="text.secondary">{`${CAMPAIGN_KINDS[c.kind]} · ${T.months(c.validityMonths)}`}</Typography>
              {reasonOf(c) ? <Typography variant="body2" color="warning.main">{reasonOf(c)}</Typography> : null}
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  );
}

function CampaignTable({ items, onOpen }) {
  const C = T.columns;
  return (
    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{C.name}</TableCell><TableCell>{C.state}</TableCell><TableCell>{C.kind}</TableCell><TableCell>{C.validity}</TableCell><TableCell>{C.contents}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((c) => (
            <TableRow key={c.id} hover onClick={() => onOpen(c.id)} sx={{ cursor: 'pointer', '& td': { py: 1.25 } }}>
              <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
              <TableCell><StateBadge state={c.state} /></TableCell>
              <TableCell>{CAMPAIGN_KINDS[c.kind]}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{T.months(c.validityMonths)}</TableCell>
              <TableCell>
                {c.summary}
                {reasonOf(c) ? <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>{reasonOf(c)}</Typography> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

export default function CampaignsPage() {
  const navigate = useNavigate();
  const { showSuccess } = useToast();
  const fileRef = useRef(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);
  const [refusal, setRefusal] = useState(null);

  const load = useCallback(() => {
    setError(false);
    giftVouchersApi.listCampaigns().then((result) => setItems(result.items)).catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  async function importFile(file) {
    if (!file) return;
    setRefusal(null);
    try {
      const created = await giftVouchersApi.importRecipe(file);
      showSuccess(T.imported);
      navigate(`/bons-cadeaux/campagnes/${created.id}`);
    } catch (err) {
      setRefusal({ message: (err && err.message) || T.importFailed, errors: (err && Array.isArray(err.errors)) ? err.errors : [] });
    }
  }

  const open = (id) => navigate(`/bons-cadeaux/campagnes/${id}`);
  let body;
  if (error) body = <ErrorAlert message={T.loadError} onRetry={load} />;
  else if (!items) body = <LoadingState />;
  else if (!items.length) body = <EmptyState icon={<CardGiftcardOutlinedIcon />} message={T.empty} actionLabel={T.newCampaign} onAction={() => open('nouvelle')} />;
  else body = (
    <>
      <Box sx={{ display: { xs: 'block', md: 'none' } }}><CampaignCards items={items} onOpen={open} /></Box>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}><CampaignTable items={items} onOpen={open} /></Box>
    </>
  );

  return (
    <Box>
      <PageActionBar
        title={T.title} tabs={<GiftVoucherTabs value="campaigns" />}
        actionsBefore={[
          { icon: <UploadFileOutlinedIcon />, tooltip: T.importRecipe, onClick: () => fileRef.current && fileRef.current.click() },
          { icon: <AddIcon />, tooltip: T.newCampaign, onClick: () => open('nouvelle'), color: 'primary' },
        ]}
      />
      <input
        ref={fileRef} type="file" accept=".zip,application/zip" hidden data-testid="recipe-input"
        onChange={(e) => { importFile(e.target.files && e.target.files[0]); e.target.value = ''; }}
      />
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 } }}>
        {refusal ? (
          <Alert severity="error" onClose={() => setRefusal(null)}>
            {refusal.errors.length ? T.importRefused : refusal.message}
            {refusal.errors.length ? (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {refusal.errors.map((e, i) => <li key={i}>{e.message}</li>)}
              </Box>
            ) : null}
          </Alert>
        ) : null}
        {body}
      </Stack>
    </Box>
  );
}
