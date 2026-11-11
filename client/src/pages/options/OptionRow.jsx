/**
 * OptionRow — one option in the catalogue list (specs/options-resources-ux.md rule 9): the name
 * (wraps, never cut), the description on one line, the traits the server computed, the price summary
 * right-aligned in tabular figures with its unit under it, and the « ⋯ » menu. The whole row opens the
 * editor (click anywhere, or Tab to the name and Enter / Space). On `xs` the price sits top right and
 * the menu under it.
 *
 * Props: item (a catalogue-view item), highlighted (flash after a save), onOpen(item), onArchive(item)
 */
import React from 'react';
import { Box, ButtonBase, Chip, Typography } from '@mui/material';
import { softChipSx } from '../../components/StatusBadge';
import RowActionsMenu from '../../components/RowActionsMenu';
import { TEXTS } from '../../constants/optionsResourcesTexts';

export default function OptionRow({ item, highlighted, onOpen, onArchive }) {
  const open = () => onOpen(item);
  const archiveItem = {
    label: TEXTS.archive,
    danger: true,
    onClick: () => onArchive(item),
    disabled: !item.archivable,
    hint: item.archivable ? undefined : TEXTS.keptInCatalogue(item.archiveBlockedReason),
  };
  return (
    <Box
      sx={{
        position: 'relative', display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr) auto', sm: 'minmax(0,1fr) auto 44px' },
        gap: { xs: '2px 10px', sm: '4px 16px' }, alignItems: 'center',
        pl: { xs: 1.75, sm: 2.25 }, pr: 1, py: 1.5,
        '@media (hover: hover) and (pointer: fine)': { '&:hover': { bgcolor: 'action.hover' } },
        '&:active': { bgcolor: 'action.selected' },
        ...(highlighted ? {
          animation: 'row-flash 1.2s cubic-bezier(.32,.72,0,1)',
          '@keyframes row-flash': { from: { backgroundColor: 'rgba(62,125,84,.16)' }, to: { backgroundColor: 'transparent' } },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        } : {}),
      }}
    >
      <Box sx={{ gridColumn: 1, gridRow: { xs: '1 / 3', sm: 'auto' }, minWidth: 0 }}>
        {/* The name is the row's one button; its ::after stretches over the whole row, so a click anywhere
            opens the editor while the price and the traits stay plain, readable text. */}
        <ButtonBase
          onClick={open}
          sx={{
            position: 'static', display: 'block', textAlign: 'left', font: 'inherit', fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.35,
            overflowWrap: 'anywhere', borderRadius: 1,
            '&::after': { content: '""', position: 'absolute', inset: 0 },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          }}
        >
          {item.title}
        </ButtonBase>
        {item.description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: '0.84rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={item.description}
          >
            {item.description}
          </Typography>
        )}
        {item.traits.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.625, mt: 0.75 }}>
            {item.traits.map((trait) => (
              <Chip
                key={trait.key}
                size="small"
                label={trait.label}
                sx={[softChipSx(trait.tone), { height: 24, fontSize: '0.72rem', fontWeight: 600, maxWidth: '100%', borderRadius: '7px' }]}
              />
            ))}
          </Box>
        )}
      </Box>
      <Box sx={{ gridColumn: 2, gridRow: 1, textAlign: 'right', alignSelf: 'start' }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {item.price.value}
        </Typography>
        {(item.price.unit || item.price.note) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: { xs: '8.5rem', sm: 'none' }, ml: 'auto' }}>
            {[item.price.unit, item.price.note].filter(Boolean).join(' · ')}
          </Typography>
        )}
      </Box>
      <Box sx={{ position: 'relative', zIndex: 1, gridColumn: { xs: 2, sm: 3 }, gridRow: { xs: 2, sm: 1 }, justifySelf: 'end', alignSelf: { xs: 'end', sm: 'center' } }}>
        <RowActionsMenu
          label={TEXTS.actionsOf(item.title)}
          items={[{ label: TEXTS.edit, onClick: open }, archiveItem]}
        />
      </Box>
    </Box>
  );
}
