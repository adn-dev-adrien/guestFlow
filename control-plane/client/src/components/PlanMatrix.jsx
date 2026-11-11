/**
 * PlanMatrix — the plan × plugin matrix of the catalogue (specs/control-plane-plans-and-access.md
 * rules 2–3, §6). One row per plugin and one column per plan on sm+; one card per plan on xs. The
 * server decides each cell (`own`, `inherited`, `none`) and what a click does; this only renders.
 *
 * Props:
 *   plans:  [{ code, name, priceLabel }]                                         (required)
 *   matrix: [{ pluginId, name, cells: [{ planCode, status, tooltip }] }]          (required)
 *   onToggle: (pluginId, planCode) => void                                        (required)
 */
import React from 'react';
import {
  Box, Card, CardContent, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';

function Cell({ cell, name, planName, onToggle }) {
  const own = cell.status === 'own';
  const inherited = cell.status === 'inherited';
  return (
    <Tooltip title={cell.tooltip}>
      <IconButton
        aria-label={`${name} — ${planName} : ${cell.tooltip}`}
        onClick={onToggle}
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2,
          border: 1,
          borderStyle: inherited ? 'dashed' : 'solid',
          borderColor: own ? 'primary.main' : 'divider',
          bgcolor: own ? 'primary.main' : inherited ? 'success.soft' : 'background.paper',
          color: own ? 'primary.contrastText' : 'success.main',
          '&:hover': { bgcolor: own ? 'primary.dark' : 'action.hover' },
        }}
      >
        {(own || inherited) && <CheckIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}

export default function PlanMatrix({ plans, matrix, onToggle }) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  if (isXs) {
    return (
      <Stack spacing={1.5}>
        {plans.map((plan, col) => (
          <Card key={plan.code}>
            <CardContent>
              <Typography variant="sectionHeader" component="h3">{plan.name}</Typography>
              <Typography variant="caption" color="text.secondary">{plan.priceLabel}</Typography>
              <Stack sx={{ mt: 1 }}>
                {matrix.map((row) => (
                  <Box key={row.pluginId} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{row.name}</Typography>
                    <Cell cell={row.cells[col]} name={row.name} planName={plan.name} onToggle={() => onToggle(row.pluginId, plan.code)} />
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    <Card>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Plugin</TableCell>
            {plans.map((p) => (
              <TableCell key={p.code} align="center">
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{p.name}</Typography>
                <Typography variant="caption" color="text.secondary">{p.priceLabel}</Typography>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {matrix.map((row) => (
            <TableRow key={row.pluginId}>
              <TableCell>{row.name}</TableCell>
              {row.cells.map((cell, col) => (
                <TableCell key={cell.planCode} align="center">
                  <Cell cell={cell} name={row.name} planName={plans[col].name} onToggle={() => onToggle(row.pluginId, cell.planCode)} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
