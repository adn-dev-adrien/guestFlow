// Shared wrapper for the console's component tests: GuestFlow's theme, the dialog provider and a
// router at the given path.
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@gf/theme';
import DialogProvider from '@gf/components/DialogProvider';

export function renderAt(ui, { path = '/', route = '/' } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <DialogProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </DialogProvider>
    </ThemeProvider>,
  );
}

export function setWidth(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
  };
}
