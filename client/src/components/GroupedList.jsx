/**
 * GroupedList — foldable sections over a payload the server already grouped
 * (specs/options-resources-ux.md §4.2). Each section: a serif header with the label, a count pill and a
 * chevron, then its rows inside one white card with hairline dividers. The list renders nothing it was
 * not given: grouping, order and counts are the caller's data, not computed here.
 *
 * Props:
 *   groups        Array<{ key: string, label: string, items: any[], count?: number, muted?: boolean }>
 *                 `count` is the size of the whole group; when `items` is shorter (a search is active) the
 *                 pill reads « 2 / 9 ». `muted` greys the header (an archive).
 *   renderItem    (item, { group, highlighted }) => ReactNode   the row; it owns its padding and its click
 *   getItemKey?   (item) => string|number    default `item.id`
 *   isCollapsed?  (key) => boolean           folded sections (see useCollapsedGroups); default none
 *   onToggle?     (key) => void              header click; without it the headers are not foldable
 *   forceOpen?    boolean                    unfold everything (a search is active)
 *   highlightId?  string|number              row to flash after a save, handed to `renderItem`
 *   empty?        ReactNode                  shown when `groups` is empty
 *
 * Mobile: headers and chevrons keep a 44 px touch target; the card goes edge-to-edge minus a 12 px gutter
 * at the page's own padding. `prefers-reduced-motion` removes the unfold fade.
 */
import React, { useId } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

function GroupSection({
  group, renderItem, getItemKey, collapsed, onToggle, highlightId,
}) {
  const bodyId = useId();
  const foldable = typeof onToggle === 'function';
  const total = group.count ?? group.items.length;
  const pill = group.items.length < total ? `${group.items.length} / ${total}` : String(total);
  return (
    <Box component="section" sx={{ mt: 1.75 }}>
      <Typography variant="sectionHeader" component="h2" sx={{ m: 0 }}>
        <Box
          component={foldable ? ButtonBase : 'div'}
          onClick={foldable ? () => onToggle(group.key) : undefined}
          aria-expanded={foldable ? !collapsed : undefined}
          aria-controls={foldable ? bodyId : undefined}
          sx={{
            display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'center', gap: 1.25, px: 0.5, py: 1,
            minHeight: 44, textAlign: 'left', borderRadius: 2, font: 'inherit', color: group.muted ? 'text.secondary' : 'text.primary',
          }}
        >
          <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{group.label}</Box>
          <Box
            component="span"
            sx={{
              flex: 'none', px: 1, borderRadius: 99, bgcolor: 'grey.200', color: 'text.secondary',
              fontSize: '0.75rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            }}
          >
            {pill}
          </Box>
          {foldable && (
            <ExpandMoreIcon
              sx={{
                ml: 'auto', flex: 'none', color: 'text.secondary',
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 250ms cubic-bezier(.32,.72,0,1)',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            />
          )}
        </Box>
      </Typography>
      {!collapsed && (
        <Box
          id={bodyId}
          sx={{
            bgcolor: 'background.paper', borderRadius: '14px', overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(39,37,31,.06), 0 4px 14px rgba(39,37,31,.05)',
            animation: 'gl-in 200ms cubic-bezier(.32,.72,0,1)',
            '@keyframes gl-in': { from: { opacity: 0 }, to: { opacity: 1 } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {group.items.map((item, index) => {
            const key = getItemKey(item);
            return (
              <Box key={key} sx={{ borderTop: index === 0 ? 0 : '1px solid', borderColor: 'divider' }}>
                {renderItem(item, { group, highlighted: highlightId !== undefined && highlightId !== null && String(highlightId) === String(key) })}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

export default function GroupedList({
  groups, renderItem, getItemKey = (item) => item.id, isCollapsed = () => false, onToggle,
  forceOpen = false, highlightId, empty = null,
}) {
  if (!groups || groups.length === 0) return empty;
  return (
    <Box>
      {groups.map((group) => (
        <GroupSection
          key={group.key}
          group={group}
          renderItem={renderItem}
          getItemKey={getItemKey}
          collapsed={!forceOpen && isCollapsed(group.key)}
          onToggle={onToggle}
          highlightId={highlightId}
        />
      ))}
    </Box>
  );
}
