// specs/emails/guest-email-branding.md rule 4bis — « Logo sur fond sombre »: an optional second upload beside the logo,
// same control, its own handlers.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import SettingsCompanySection from '../SettingsCompanySection';

test('rule 4bis: the night logo has its own picker and says what happens without it', () => {
  render(<SettingsCompanySection values={{}} onChange={() => {}} />);
  expect(screen.getByText('Logo sur fond sombre')).toBeInTheDocument();
  expect(screen.getByText('Aucun logo sombre')).toBeInTheDocument();
  expect(screen.getByText(/sans lui, le logo s’affiche sur une pastille blanche/)).toBeInTheDocument();
});

test('rule 4bis: a picked file goes to the night-logo handler, never to the day-logo one; a stored one shows with its delete button', async () => {
  const onUploadLogo = vi.fn();
  const onUploadLogoDark = vi.fn().mockResolvedValue({});
  const { container } = render(
    <SettingsCompanySection values={{}} onChange={() => {}} onUploadLogo={onUploadLogo} onUploadLogoDark={onUploadLogoDark} />,
  );
  const inputs = container.querySelectorAll('input[type="file"]');
  expect(inputs).toHaveLength(2);
  const file = new File(['x'], 'sombre.png', { type: 'image/png' });
  fireEvent.change(inputs[1], { target: { files: [file] } });
  await waitFor(() => expect(onUploadLogoDark).toHaveBeenCalledWith(file));
  expect(onUploadLogo).not.toHaveBeenCalled();
});

test('rule 4bis: a stored night logo is previewed with its version and can be removed', async () => {
  const onDeleteLogoDark = vi.fn().mockResolvedValue({});
  render(
    <SettingsCompanySection
      values={{ logoDarkPath: '/uploads/company-logo-dark.png' }}
      onChange={() => {}}
      onDeleteLogoDark={onDeleteLogoDark}
      logoDarkVersion="42"
    />,
  );
  expect(document.querySelector('img[src="/uploads/company-logo-dark.png?v=42"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer le logo' }));
  await waitFor(() => expect(onDeleteLogoDark).toHaveBeenCalled());
});
