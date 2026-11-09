/**
 * PagesList — one lodging's booklet (rules 16-17): its pages in its own order (drag, or « Monter » / « Descendre »),
 * each published or kept as a draft in this lodging only, with « Partagée avec L'Estiva » when the page is placed
 * in another lodging's booklet too. Order and visibility are saved at once.
 *
 * Props: `lodging`, `pages` (the booklet's `pages`), `currentId`, `onOpen(pageId)`, `onReorder(pages)`,
 *        `onTogglePublished(page, published)`, `onCreate()`, `busy`, `footer` (the booklet's state line).
 */
import {
  Box, Button, ButtonBase, Switch, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StatusBadge from '@guestflow/components/StatusBadge';
import Section from './Section';
import SortableList, { moveItem } from './SortableList';

export default function PagesList({
  lodging, pages, currentId, onOpen, onReorder, onTogglePublished, onCreate, busy, footer,
}) {
  return (
    <Section
      id="pages"
      title={`Livret de ${lodging.name}`}
      description="L’ordre est propre à chaque logement. Glissez pour le changer."
      action={<Button variant="outlined" startIcon={<AddIcon />} onClick={onCreate} sx={{ minHeight: 44 }}>Nouvelle page</Button>}
    >
      {!pages.length ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>Aucune page : créez la première.</Typography> : null}
      <SortableList
        items={pages}
        getKey={(p) => p.id}
        label={(p) => p.title.fr}
        disabled={busy}
        onMove={(from, to) => onReorder(moveItem(pages, from, to))}
        renderItem={(p, { handle, up, down }) => {
          const current = p.id === currentId;
          const shared = p.sharedWith.map((s) => s.name).join(', ');
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.5, borderRadius: 2, bgcolor: current ? 'action.selected' : 'transparent' }}>
              {handle}
              <ButtonBase onClick={() => onOpen(p.id)} aria-current={current ? 'true' : undefined} sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', minHeight: 44, borderRadius: 1, px: 0.5 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>{p.title.fr}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.25 }}>
                    <StatusBadge status={p.published ? 'success' : 'neutral'} label={p.published ? 'Publiée' : 'Brouillon'} />
                    {shared ? <StatusBadge status="info" label={`Partagée avec ${shared}`} /> : null}
                    {p.placeholder ? <StatusBadge status="warning" label="Page provisoire" /> : null}
                  </Box>
                </Box>
              </ButtonBase>
              <Tooltip title={p.published ? `Retirer « ${p.title.fr} » du livret de ${lodging.name}` : `Montrer « ${p.title.fr} » dans le livret de ${lodging.name}`}>
                <Switch
                  checked={p.published}
                  disabled={busy}
                  onChange={(e) => onTogglePublished(p, e.target.checked)}
                  slotProps={{ input: { 'aria-label': `« ${p.title.fr} » visible dans le livret de ${lodging.name}` } }}
                />
              </Tooltip>
              <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 1 } }}>{up}{down}</Box>
            </Box>
          );
        }}
      />
      {footer}
    </Section>
  );
}
