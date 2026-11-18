/**
 * VisualsPage — « Bons cadeaux › Visuels » (specs/gift-voucher-campaigns.md rules 47-48): the library of card fronts, each with its thumbnail, name, use, the campaigns that
 * use it and the valid vouchers that carry it, all read from the server. Add, rename, replace the image (a new version: the vouchers already issued keep theirs) and
 * delete, the server refusing a delete while an on-sale campaign uses the visual. A grid that goes to one column on `xs`. Admin only.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Card, CardContent, IconButton, Stack, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import {
  ConfirmDialog, EmptyState, ErrorAlert, LoadingState, PageActionBar, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import GiftVoucherTabs from './GiftVoucherTabs';
import VisualFormDialog from './VisualFormDialog';
import { VISUAL_TEXTS as T } from './giftVoucherTexts';

function VisualCard({ visual, onEdit, onDelete }) {
  const use = (T.uses.find((u) => u.value === visual.use) || {}).label;
  return (
    <Card variant="outlined">
      <Box component="img" src={giftVouchersApi.visualImageUrl(visual)} alt={visual.name} loading="lazy" sx={{ width: '100%', aspectRatio: '1240 / 1748', objectFit: 'cover', display: 'block', bgcolor: 'action.hover' }} />
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{visual.name}</Typography>
            <Typography variant="body2" color="text.secondary">{use}</Typography>
          </Box>
          <Stack direction="row">
            <Tooltip title={`${T.rename} · ${T.replace}`}>
              <IconButton aria-label={`${T.rename} ${visual.name}`} onClick={() => onEdit(visual)} sx={{ width: 44, height: 44 }}><EditOutlinedIcon /></IconButton>
            </Tooltip>
            <Tooltip title={T.delete}>
              <IconButton aria-label={`${T.delete} ${visual.name}`} onClick={() => onDelete(visual)} sx={{ width: 44, height: 44 }}><DeleteOutlineIcon /></IconButton>
            </Tooltip>
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
          {`${T.campaigns} : ${visual.campaigns.length ? visual.campaigns.map((c) => c.name).join(', ') : T.none}`}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">{`${T.validVouchers} : ${visual.validVouchers}`}</Typography>
        {visual.versions > 1 ? <Typography variant="caption" color="text.secondary" component="div">{T.versions(visual.versions)}</Typography> : null}
      </CardContent>
    </Card>
  );
}

export default function VisualsPage() {
  const { showSuccess } = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);
  const [form, setForm] = useState({ open: false, visual: null });
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);

  const load = useCallback(() => {
    setError(false);
    giftVouchersApi.listVisuals().then((result) => setItems(result.items)).catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  async function remove() {
    const target = removing;
    try {
      await giftVouchersApi.deleteVisual(target.id);
      setRemoving(null);
      showSuccess(T.deleted);
      load();
    } catch (err) {
      setRemoving(null);
      setRemoveError((err && err.message) || 'Le visuel n’a pas pu être retiré.');
    }
  }

  let body;
  if (error) body = <ErrorAlert message={T.loadError} onRetry={load} />;
  else if (!items) body = <LoadingState />;
  else if (!items.length) body = <EmptyState icon={<ImageOutlinedIcon />} message={T.empty} actionLabel={T.add} onAction={() => setForm({ open: true, visual: null })} />;
  else {
    body = (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
        {items.map((v) => <VisualCard key={v.id} visual={v} onEdit={(visual) => setForm({ open: true, visual })} onDelete={(visual) => { setRemoveError(null); setRemoving(visual); }} />)}
      </Box>
    );
  }

  return (
    <Box>
      <PageActionBar
        title={T.title} tabs={<GiftVoucherTabs value="visuals" />}
        actionsBefore={[{ icon: <AddIcon />, tooltip: T.add, onClick: () => setForm({ open: true, visual: null }), color: 'primary' }]}
      />
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Typography variant="body2" color="text.secondary">{T.note}</Typography>
        {removeError ? <ErrorAlert message={removeError} /> : null}
        {body}
      </Stack>
      <VisualFormDialog open={form.open} visual={form.visual} onClose={() => setForm({ open: false, visual: null })} onSaved={() => { setForm({ open: false, visual: null }); load(); }} />
      <ConfirmDialog
        open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={remove} title={T.deleteTitle}
        message={removing ? T.deleteMessage(removing.name) : ''} confirmLabel={T.delete} cancelLabel={T.cancel}
      />
    </Box>
  );
}
