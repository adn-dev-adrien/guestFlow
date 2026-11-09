/**
 * `button` (rule 18): a label and where it leads — a page of this booklet, an article sold here, or an address.
 * A button whose target the guest cannot reach (module off, article not sold here) is not drawn in the app.
 */
import { Box, MenuItem, TextField } from '@mui/material';
import BilingualField from '../BilingualField';

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
          onChange={(e) => setTarget(e.target.value === 'page' ? { kind: 'page', slug: '' } : e.target.value === 'item' ? { kind: 'item', itemKind: 'option', itemId: 0 } : { kind: 'url', href: 'https://' })}
        >
          <MenuItem value="page">Une page du livret</MenuItem>
          <MenuItem value="item">Un article de la boutique</MenuItem>
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
        {target.kind === 'url' ? (
          <TextField label="Adresse" type="url" value={target.href || ''} onChange={(e) => setTarget({ kind: 'url', href: e.target.value })} helperText="Commence par https://" slotProps={{ htmlInput: { maxLength: 2000, inputMode: 'url' } }} />
        ) : null}
      </Box>
    </Box>
  );
}
