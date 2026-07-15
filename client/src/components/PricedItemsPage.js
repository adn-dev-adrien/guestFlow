import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Tooltip, TableRow, TableCell, TableSortLabel,
  IconButton, TextField,
  FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DataPageScaffold from './DataPageScaffold';
import FormDialog from './FormDialog';
import PropertiesMultiSelect from './PropertiesMultiSelect';
import { useAppDialogs } from './DialogProvider';
import { formatCurrency } from '../utils/formatters';
import useCrudResource from '../hooks/useCrudResource';

const PRICE_TYPES = [
  { value: 'per_stay', label: 'Prix fixe' },
  { value: 'per_person', label: 'Par personne' },
  { value: 'per_night', label: 'Par jour' },
  { value: 'per_person_per_night', label: 'Par personne / jour' },
  { value: 'per_hour', label: 'Par heure' },
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
  getDeleteImpact,
  fromItem,
  toPayload,
  formNameKey,
  formDescriptionKey,
  showQuantity,
  isDeleteDisabled,
  renderExtraFormFields,
  getRowSx,
  priceTypes,
  // Optional: render the « Prix » cell content. Receives (item, properties). Defaults to `${price} €`.
  // Used by the Options page to surface the per-property price overrides next to the base price.
  renderPriceCell,
  // Optional: fully replace the dialog form body (Nom/Description/Type/Prix/Logements + extras) with
  // a bespoke layout. Receives ({ form, setForm, properties, priceTypes }). When provided,
  // renderExtraFormFields is ignored (the custom form renders everything).
  renderForm,
  // specs/option-property-scope.md: options use an EXPLICIT scope (« Tous » = all ids, empty = none).
  // Resources keep the legacy « empty = all ». Drives the « Logements » column label below.
  explicitPropertyScope = false,
  // Tab-wrapper mode (specs/ds-sweep-settings.md §3.2): the wrapper's Tabs render centered in the bar.
  barCenter,
}) {
    const resolvedPriceTypes = priceTypes || PRICE_TYPES;

  const { confirm } = useAppDialogs();
  const [properties, setProperties] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const handleSortClick = (col) => {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const loadWithProperties = useCallback(async () => {
    const { items: data, properties: props } = await loadItems();
    setProperties(props);
    return data;
  }, [loadItems]);

  const {
    items,
    loading,
    error,
    reload,
    createItem: createCrudItem,
    updateItem: updateCrudItem,
    removeItem: removeCrudItem,
  } = useCrudResource({
    listFn: loadWithProperties,
    createFn: (payload) => createItem(payload),
    updateFn: (id, payload) => updateItem(id, payload),
    deleteFn: (id) => deleteItem(id),
  });

  useEffect(() => {
    reload();
  }, [reload]);

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
    if (editId) await updateCrudItem(editId, payload);
    else await createCrudItem(payload);
    setOpen(false);
  };

  const handleDelete = async (item) => {
    // When a delete-impact loader is provided and the item is in use, state the impact and force-delete.
    if (getDeleteImpact) {
      let impact = null;
      try { impact = await getDeleteImpact(item.id); } catch { impact = null; }
      const reservationsCount = Number(impact?.reservationsCount || 0);
      const bookingsCount = Number(impact?.bookingsCount || 0);
      if (reservationsCount > 0 || bookingsCount > 0) {
        const parts = [];
        if (reservationsCount > 0) parts.push(`${reservationsCount} réservation(s)`);
        if (bookingsCount > 0) parts.push(`${bookingsCount} créneau(x)`);
        const ok = await confirm({
          title: 'Confirmer la suppression',
          message: `Cette ${itemLabel} est utilisée par ${parts.join(' et ')}. La supprimer la retirera de ces réservations et supprimera ces créneaux. Continuer ?`,
          confirmColor: 'error',
        });
        if (!ok) return;
        await deleteItem(item.id, { force: true });
        await reload();
        return;
      }
    }
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: `Supprimer cette ${itemLabel} ?`
    });
    if (!ok) return;
    await removeCrudItem(item.id);
  };

  const sortedItems = useMemo(() => {
    if (!sortCol) return items;
    return [...items].sort((a, b) => {
      let aVal, bVal;
      if (sortCol === 'name') { aVal = (a[formNameKey] || '').toLowerCase(); bVal = (b[formNameKey] || '').toLowerCase(); }
      else if (sortCol === 'description') { aVal = (a[formDescriptionKey] || '').toLowerCase(); bVal = (b[formDescriptionKey] || '').toLowerCase(); }
      else if (sortCol === 'quantity') { aVal = Number(a.quantity || 0); bVal = Number(b.quantity || 0); }
      else if (sortCol === 'priceType') { aVal = a.priceType || ''; bVal = b.priceType || ''; }
      else if (sortCol === 'price') { aVal = Number(a.price || 0); bVal = Number(b.price || 0); }
      else if (sortCol === 'properties') {
        const resolve = (item) => !item.propertyIds || item.propertyIds.length === 0
          ? 'aaa'
          : item.propertyIds.map((pid) => properties.find((p) => p.id === pid)?.name || '').sort().join(',').toLowerCase();
        aVal = resolve(a); bVal = resolve(b);
      }
      else { return 0; }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, sortCol, sortDir, formNameKey, formDescriptionKey]);

  // Shared by the table row and the xs card (specs/ds-sweep-settings.md §3.5).
  const propertiesLabel = (item) => {
    const pids = item.propertyIds || [];
    const everyProp = properties.length > 0 && properties.every((p) => pids.includes(p.id));
    if (explicitPropertyScope) {
      if (pids.length === 0) return 'Aucun logement';
      if (everyProp) return 'Tous les logements';
      return pids.map((pid) => properties.find((p) => p.id === pid)?.name || pid).join(', ');
    }
    return pids.length === 0
      ? 'Tous les logements'
      : pids.map((pid) => properties.find((p) => p.id === pid)?.name || pid).join(', ');
  };

  const SortableCell = ({ col, children, align }) => (
    <TableCell align={align} sx={{ fontWeight: 600 }}>
      <TableSortLabel
        active={sortCol === col}
        direction={sortCol === col ? sortDir : 'asc'}
        onClick={() => handleSortClick(col)}
      >
        {children}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Box>
      <DataPageScaffold
        title={pageTitle}
        actionLabel={`Nouvelle ${itemLabel}`}
        actionIcon={<AddIcon />}
        onAction={() => openDialog(null)}
        barCenter={barCenter}
        loading={loading && items.length === 0}
        error={error ? `Impossible de charger les ${itemLabel}s.` : ''}
        onRetry={reload}
        minWidth={showQuantity ? 980 : 860}
        head={(
          <TableRow>
            <SortableCell col="name">Nom</SortableCell>
            <SortableCell col="description">Description</SortableCell>
            <SortableCell col="properties">Logements</SortableCell>
            <SortableCell col="price" align="right">Prix</SortableCell>
            {showQuantity && <SortableCell col="quantity" align="right">Quantite</SortableCell>}
            <SortableCell col="priceType">Type de prix</SortableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
          </TableRow>
        )}
        emptyText={`Aucune ${itemLabel}`}
        items={sortedItems}
        getKey={(item) => item.id}
        renderRow={(item) => {
          const deleteDisabled = isDeleteDisabled ? isDeleteDisabled(item) : false;
          const name = item[formNameKey] || '';
          const description = item[formDescriptionKey] || '';
          return (
            <TableRow key={item.id} hover sx={{ cursor: 'pointer', ...(getRowSx ? getRowSx(item) : {}) }} onClick={() => openDialog(item)}>
              <TableCell>{name}</TableCell>
              <TableCell>{description || '—'}</TableCell>
              <TableCell>{propertiesLabel(item)}</TableCell>
              {/* Amounts right-aligned in tabular figures via formatCurrency (design-system-reference.md §5). */}
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {renderPriceCell ? renderPriceCell(item, properties) : formatCurrency(item.price)}
              </TableCell>
              {showQuantity && <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{item.quantity}</TableCell>}
              <TableCell>{resolvedPriceTypes.find((t) => t.value === item.priceType)?.label || item.priceType || '—'}</TableCell>
              <TableCell align="right">
                <Tooltip title="Modifier">
                  <IconButton size="small" aria-label="Modifier" onClick={(e) => { e.stopPropagation(); openDialog(item); }}><EditIcon fontSize="small" /></IconButton>
                </Tooltip>
                <Tooltip title="Supprimer">
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label="Supprimer"
                      disabled={deleteDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!deleteDisabled) handleDelete(item);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </TableCell>
            </TableRow>
          );
        }}
        renderMobileCard={(item) => {
          const deleteDisabled = isDeleteDisabled ? isDeleteDisabled(item) : false;
          return (
            <Stack onClick={() => openDialog(item)} sx={{ cursor: 'pointer', gap: 0.5 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{item[formNameKey] || ''}</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {renderPriceCell ? renderPriceCell(item, properties) : formatCurrency(item.price)}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {propertiesLabel(item)} · {resolvedPriceTypes.find((t) => t.value === item.priceType)?.label || item.priceType || '—'}
              </Typography>
              <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                <Tooltip title="Modifier">
                  <IconButton size="small" aria-label="Modifier" onClick={(e) => { e.stopPropagation(); openDialog(item); }}><EditIcon fontSize="small" /></IconButton>
                </Tooltip>
                <Tooltip title="Supprimer">
                  <span>
                    <IconButton size="small" color="error" aria-label="Supprimer" disabled={deleteDisabled} onClick={(e) => { e.stopPropagation(); if (!deleteDisabled) handleDelete(item); }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          );
        }}
      />
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Modifier ${itemLabel}` : `Nouvelle ${itemLabel}`}
        onSubmit={handleSave}
        submitDisabled={!form[formNameKey]}
        submitLabel="Enregistrer"
      >
          {renderForm ? renderForm({ form, setForm, properties, priceTypes: resolvedPriceTypes }) : (
          <>
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
                slotProps={{
                  htmlInput: { min: 0 }
                }}
              />
            )}

            <FormControl fullWidth>
              <InputLabel>Type de prix</InputLabel>
              <Select
                value={form.priceType || 'per_stay'}
                label="Type de prix"
                onChange={(e) => setForm({ ...form, priceType: e.target.value })}
              >
                {resolvedPriceTypes.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>

            {form.priceType !== 'free' && (
              <TextField
                label="Prix (EUR)"
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                fullWidth
                slotProps={{
                  htmlInput: { min: 0, step: '0.01' }
                }}
              />
            )}

            <PropertiesMultiSelect
              properties={properties}
              value={form.propertyIds}
              onChange={(ids) => setForm({ ...form, propertyIds: ids })}
            />

          </Box>
          {renderExtraFormFields && renderExtraFormFields(form, setForm, { properties })}
          </>
          )}
      </FormDialog>
    </Box>
  );
}
