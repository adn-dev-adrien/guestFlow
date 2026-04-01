import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, TableContainer, Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const PRICE_TYPES = [
  { value: 'per_stay', label: 'Prix fixe' },
  { value: 'per_person', label: 'Par personne' },
  { value: 'per_night', label: 'Par jour' },
  { value: 'per_person_per_night', label: 'Par personne / jour' },
  { value: 'free', label: 'Gratuit' },
];

export default function PricedItemsPage({
  pageTitle,
  itemLabel,
  emptyForm,
  loadItems,
  createItem,
  updateItem,
  deleteItem,
  fromItem,
  toPayload,
  formNameKey,
  formDescriptionKey,
  showQuantity,
  isDeleteDisabled,
}) {
  const [items, setItems] = useState([]);
  const [properties, setProperties] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    const { items: data, properties: props } = await loadItems();
    setItems(data);
    setProperties(props);
  };

  useEffect(() => {
    load();
  }, []);

  const openDialog = (item) => {
    if (item) {
      setForm(fromItem(item));
      setEditId(item.id);
    } else {
      setForm({ ...emptyForm });
      setEditId(null);
    }
    setOpen(true);
  };

  const handleSave = async () => {
    const payload = toPayload(form);
    if (editId) await updateItem(editId, payload);
    else await createItem(payload);
    setOpen(false);
    load();
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Supprimer cette ${itemLabel} ?`)) return;
    await deleteItem(item.id);
    load();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 3 }}>
        <Typography variant="h4">{pageTitle}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog(null)} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          {`Nouvelle ${itemLabel}`}
        </Button>
      </Box>

      <Card>
        <TableContainer>
          <Table size="small" sx={{ minWidth: showQuantity ? 980 : 860 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                {showQuantity && <TableCell sx={{ fontWeight: 600 }}>Quantite</TableCell>}
                <TableCell sx={{ fontWeight: 600 }}>Type de prix</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Prix (EUR)</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Logements</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => {
                const deleteDisabled = isDeleteDisabled ? isDeleteDisabled(item) : false;
                const name = item[formNameKey] || '';
                const description = item[formDescriptionKey] || '';
                return (
                  <TableRow key={item.id} hover sx={{ cursor: 'pointer' }} onClick={() => openDialog(item)}>
                    <TableCell>{name}</TableCell>
                    <TableCell>{description || '-'}</TableCell>
                    {showQuantity && <TableCell>{item.quantity}</TableCell>}
                    <TableCell>{PRICE_TYPES.find((t) => t.value === item.priceType)?.label || item.priceType || '-'}</TableCell>
                    <TableCell>{item.price}</TableCell>
                    <TableCell>
                      {!item.propertyIds || item.propertyIds.length === 0
                        ? 'Tous les logements'
                        : item.propertyIds.map((pid) => properties.find((p) => p.id === pid)?.name || pid).join(', ')}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); openDialog(item); }}><EditIcon fontSize="small" /></IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        disabled={deleteDisabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!deleteDisabled) handleDelete(item);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={showQuantity ? 7 : 6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {`Aucune ${itemLabel}`}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editId ? `Modifier ${itemLabel}` : `Nouvelle ${itemLabel}`}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Nom"
              value={form[formNameKey] || ''}
              onChange={(e) => setForm({ ...form, [formNameKey]: e.target.value })}
              fullWidth
              required
            />

            <TextField
              label="Description"
              value={form[formDescriptionKey] || ''}
              onChange={(e) => setForm({ ...form, [formDescriptionKey]: e.target.value })}
              fullWidth
              multiline
              rows={2}
            />

            {showQuantity && (
              <TextField
                label="Quantite"
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                fullWidth
                inputProps={{ min: 0 }}
              />
            )}

            <FormControl fullWidth>
              <InputLabel>Type de prix</InputLabel>
              <Select
                value={form.priceType || 'per_stay'}
                label="Type de prix"
                onChange={(e) => setForm({ ...form, priceType: e.target.value })}
              >
                {PRICE_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>

            {form.priceType !== 'free' && (
              <TextField
                label="Prix (EUR)"
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                fullWidth
                inputProps={{ min: 0, step: '0.01' }}
              />
            )}

            <FormControl fullWidth>
              <InputLabel>Logements</InputLabel>
              <Select
                multiple
                value={(!form.propertyIds || form.propertyIds.length === 0) ? [-1] : form.propertyIds}
                label="Logements"
                onChange={(e) => {
                  let newVal = e.target.value;
                  if (typeof newVal === 'string') newVal = newVal.split(',').map(Number);

                  const normalized = newVal.includes(-1) && newVal.length > 1
                    ? newVal.filter((v) => v !== -1)
                    : newVal;

                  if (normalized.includes(-1)) {
                    setForm({ ...form, propertyIds: [] });
                    return;
                  }

                  const allPropertyIds = properties.map((p) => p.id);
                  const allSelected = allPropertyIds.length > 0
                    && allPropertyIds.every((id) => normalized.includes(id));

                  if (allSelected) {
                    setForm({ ...form, propertyIds: [] });
                  } else {
                    setForm({ ...form, propertyIds: normalized });
                  }
                }}
                input={<OutlinedInput label="Logements" />}
                renderValue={(selected) =>
                  !selected || selected.length === 0 || selected.includes(-1)
                    ? 'Tous les logements'
                    : selected.map((pid) => properties.find((p) => p.id === pid)?.name || pid).join(', ')
                }
              >
                <MenuItem value={-1}>Tous les logements</MenuItem>
                {properties.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    <Checkbox checked={(form.propertyIds || []).includes(p.id)} />
                    <ListItemText primary={p.name} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form[formNameKey]}>
            Enregistrer
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
