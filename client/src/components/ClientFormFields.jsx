import React, { useState } from 'react';
import { Box, TextField, Autocomplete, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import FormRow from './FormRow';
import DroppableTextField from './DroppableTextField';
import api from '../api';

const PARSE_ERROR_HELPER = 'Analyse impossible';

/**
 * Shared client form fields (Clients, Réservation, Modèles d'email).
 *
 * Address, email and phone accept a raw payload — dropped from a web page, or typed in one line for
 * the address — and the SERVER turns it into clean field values (specs/client-contact-smart-input.md).
 * Nothing is parsed here: the component only ships the raw string and renders what comes back.
 */
export default function ClientFormFields({ form, setForm, cityOptions, emailError = false, phoneError = false, autoFocusEmail = false }) {
  // Free-text address draft. `null` means "show the four fields recomposed" — the draft only exists
  // while the user is editing the block, and is dropped again as soon as the server has parsed it.
  const [addressDraft, setAddressDraft] = useState(null);
  const [busyField, setBusyField] = useState(null);
  const [parseFailed, setParseFailed] = useState({});

  const composedAddress = [form.streetNumber, form.street, form.postalCode, form.city].filter(Boolean).join(' ');
  const addressValue = addressDraft ?? composedAddress;

  const parseContact = async (field, raw, apply) => {
    setBusyField(field);
    setParseFailed((prev) => ({ ...prev, [field]: false }));
    try {
      apply(await api.parseClientContact({ [field]: raw }));
    } catch {
      setParseFailed((prev) => ({ ...prev, [field]: true }));
    } finally {
      setBusyField(null);
    }
  };

  const parseAddress = (raw) => parseContact('address', raw, (parsed) => {
    const address = parsed.address || {};
    setForm((prev) => ({
      ...prev,
      streetNumber: address.streetNumber || '',
      street: address.street || '',
      postalCode: address.postalCode || '',
      city: address.city || '',
    }));
    setAddressDraft(null);
  });

  // Leaving the block re-parses it, but only when its content actually changed — a plain focus/blur
  // must not cost a round-trip.
  const handleAddressBlur = () => {
    if (addressDraft === null) return;
    if (addressDraft.trim() === composedAddress.trim()) {
      setAddressDraft(null);
      return;
    }
    parseAddress(addressDraft);
  };

  const parseInto = (field) => (raw) => parseContact(field, raw, (parsed) => {
    setForm((prev) => ({ ...prev, [field]: parsed[field] ?? '' }));
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
      <FormRow>
        <TextField label="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} fullWidth required />
        <TextField label="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} fullWidth required />
      </FormRow>
      <DroppableTextField
        label="Adresse (saisie libre)"
        value={addressValue}
        onChange={(e) => setAddressDraft(e.target.value)}
        onBlur={handleAddressBlur}
        onDropText={(raw) => { setAddressDraft(raw); parseAddress(raw); }}
        disabled={busyField === 'address'}
        error={Boolean(parseFailed.address)}
        helperText={parseFailed.address ? PARSE_ERROR_HELPER : "Dépose ou saisis l'adresse en une ligne : n° rue CP ville"}
        fullWidth
      />
      <FormRow>
        <TextField
          label="N°"
          value={form.streetNumber}
          onChange={(e) => setForm({ ...form, streetNumber: e.target.value })}
          sx={{ width: { xs: '100%', sm: 120 } }}
        />
        <TextField
          label="Rue / voie"
          value={form.street}
          onChange={(e) => setForm({ ...form, street: e.target.value })}
          fullWidth
        />
      </FormRow>
      <FormRow>
        <TextField
          label="Code postal"
          value={form.postalCode}
          onChange={(e) => setForm({ ...form, postalCode: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })}
          sx={{ width: { xs: '100%', sm: 170 } }}
        />
        <Autocomplete
          freeSolo
          options={cityOptions}
          value={form.city || ''}
          onInputChange={(_, val) => setForm({ ...form, city: val || '' })}
          renderInput={(params) => <TextField {...params} label="Ville" fullWidth />}
          fullWidth
        />
      </FormRow>
      <DroppableTextField
        label="Email"
        type="email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        onDropText={parseInto('email')}
        disabled={busyField === 'email'}
        fullWidth
        autoFocus={autoFocusEmail}
        error={emailError || Boolean(parseFailed.email)}
        helperText={parseFailed.email ? PARSE_ERROR_HELPER : (emailError ? 'Format email invalide' : '')}
      />
      <DroppableTextField
        label="Téléphone"
        value={form.phone || ''}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        onDropText={parseInto('phone')}
        disabled={busyField === 'phone'}
        fullWidth
        error={phoneError || Boolean(parseFailed.phone)}
        helperText={parseFailed.phone ? PARSE_ERROR_HELPER : (phoneError ? 'Format téléphone invalide' : '')}
      />
      {/* Langue des emails (specs/email-client-language-and-fiche-polish.md): toutes les communications
          de ce client sont rédigées dans cette langue. */}
      <FormControl fullWidth>
        <InputLabel>Langue des emails</InputLabel>
        <Select
          value={form.emailLanguage === 'en' ? 'en' : 'fr'}
          label="Langue des emails"
          onChange={(e) => setForm({ ...form, emailLanguage: e.target.value })}
        >
          <MenuItem value="fr">Français</MenuItem>
          <MenuItem value="en">English</MenuItem>
        </Select>
      </FormControl>
      <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth multiline rows={3} />
    </Box>
  );
}
