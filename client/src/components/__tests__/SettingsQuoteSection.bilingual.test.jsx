// SettingsQuoteSection — bilingual footer (FR + EN) — see specs/devis-english-language.md §6.4.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import SettingsQuoteSection from '../SettingsQuoteSection';

function setup(props = {}) {
  const onChange = props.onChange || vi.fn();
  const utils = render(
    <SettingsQuoteSection
      values={props.values || { footerText: '', footerTextEn: '', validityDays: 30 }}
      errors={props.errors || {}}
      onChange={onChange}
      disabled={!!props.disabled}
    />
  );
  return { ...utils, onChange };
}

describe('SettingsQuoteSection — bilingual footer', () => {
  test('renders both FR and EN footer fields', () => {
    setup();
    expect(screen.getByLabelText('Pied de page du devis (français)')).toBeInTheDocument();
    expect(screen.getByLabelText('Pied de page du devis (anglais)')).toBeInTheDocument();
  });

  test('FR field reflects values.footerText', () => {
    setup({ values: { footerText: 'Merci de votre confiance.', footerTextEn: '', validityDays: 30 } });
    const fr = screen.getByLabelText('Pied de page du devis (français)');
    expect(fr).toHaveValue('Merci de votre confiance.');
  });

  test('EN field reflects values.footerTextEn', () => {
    setup({ values: { footerText: '', footerTextEn: 'Thank you for choosing us.', validityDays: 30 } });
    const en = screen.getByLabelText('Pied de page du devis (anglais)');
    expect(en).toHaveValue('Thank you for choosing us.');
  });

  test('typing in FR field calls onChange with footerText key', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const fr = screen.getByLabelText('Pied de page du devis (français)');
    await user.type(fr, 'A');
    expect(onChange).toHaveBeenCalledWith('footerText', 'A');
  });

  test('typing in EN field calls onChange with footerTextEn key', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const en = screen.getByLabelText('Pied de page du devis (anglais)');
    await user.type(en, 'B');
    expect(onChange).toHaveBeenCalledWith('footerTextEn', 'B');
  });

  test('both fields are disabled when the disabled prop is true', () => {
    setup({ disabled: true });
    expect(screen.getByLabelText('Pied de page du devis (français)')).toBeDisabled();
    expect(screen.getByLabelText('Pied de page du devis (anglais)')).toBeDisabled();
  });

  test('each field carries its own helper text — operator can tell them apart', () => {
    setup();
    // French helper hints at the FR fallback default; English helper at the EN one.
    expect(screen.getByText(/message par défaut/)).toBeInTheDocument();      // FR
    expect(screen.getByText(/message anglais par défaut/)).toBeInTheDocument(); // EN
  });
});
