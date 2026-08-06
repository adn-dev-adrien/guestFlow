import React, { useId, useState } from 'react';
import { Box, ButtonBase, Chip, Collapse, Divider, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

/**
 * Generic collapsible section — a header row that folds/unfolds its children.
 *
 * Deliberately NOT a Card: it is meant to group cards, so a card chrome of its own would compete
 * with the content. The header reads as a peer of the surrounding `variant="sectionHeader"`
 * headings, preceded by a hairline divider.
 *
 * Props:
 *  - `title`            (string, required)  Section label.
 *  - `count`            (number)            Shown as a soft success chip when > 0. Use it for
 *                                           "how many items in here are active", so a collapsed
 *                                           section never looks empty when it isn't.
 *  - `defaultExpanded`  (bool)              Initial state. Default false (collapsed).
 *  - `toggleLabel`      (node)              Text of the expand affordance under the header, shown
 *                                           when collapsed. Omit to hide the affordance.
 *  - `collapseLabel`    (node)              Text of the same affordance when expanded.
 *                                           Default « Réduire ».
 *  - `header`           (node)              Extra node rendered between the title and the chip.
 *  - `pinned`           (node)              Rendered BETWEEN the header and the collapse, so it
 *                                           stays visible in both states.
 *  - `children`         (node)              The foldable body.
 *  - `disableDivider`   (bool)              Drop the leading hairline.
 */
export default function CollapsibleSection({
  title,
  count = 0,
  defaultExpanded = false,
  toggleLabel,
  collapseLabel = 'Réduire',
  header = null,
  pinned = null,
  children,
  disableDivider = false,
}) {
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  const bodyId = useId();
  const toggle = () => setExpanded((v) => !v);
  const activeCount = Number(count) || 0;

  return (
    <Box>
      {!disableDivider && <Divider sx={{ mb: 1.5 }} />}
      <ButtonBase
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        aria-label={`Catégorie ${title}${activeCount > 0 ? `, ${activeCount} option${activeCount > 1 ? 's' : ''} sélectionnée${activeCount > 1 ? 's' : ''}` : ''}`}
        sx={{
          width: '100%',
          minHeight: 44,
          px: 1.5,
          py: 1,
          borderRadius: 2,
          justifyContent: 'space-between',
          textAlign: 'left',
          transition: 'background-color 0.2s ease',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Typography
          variant="sectionHeader"
          noWrap
          sx={{ fontSize: '0.95rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {title}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {header}
          {activeCount > 0 && (
            <Chip
              size="small"
              label={activeCount}
              sx={{
                fontWeight: 600,
                bgcolor: 'success.soft',
                color: 'success.main',
                '& .MuiChip-label': { px: 1 },
              }}
            />
          )}
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              color: 'text.secondary',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          />
        </Stack>
      </ButtonBase>

      {pinned && <Box sx={{ mt: 1.25 }}>{pinned}</Box>}

      <Collapse in={expanded} unmountOnExit id={bodyId}>
        <Box sx={{ mt: 1.25 }}>{children}</Box>
      </Collapse>

      {toggleLabel && (
        <ButtonBase
          onClick={toggle}
          tabIndex={-1}
          aria-hidden
          sx={{ mt: 1, px: 1.5, py: 0.5, borderRadius: 1, justifyContent: 'flex-start' }}
        >
          <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 500 }}>
            {expanded ? collapseLabel : toggleLabel}
          </Typography>
        </ButtonBase>
      )}
    </Box>
  );
}
