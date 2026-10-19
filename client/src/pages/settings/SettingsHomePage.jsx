/**
 * SettingsHomePage — `/settings`, the summary of Paramètres (specs/settings-rationalization.md rules
 * 24–27; UI/UX review 2026-10-18, proposal 20 and decision 12).
 *
 * The four groups of constants/settingsMenu.js, each page on one row with its state line computed by
 * the server (GET /api/settings/summary), and a search that understands the owner's words (wifi,
 * iban, smtp, 2fa…). `/settings#<group>` — what a group of the sidebar opens — scrolls to that group
 * and marks it for a moment.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  Box, Card, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import PageActionBar from '../../components/PageActionBar';
import EmptyState from '../../components/EmptyState';
import { useAuth } from '../../hooks/useAuth';
import { canSeeRoute } from '../../constants/roles';
import { visibleSettingsGroups, SETTINGS_KEYWORDS } from '../../constants/settingsMenu';
import { matchSettingsRow } from '../../utils/settingsSearch';
import api from '../../api';

// Short enough for a 390 px phone (specs/settings-rationalization.md rule 31).
const SEARCH_PLACEHOLDER = 'Chercher : wifi, iban, smtp…';
const SEARCH_HINT = 'Essayer : wifi, iban, smtp, 2fa, caution.';

export default function SettingsHomePage() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const [lines, setLines] = useState({});
  const [query, setQuery] = useState('');
  const focusGroup = String(hash || '').replace(/^#/, '');

  useEffect(() => {
    let live = true;
    // The rows stand without their state lines: a failed read only leaves them out.
    api.getSettingsSummary().then((data) => { if (live) setLines((data && data.lines) || {}); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const groups = useMemo(
    () => visibleSettingsGroups((path) => canSeeRoute(user, path), (id) => (user?.enabledPlugins || []).includes(id), { withExtras: true }),
    [user],
  );

  const shown = groups.map((group) => ({
    ...group,
    rows: group.entries.map((entry) => {
      const line = lines[entry.path] || null;
      const hit = matchSettingsRow({ label: entry.label, line: line && line.text, keywords: SETTINGS_KEYWORDS[entry.path] }, query);
      return hit ? { entry, line, keyword: hit.keyword } : null;
    }).filter(Boolean),
  })).filter((group) => group.rows.length > 0);

  useEffect(() => {
    if (!focusGroup) return;
    const el = document.getElementById(`groupe-${focusGroup}`);
    if (el) el.scrollIntoView({ block: 'start' });
  }, [focusGroup]);

  return (
    <Box>
      <PageActionBar title="Paramètres" />
      <Box sx={{ maxWidth: 1080, mx: 'auto', p: { xs: 1.5, sm: 3 } }}>
        <TextField
          type="search"
          fullWidth
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER}
          slotProps={{
            htmlInput: { 'aria-label': 'Chercher un réglage', enterKeyHint: 'search' },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }}
          sx={{ maxWidth: { md: 520 }, mb: 2.5, '& input': { fontSize: 16 } }}
        />
        {shown.length === 0 ? (
          <EmptyState icon={<SearchIcon />} title={`Aucun réglage pour « ${query.trim()} »`} message={SEARCH_HINT} />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: { xs: 2.5, md: 3 }, alignItems: 'start' }}>
            {shown.map((group) => (
              <Box key={group.id} id={`groupe-${group.id}`} component="section" aria-labelledby={`titre-${group.id}`} sx={{ scrollMarginTop: { xs: 128, sm: 144 } }}>
                <Typography id={`titre-${group.id}`} variant="sectionHeader" component="h2" sx={{ mb: 1, color: 'primary.main' }}>
                  {group.label}
                </Typography>
                <Card
                  variant="outlined"
                  sx={(t) => ({
                    transition: 'box-shadow 600ms ease-out',
                    boxShadow: focusGroup === group.id && !query ? `0 0 0 2px ${t.palette.primary.main}` : 'none',
                  })}
                >
                  <List disablePadding>
                    {group.rows.map(({ entry, line, keyword }, i) => (
                      <ListItemButton
                        key={entry.path}
                        component={Link}
                        to={entry.path}
                        divider={i < group.rows.length - 1}
                        sx={{ minHeight: 56, py: 1, gap: 0.5 }}
                      >
                        <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}><entry.Icon fontSize="small" /></ListItemIcon>
                        <ListItemText
                          primary={entry.label}
                          secondary={(
                            <>
                              {line && (
                                <Box component="span" sx={{ display: 'block', color: line.tone === 'warning' ? 'warning.main' : 'text.secondary' }}>
                                  {line.text}
                                </Box>
                              )}
                              {keyword && (
                                <Box component="span" sx={{ display: 'block', color: 'primary.main' }}>{`Contient : ${keyword}`}</Box>
                              )}
                            </>
                          )}
                          slotProps={{ primary: { sx: { fontWeight: 600 } }, secondary: { component: 'span' } }}
                          sx={{ minWidth: 0, my: 0 }}
                        />
                        <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled', flex: 'none' }} aria-hidden />
                      </ListItemButton>
                    ))}
                  </List>
                </Card>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
