/**
 * OptionsPage — the « Options » tab of Options & ressources (specs/options-resources-ux.md rules 8-17,
 * 22, 26-27): the catalogue read by category, edited in a side panel.
 *
 * The server hands over the catalogue grouped, priced and annotated (`/options/catalogue-view`); this
 * page renders it. The only local work is two filters over the ready list — the text search and the
 * category chip — and the folded sections.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Chip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import SearchField from '../components/SearchField';
import SegmentedSelect from '../components/SegmentedSelect';
import GroupedList from '../components/GroupedList';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import { useAppDialogs, useToast } from '../components/DialogProvider';
import useCollapsedGroups from '../hooks/useCollapsedGroups';
import { PAGE_TITLE, TEXTS } from '../constants/optionsResourcesTexts';
import OptionRow from './options/OptionRow';
import ArchivedRow from './options/ArchivedRow';
import OptionEditorPanel from './options/OptionEditorPanel';

const ARCHIVED_KEY = 'archived';
const ALL = '*';

const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matches(query, ...fields) {
  const needle = fold(query).trim();
  return !needle || fields.some((field) => fold(field).includes(needle));
}

export default function OptionsPage({ barTabs }) {
  const { confirm } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const { isCollapsed, toggle } = useCollapsedGroups('options-catalogue', { defaultCollapsed: [ARCHIVED_KEY] });

  const [properties, setProperties] = useState([]);
  const [view, setView] = useState(null);
  const [error, setError] = useState(false);
  const [propertyFilter, setPropertyFilter] = useState(ALL);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState(ALL);
  const [editor, setEditor] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const flashTimer = useRef(null);

  const load = useCallback(async (filter) => {
    try {
      const data = await api.getOptionsCatalogueView(filter === ALL ? undefined : filter);
      setView(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    api.getProperties().then(setProperties).catch(() => setProperties([]));
  }, []);
  useEffect(() => { load(propertyFilter); }, [load, propertyFilter]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const searching = query.trim() !== '';
  const filtersActive = searching || chip !== ALL || propertyFilter !== ALL;

  const groups = useMemo(() => {
    if (!view) return [];
    const shown = view.groups
      .filter((g) => chip === ALL || g.key === chip)
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => matches(query, item.title, item.description, item.category)),
      }))
      .filter((g) => g.items.length > 0);
    const archivedItems = chip === ALL
      ? view.archived.filter((item) => matches(query, item.title, item.category))
      : [];
    if (archivedItems.length > 0) {
      shown.push({ key: ARCHIVED_KEY, label: TEXTS.archived, muted: true, count: view.archived.length, items: archivedItems });
    }
    return shown;
  }, [view, chip, query]);

  const resetFilters = () => { setQuery(''); setChip(ALL); setPropertyFilter(ALL); };

  const openNew = () => {
    const category = chip.startsWith('cat:') ? chip.slice(4) : '';
    setEditor({ id: null, category });
  };

  const handleSaved = async ({ id, isNew }) => {
    setEditor(null);
    showSuccess(isNew ? TEXTS.optionAdded : TEXTS.optionSaved);
    await load(propertyFilter);
    setHighlightId(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHighlightId(null), 1500);
  };

  const handleArchive = async (item) => {
    const ok = await confirm({
      title: TEXTS.archiveTitle(item.title),
      message: TEXTS.archiveMessage,
      confirmLabel: TEXTS.archive,
    });
    if (!ok) return;
    try {
      await api.deleteOption(item.id);
      showSuccess('Option archivée');
      await load(propertyFilter);
    } catch (err) {
      showError(err.message || 'Archivage impossible.');
    }
  };

  const handleRestore = async (item) => {
    setRestoring(true);
    try {
      await api.restoreOption(item.id);
      showSuccess(TEXTS.optionRestored);
      await load(propertyFilter);
    } catch (err) {
      showError(err.message || 'Restauration impossible.');
    } finally {
      setRestoring(false);
    }
  };

  const propertyOptions = [{ value: ALL, label: TEXTS.allProperties }, ...properties.map((p) => ({ value: p.id, label: p.name }))];

  let body;
  if (error && !view) {
    body = <ErrorAlert message={TEXTS.loadError} onRetry={() => load(propertyFilter)} />;
  } else if (!view) {
    body = <LoadingState variant="skeleton" rows={6} />;
  } else if (view.total === 0 && view.archived.length === 0) {
    body = (
      <EmptyState
        icon={<InventoryIcon />}
        title={TEXTS.emptyOptionsTitle}
        message={TEXTS.emptyOptionsMessage}
        actionLabel={TEXTS.emptyOptionsAction}
        onAction={openNew}
      />
    );
  } else {
    body = (
      <>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, alignItems: 'center', mb: 1.25 }}>
          <SearchField label={TEXTS.searchLabel} value={query} onChange={setQuery} sx={{ flex: '1 1 240px', minWidth: 0 }} />
          {properties.length > 1 && (
            <SegmentedSelect
              label={TEXTS.propertyFilter}
              options={propertyOptions}
              value={propertyFilter}
              onChange={setPropertyFilter}
              maxSegments={4}
            />
          )}
        </Box>
        <Box
          role="group"
          aria-label={TEXTS.categories}
          sx={{
            display: 'flex', gap: 0.75, overflowX: 'auto', pb: 0.5, mb: 0.5,
            scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          <CategoryChip label={TEXTS.allCategories} count={view.total} selected={chip === ALL} onClick={() => setChip(ALL)} />
          {view.chips.map((c) => (
            <CategoryChip key={c.key} label={c.label} count={c.count} selected={chip === c.key} onClick={() => setChip(c.key)} />
          ))}
        </Box>
        <GroupedList
          groups={groups}
          forceOpen={searching}
          isCollapsed={isCollapsed}
          onToggle={toggle}
          highlightId={highlightId}
          empty={(
            <EmptyState
              icon={<SearchOffIcon />}
              title={TEXTS.noResult}
              message={filtersActive ? 'Rien ne correspond à ces filtres.' : ''}
              actionLabel={TEXTS.clearFilters}
              onAction={resetFilters}
              py={5}
            />
          )}
          renderItem={(item, { group, highlighted }) => (group.key === ARCHIVED_KEY
            ? <ArchivedRow item={item} onRestore={handleRestore} busy={restoring} />
            : <OptionRow item={item} highlighted={highlighted} onOpen={(it) => setEditor({ id: it.id, category: '' })} onArchive={handleArchive} />)}
        />
      </>
    );
  }

  return (
    <>
      <PageActionBar
        title={PAGE_TITLE}
        tabs={barTabs}
        actionsBefore={[{ icon: <AddIcon />, tooltip: TEXTS.newOption, onClick: openNew, color: 'primary' }]}
      />
      <Box sx={{ mt: 2, maxWidth: 1240, mx: 'auto' }}>{body}</Box>
      <OptionEditorPanel
        open={Boolean(editor)}
        optionId={editor ? editor.id : null}
        initialCategory={editor ? editor.category : ''}
        properties={properties}
        categories={view ? view.chips.filter((c) => c.key !== 'none').map((c) => c.label) : []}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
      />
    </>
  );
}

function CategoryChip({ label, count, selected, onClick }) {
  return (
    <Chip
      onClick={onClick}
      aria-pressed={selected}
      variant={selected ? 'filled' : 'outlined'}
      color={selected ? 'primary' : 'default'}
      title={label}
      label={(
        <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
          <Box component="span" sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Box>
          <Box component="span" sx={{ fontSize: '0.78rem', opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>{count}</Box>
        </Box>
      )}
      sx={{ flex: 'none', height: 34, fontWeight: 500 }}
    />
  );
}
