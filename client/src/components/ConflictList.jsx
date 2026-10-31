/**
 * ConflictList — a refusal or a warning that names records, each with a link to open it
 * (specs/payment-link-lifecycle.md rules 40, 41, 49: the closure dialog). Any 409 that names stays can use it.
 *
 * Props:
 *   severity:    'error' | 'warning'                 the tone of the whole block (default 'warning')
 *   title?:      string                              headline of a single group
 *   items?:      Array<{ key?, label, detail?, url }> rows of a single group
 *   groups?:     Array<{ title, items }>             several groups in one block (replaces title/items)
 *   openLabel?:  string                              the link text (default « Ouvrir »)
 *   newTab?:     boolean                             open in a new tab (desktop) or in place (phone)
 *
 * The server shapes every text: the component prints `label`, `detail` and links `url`. Renders nothing when
 * no group has a row.
 */
import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { Link as RouterLink, useInRouterContext } from 'react-router';

function OpenLink({ url, label, ariaLabel, newTab, inRouter }) {
  const target = newTab ? { target: '_blank', rel: 'noopener' } : {};
  const nav = inRouter ? { component: RouterLink, to: url } : { href: url };
  return (
    <Button size="small" variant="text" color="inherit" aria-label={ariaLabel} {...nav} {...target}
      sx={{ minHeight: 44, minWidth: 44, flexShrink: 0, textTransform: 'none', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>
      {label}
    </Button>
  );
}

export default function ConflictList({ severity = 'warning', title, items, groups, openLabel = 'Ouvrir', newTab = false }) {
  const inRouter = useInRouterContext();
  const list = (groups || [{ title, items }]).filter((g) => g && Array.isArray(g.items) && g.items.length > 0);
  if (list.length === 0) return null;
  return (
    <Alert severity={severity} role={severity === 'error' ? 'alert' : 'status'} sx={{ '& .MuiAlert-message': { width: '100%', minWidth: 0 } }}>
      {list.map((group, gi) => (
        <Box key={group.title || gi} sx={{ mt: gi > 0 ? 1.5 : 0 }}>
          {group.title && <Typography variant="body2" sx={{ fontWeight: 600 }}>{group.title}</Typography>}
          <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 0.5 }}>
            {group.items.map((item) => (
              <Box component="li" key={item.key || item.url}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.label}</Typography>
                  {item.detail && (
                    <Typography variant="caption" component="div" sx={{ opacity: 0.85, overflowWrap: 'anywhere' }}>{item.detail}</Typography>
                  )}
                </Box>
                <OpenLink url={item.url} label={openLabel} ariaLabel={`${openLabel} : ${item.label}`} newTab={newTab} inRouter={inRouter} />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Alert>
  );
}
