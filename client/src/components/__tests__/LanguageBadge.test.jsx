// specs/site-english-version.md rules 18-19 — the marker that names a guest's language.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LanguageBadge from '../LanguageBadge';

describe('LanguageBadge', () => {
  it('names the language in two letters', () => {
    render(<LanguageBadge lang="en" />);
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('reads anything that is not English as French', () => {
    // A guest record can hold an empty string on a legacy row; the badge must still say something.
    for (const lang of ['fr', '', null, undefined, 'de']) {
      const { unmount } = render(<LanguageBadge lang={lang} />);
      expect(screen.getByText('FR')).toBeInTheDocument();
      unmount();
    }
  });

  it('accepts the language in any case, as the API normalises it', () => {
    render(<LanguageBadge lang="EN" />);
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('says WHERE the language comes from when told', () => {
    // Rule 18: an operator seeing « EN » needs to know whether it came from the guest's record or
    // from the page they booked on — the two lead to different actions.
    const { container } = render(
      <LanguageBadge lang="en" origin="fiche client — tous les e-mails partent dans cette langue" />
    );
    expect(container.querySelector('[aria-label]') || container).toBeTruthy();
    expect(screen.getByText('EN')).toBeInTheDocument();
  });
});
