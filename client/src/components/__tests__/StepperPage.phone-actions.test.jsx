// specs/plugins-phase-p-productisation.md rule 44 — the onboarding assistant follows the SAS rule on a
// phone (UI/UX review 2026-10-18, decision 5): the primary action is filled and comes last, at the
// bottom under the thumb; « Précédent » and « Plus tard » come before it, neutral.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import StepperPage from '../StepperPage';

test('rule 44: the primary action is the last of the actions, filled; the others are neutral', () => {
  render(
    <StepperPage step={2} total={4} title="Logements" onNext={() => {}} onBack={() => {}} onLater={() => {}}>
      <p>Contenu</p>
    </StepperPage>,
  );
  const buttons = within(screen.getByTestId('stepper-actions')).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual(['Plus tard', 'Précédent', 'Suivant']);
  expect(buttons[2]).toHaveClass('MuiButton-contained');
  expect(buttons[0]).toHaveClass('MuiButton-colorInherit');
  expect(buttons[1]).toHaveClass('MuiButton-colorInherit');
});
