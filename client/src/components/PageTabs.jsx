/**
 * PageTabs — the one way to draw tabs in GuestFlow (specs/ds-tabs.md).
 *
 * The look (sentence case, 44 px target, 2 px fir-green indicator) lives in the theme's
 * MuiTabs/MuiTab overrides; this component owns the structure and the behaviour, so no page
 * has to remember the right `sx` again.
 *
 * Props:
 *   value      any                      the selected tab value
 *   onChange   (next) => void           called with the newly selected value
 *   items      [{ value, label, badge? }]  badge = a small node rendered after the label
 *                                          (e.g. the « modifié » dot of a property tab)
 *   variant?   'bar' | 'card'           'bar' (default) sits in PageActionBar's `tabs` slot —
 *                                       no border of its own, the bar closes the block.
 *                                       'card' sits at the top of a Card/Dialog content —
 *                                       bottom divider + standard bottom rhythm.
 *   ariaLabel? string                   accessible name of the tab list (French)
 *
 * Overflow always scrolls (never wraps, never truncates): long strips scroll inside their
 * container with mobile scroll buttons.
 */
import React from 'react';
import { Box, Tab, Tabs } from '@mui/material';

const VARIANT_SX = {
  bar: {},
  card: { mb: 2, borderBottom: 1, borderColor: 'divider' },
};

export default function PageTabs({ value, onChange, items, variant = 'bar', ariaLabel }) {
  return (
    <Tabs
      value={value}
      onChange={(_, next) => onChange(next)}
      variant="scrollable"
      allowScrollButtonsMobile
      aria-label={ariaLabel}
      sx={VARIANT_SX[variant] || VARIANT_SX.bar}
    >
      {items.map((item) => (
        <Tab
          key={item.value}
          value={item.value}
          label={item.badge ? (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              {item.label}
              {item.badge}
            </Box>
          ) : item.label}
        />
      ))}
    </Tabs>
  );
}
