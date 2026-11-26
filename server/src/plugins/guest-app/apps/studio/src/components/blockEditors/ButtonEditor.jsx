/**
 * `button` (rule 18): a label and where it leads — a page of this booklet, an article sold here, the « Pratique » page (on a
 * category's chip, or all of them) or an address.
 * A button whose target the guest cannot reach (module off, article not sold here) is not drawn in the app.
 */
import { Box, MenuItem, TextField } from '@mui/material';
import BilingualField from '../BilingualField';
import { useLoad } from '../../hooks/useLoad';
import { api } from '../../services/api';

/** The category choice of the « Pratique » target: the closed set is the server's (`GET /places`), read when this target is picked. */
function PlaceCategoryField({ target, setTarget }) {
  const { data } = useLoad(() => api.places(), []);
  const categories = (data && data.categories) || [];
  const known = categories.some((c) => c.key === target.category);
  return (
    <TextField
      select
      label="Catégorie"
      value={known ? target.category : ''}
      onChange={(e) => setTarget(e.target.value ? { kind: 'places', category: e.target.value } : { kind: 'places' })}
      helperText="La page s’ouvre avec cette catégorie déjà sélectionnée."
    >
      <MenuItem value="">Toutes</MenuItem>
      {categories.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
    </TextField>
  );
}

const NEW_TARGET = {
  page: { kind: 'page', slug: '' },
  item: { kind: 'item', itemKind: 'option', itemId: 0 },
  places: { kind: 'places' },
  url: { kind: 'url', href: 'https://' },
};

export default function ButtonEditor({ data, onChange, pages = [], items = [] }) {
  const target = data.target || { kind: 'page', slug: '' };
  const setTarget = (next) => onChange({ ...data, target: next });
  const itemValue = target.kind === 'item' ? `${target.itemKind}:${target.itemId}` : '';
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <BilingualField label="Libellé" value={data.label} required maxLength={60} onChange={(label) => onChange({ ...data, label })} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '220px 1fr' } }}>
        <TextField
          select
          label="Mène vers"
          value={target.kind}
          onChange={(e) => setTarget(NEW_TARGET[e.target.value])}
        >
          <MenuItem value="page">Une page du livret</MenuItem>
          <MenuItem value="item">Un article de la boutique</MenuItem>
          <MenuItem value="places">La page Pratique</MenuItem>
          <MenuItem value="url">Une adresse web</MenuItem>
        </TextField>
        {target.kind === 'page' ? (
          <TextField select label="Page" value={target.slug || ''} onChange={(e) => setTarget({ kind: 'page', slug: e.target.value })}>
            {pages.map((p) => <MenuItem key={p.slug} value={p.slug}>{p.title.fr}</MenuItem>)}
          </TextField>
        ) : null}
        {target.kind === 'item' ? (
          <TextField
            select
            label="Article"
            value={itemValue}
            onChange={(e) => {
              const [itemKind, id] = e.target.value.split(':');
              setTarget({ kind: 'item', itemKind, itemId: Number(id) });
            }}
            helperText={items.length ? null : 'Aucun article n’est vendu dans ce logement.'}
          >
            {items.map((i) => <MenuItem key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>{i.title}</MenuItem>)}
          </TextField>
        ) : null}
        {target.kind === 'places' ? <PlaceCategoryField target={target} setTarget={setTarget} /> : null}
        {target.kind === 'url' ? (
          <TextField label="Adresse" type="url" value={target.href || ''} onChange={(e) => setTarget({ kind: 'url', href: e.target.value })} helperText="Commence par https://" slotProps={{ htmlInput: { maxLength: 2000, inputMode: 'url' } }} />
        ) : null}
      </Box>
    </Box>
  );
}
