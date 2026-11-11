/**
 * FoldedDayList — a titled list that takes one line when it is empty (specs/dashboard-planning-scroll.md
 * rule 4): the title and a muted sentence side by side, no table, no card, nothing to unfold. With
 * items it renders its children under the title.
 *
 * Props:
 *   title      string      the section title
 *   empty      boolean     true when the list has nothing to show
 *   emptyText  string      the muted line (« Aucun départ aujourd'hui »)
 *   children   ReactNode   the list, rendered when not empty
 *   after?     ReactNode   rendered below the folded line only (e.g. what comes next instead)
 */
import React from 'react';
import { Box, Typography } from '@mui/material';

export default function FoldedDayList({ title, empty, emptyText, children, after }) {
  if (!empty) {
    return (
      <Box>
        <Typography variant="sectionHeader" gutterBottom>{title}</Typography>
        {children}
      </Box>
    );
  }
  return (
    <Box>
      <Box
        data-testid="folded-day-list"
        sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.25,
          minHeight: 48, px: 2, py: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 2,
        }}
      >
        <Typography variant="sectionHeader">{title}</Typography>
        <Typography variant="body2" color="text.secondary">{emptyText}</Typography>
      </Box>
      {after}
    </Box>
  );
}
