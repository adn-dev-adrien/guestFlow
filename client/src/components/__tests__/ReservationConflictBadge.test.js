import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReservationConflictBadge from '../ReservationConflictBadge';

describe('ReservationConflictBadge', () => {
  it('renders the warning chip when bookingConflictAt is set', () => {
    render(<ReservationConflictBadge conflictAt="2026-06-30T10:00:00Z" />);
    expect(screen.getByText('Conflit de dates')).toBeInTheDocument();
  });

  it('renders nothing when there is no conflict', () => {
    const { container } = render(<ReservationConflictBadge conflictAt={null} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<ReservationConflictBadge />);
    expect(c2).toBeEmptyDOMElement();
  });
});
