// specs/site/site-outside-resource-booking.md §3.H rule 36 — the checklist stays open after a pick so several articles are ticked in one pass, shows each unit price under its name,
// greys an article the server refuses (not tickable, its reason under the name), refuses a tick past the limit with « N articles au plus. », and closes with « Fermer ».
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import ArticleChecklistPicker from '../ArticleChecklistPicker';

const GROUPS = [
  { category: 'Boissons', articles: [
    { articleRef: 'option:1', label: 'Jus de pomme', unitCents: 600, unitLabel: 'l’unité', sellable: true, reason: null },
    { articleRef: 'option:2', label: 'Champagne', unitCents: 5500, unitLabel: 'par personne', sellable: true, reason: null },
  ] },
  { category: 'Linge', articles: [
    { articleRef: 'option:3', label: 'Linge de toilette', unitCents: null, unitLabel: 'par personne', sellable: false, reason: 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.' },
  ] },
];

function Host({ search, max, initial = [], onClose = () => {} }) {
  const [selected, setSelected] = useState(initial);
  return (
    <ArticleChecklistPicker
      search={search}
      selected={selected}
      max={max}
      onClose={onClose}
      onToggle={(article, checked) => setSelected((prev) => (checked ? [...prev, article.articleRef] : prev.filter((r) => r !== article.articleRef)))}
    />
  );
}

const renderIt = (props = {}) => {
  const search = vi.fn().mockResolvedValue(GROUPS);
  return { search, ...render(<Host search={search} {...props} />) };
};

test('rule 36 — the list is grouped by category with the unit price under each name, and stays open: several articles are ticked in one pass, an untick removes', async () => {
  renderIt();
  const juice = await screen.findByRole('checkbox', { name: /Jus de pomme/ });
  expect(screen.getByText('Boissons')).toBeInTheDocument();
  expect(screen.getByText('6,00 € l’unité')).toBeInTheDocument();
  expect(screen.getByText('55,00 € par personne')).toBeInTheDocument();
  fireEvent.click(juice);
  fireEvent.click(screen.getByRole('checkbox', { name: /Champagne/ }));
  expect(screen.getByRole('checkbox', { name: /Jus de pomme/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Champagne/ })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: /Jus de pomme/ }));
  expect(screen.getByRole('checkbox', { name: /Jus de pomme/ })).not.toBeChecked();
});

test('rule 36 — a refused article is greyed, not tickable, with its reason; one already selected can still be unticked', async () => {
  const { unmount } = renderIt();
  const towels = await screen.findByRole('checkbox', { name: /Linge de toilette/ });
  expect(towels).toBeDisabled();
  expect(screen.getByText('Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.')).toBeInTheDocument();
  unmount();
  renderIt({ initial: ['option:3'] });
  const listed = await screen.findByRole('checkbox', { name: /Linge de toilette/ });
  expect(listed).toBeEnabled();
  fireEvent.click(listed);
  expect(listed).not.toBeChecked();
});

test('rule 36 — the thirteenth tick is refused with « 12 articles au plus. » in a status region that is always there, empty until then', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `option:${100 + i}`);
  renderIt({ initial: twelve });
  const juice = await screen.findByRole('checkbox', { name: /Jus de pomme/ });
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  fireEvent.click(juice);
  expect(screen.getByRole('status')).toHaveTextContent('12 articles au plus.');
  expect(juice).not.toBeChecked();
});

test('rule 36 — the search field asks the server again, « Aucun article ne correspond. » when nothing comes back, and « Fermer » closes', async () => {
  const onClose = vi.fn();
  const { search } = renderIt({ onClose });
  await screen.findByRole('checkbox', { name: /Champagne/ });
  search.mockResolvedValue([]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Chercher un article' }), { target: { value: 'zzz' } });
  await waitFor(() => expect(search).toHaveBeenLastCalledWith('zzz'));
  expect(await screen.findByText('Aucun article ne correspond.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(within(document.body).queryByText('Champagne')).toBeNull();
});
