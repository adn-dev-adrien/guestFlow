/**
 * ResourcesPage — the « Ressources » tab of Options & ressources (specs/options-resources-ux.md
 * rules 18-22): one card per resource, shaped by the server (`/resources/catalogue-view`, with the
 * lines a plugin adds), opened in a side panel. Deleting stays in the card's « ⋯ » menu with the
 * existing impact confirmation.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import RowActionsMenu from '../components/RowActionsMenu';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import { PAGE_TITLE, TEXTS } from '../constants/optionsResourcesTexts';
import ResourceEditorPanel from './options/ResourceEditorPanel';

function ResourceCard({ item, onOpen, onDelete }) {
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`${TEXTS.edit} ${item.name}`}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item); }
      }}
      sx={{
        bgcolor: 'background.paper', borderRadius: '14px', p: { xs: 1.75, sm: 2.25 }, cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(39,37,31,.06), 0 4px 14px rgba(39,37,31,.05)',
        border: '1px solid transparent', display: 'flex', flexDirection: 'column', gap: 1,
        transition: 'border-color 150ms', '@media (hover: hover) and (pointer: fine)': { '&:hover': { borderColor: 'primary.light' } },
        '&:active': { transform: 'scale(.995)' },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'flex-start' }}>
        <Typography variant="sectionHeader" component="h2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item.name}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, flex: 'none' }}>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontWeight: 700, fontSize: '1.4rem', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {item.stock.value.toLocaleString('fr-FR')}
            </Typography>
            <Typography variant="caption" color="text.secondary">{item.stock.label}</Typography>
          </Box>
          <RowActionsMenu
            label={`Actions de ${item.name}`}
            items={[
              { label: TEXTS.edit, onClick: () => onOpen(item) },
              {
                label: 'Supprimer', danger: true, onClick: () => onDelete(item),
                disabled: !item.deletable, hint: item.deletable ? undefined : 'Le lit bébé reste au catalogue.',
              },
            ]}
          />
        </Box>
      </Box>
      {item.description && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{item.description}</Typography>}
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '0.86rem' }}>
        {item.lines.map((line) => (
          <React.Fragment key={`${line.label}:${line.value}`}>
            <Box component="dt" sx={{ color: 'text.secondary' }}>{line.label}</Box>
            <Box component="dd" sx={{ m: 0, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{line.value}</Box>
          </React.Fragment>
        ))}
      </Box>
      {item.footer && (
        <Typography variant="caption" color="text.secondary" sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
          {item.footer}
        </Typography>
      )}
    </Box>
  );
}

export default function ResourcesPage({ barTabs }) {
  const { confirm } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [items, setItems] = useState(null);
  const [properties, setProperties] = useState([]);
  const [error, setError] = useState(false);
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getResourcesCatalogueView();
      setItems(data.items);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.getProperties().then(setProperties).catch(() => setProperties([])); }, []);

  const handleSaved = async ({ isNew }) => {
    setEditor(null);
    showSuccess(isNew ? TEXTS.resourceAdded : TEXTS.resourceSaved);
    await load();
  };

  const handleDelete = async (item) => {
    let impact = null;
    try { impact = await api.getResourceDeleteImpact(item.id); } catch { impact = null; }
    const reservations = Number(impact && impact.reservationsCount) || 0;
    const bookings = Number(impact && impact.bookingsCount) || 0;
    const inUse = reservations > 0 || bookings > 0;
    const parts = [];
    if (reservations > 0) parts.push(`${reservations} réservation(s)`);
    if (bookings > 0) parts.push(`${bookings} créneau(x)`);
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: inUse
        ? `Cette ressource est utilisée par ${parts.join(' et ')}. La supprimer la retirera de ces réservations et supprimera ces créneaux. Continuer ?`
        : `Supprimer « ${item.name} » ?`,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await api.deleteResource(item.id, inUse ? { force: true } : undefined);
      await load();
    } catch (err) {
      showError(err.message || 'Suppression impossible.');
    }
  };

  let body;
  if (error && !items) body = <ErrorAlert onRetry={load} />;
  else if (!items) body = <LoadingState variant="skeleton" rows={4} />;
  else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<DevicesOtherIcon />}
        title={TEXTS.emptyResourcesTitle}
        message={TEXTS.emptyResourcesMessage}
        actionLabel={TEXTS.emptyResourcesAction}
        onAction={() => setEditor({ id: null })}
      />
    );
  } else {
    body = (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(320px, 1fr))' }, gap: { xs: 1.5, sm: 2 } }}>
        {items.map((item) => (
          <ResourceCard key={item.id} item={item} onOpen={(it) => setEditor({ id: it.id })} onDelete={handleDelete} />
        ))}
      </Box>
    );
  }

  return (
    <>
      <PageActionBar
        title={PAGE_TITLE}
        tabs={barTabs}
        actionsBefore={[{ icon: <AddIcon />, tooltip: TEXTS.newResource, onClick: () => setEditor({ id: null }), color: 'primary' }]}
      />
      <Box sx={{ mt: 2, maxWidth: 1240, mx: 'auto' }}>{body}</Box>
      <ResourceEditorPanel
        open={Boolean(editor)}
        resourceId={editor ? editor.id : null}
        properties={properties}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
      />
    </>
  );
}
