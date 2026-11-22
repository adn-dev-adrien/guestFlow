// specs/gift-voucher-campaigns.md rule 47 — the image upload field: a file is dropped or picked, previewed, removable; the server's refusal is shown under it.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImageDropField from '../ImageDropField';

const file = (name = 'recto.jpg') => new File(['x'], name, { type: 'image/jpeg' });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

test('shows the invitation and the format hint while empty', () => {
  render(<ImageDropField value={null} onChange={vi.fn()} label="Déposer une image" helperText="JPEG ou PNG" />);
  expect(screen.getByText('Déposer une image')).toBeInTheDocument();
  expect(screen.getByText('JPEG ou PNG')).toBeInTheDocument();
});

test('a file picked by a tap is handed to the parent', async () => {
  const onChange = vi.fn();
  render(<ImageDropField value={null} onChange={onChange} label="Déposer une image" />);
  await userEvent.upload(screen.getByTestId('image-drop-input'), file());
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'recto.jpg' }));
});

test('a file dropped on the zone is handed to the parent', () => {
  const onChange = vi.fn();
  render(<ImageDropField value={null} onChange={onChange} label="Déposer une image" />);
  fireEvent.drop(screen.getByRole('button', { name: 'Déposer une image' }), { dataTransfer: { files: [file('depose.png')] } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'depose.png' }));
});

test('the chosen file is previewed and can be removed', async () => {
  const onChange = vi.fn();
  const { container } = render(<ImageDropField value={file()} onChange={onChange} label="Déposer une image" />);
  expect(container.querySelector('img')).toHaveAttribute('src', 'blob:preview');
  expect(screen.getByText('recto.jpg')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer l’image' }));
  expect(onChange).toHaveBeenCalledWith(null);
});

test('the stored image is previewed while no file is chosen, and the server refusal replaces the hint', () => {
  const { container } = render(
    <ImageDropField value={null} onChange={vi.fn()} currentUrl="/api/x.jpg" label="Remplacer" helperText="JPEG ou PNG" error="Image trop petite : 800 × 1000 px." />,
  );
  expect(container.querySelector('img')).toHaveAttribute('src', '/api/x.jpg');
  expect(screen.getByRole('alert')).toHaveTextContent('Image trop petite : 800 × 1000 px.');
  expect(screen.queryByText('JPEG ou PNG')).not.toBeInTheDocument();
});

test('a disabled field takes no file', () => {
  const onChange = vi.fn();
  render(<ImageDropField value={null} onChange={onChange} label="Déposer une image" disabled />);
  fireEvent.drop(screen.getByRole('button', { name: 'Déposer une image' }), { dataTransfer: { files: [file()] } });
  expect(onChange).not.toHaveBeenCalled();
});
