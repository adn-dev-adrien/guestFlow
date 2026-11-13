/**
 * ClientPickerField — pick a client from a server-ordered, grouped list, searchable by typing
 * (specs/resource-booking-client-picker.md §3, §6).
 *
 * The options come from `GET /api/clients/picker` as they are: the order, the groups, the line under
 * each name and the searchable text are the server's. This component only renders them and keeps the
 * options whose `searchText` contains every typed word.
 *
 * Props:
 *   options:   Array<{ id, firstName, lastName, groupLabel, detail, searchText }>
 *   value:     { id, firstName, lastName } | null   the selected client (may be a stub not in `options`)
 *   onChange:  (client | null) => void
 *   disabled?: boolean
 *   label?:    string   default « Client * »
 */
import React from 'react';
import { Autocomplete, Box, InputAdornment, ListSubheader, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { matchesSearch } from '../utils/searchMatch';

const fullName = (client) => (client ? `${client.firstName || ''} ${client.lastName || ''}`.trim() : '');
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

export default function ClientPickerField({ options, value, onChange, disabled = false, label = 'Client *' }) {
  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, next) => onChange(next)}
      disabled={disabled}
      groupBy={(option) => option.groupLabel || ''}
      getOptionLabel={fullName}
      isOptionEqualToValue={(option, selected) => option.id === selected?.id}
      filterOptions={(list, { inputValue }) => list.filter((option) => matchesSearch(option.searchText, inputValue))}
      noOptionsText="Aucun client trouvé"
      renderGroup={(params) => (
        <li key={params.key}>
          <ListSubheader component="div" sx={{ lineHeight: '32px', fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary' }}>
            {params.group} · {React.Children.count(params.children)}
          </ListSubheader>
          <Box component="ul" sx={{ p: 0 }}>{params.children}</Box>
        </li>
      )}
      renderOption={(props, option) => {
        // React 19 + MUI v9: `key` travels in `props` and must not be spread.
        const { key, ...liProps } = props;
        return (
          <Box
            component="li"
            key={key}
            {...liProps}
            sx={{ display: 'block !important', minHeight: 48, py: 0.75 }}
          >
            <Typography variant="body2" component="div" sx={{ fontWeight: 500, ...ellipsis }}>
              {fullName(option)}
            </Typography>
            {option.detail && (
              <Typography variant="caption" component="div" color="text.secondary" sx={ellipsis}>
                {option.detail}
              </Typography>
            )}
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size="small"
          placeholder="Rechercher un client"
          slotProps={{
            ...params.slotProps,
            input: {
              ...(params.slotProps && params.slotProps.input),
              startAdornment: (
                <>
                  <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>
                  {params.slotProps?.input?.startAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
