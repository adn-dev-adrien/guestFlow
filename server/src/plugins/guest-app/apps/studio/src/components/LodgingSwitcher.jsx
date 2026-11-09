/**
 * LodgingSwitcher — the studio opens on the lodgings (rule 48): every non-archived GuestFlow property, its live
 * GuestFlow name, in GuestFlow's order. A lodging left out of the app stays listed, greyed « Hors application »,
 * so it can be switched on from its Infos du logement.
 *
 * Props: `lodgings` (`GET /studio/lodgings`), `currentId`, `onSelect(propertyId)`.
 */
import {
  List, ListItemButton, ListItemIcon, ListItemText, ListSubheader,
} from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';

export default function LodgingSwitcher({ lodgings, currentId, onSelect }) {
  return (
    <List dense aria-label="Logements" subheader={<ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px' }}>Logements · GuestFlow</ListSubheader>}>
      {lodgings.map((l) => (
        <ListItemButton
          key={l.propertyId}
          selected={l.propertyId === currentId}
          aria-current={l.propertyId === currentId ? 'page' : undefined}
          onClick={() => onSelect(l.propertyId)}
          sx={{ borderRadius: 2, minHeight: 44, opacity: l.enabled ? 1 : 0.62 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}><HomeOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary={l.name}
            secondary={l.stateLabel}
            slotProps={{ primary: { sx: { fontWeight: l.propertyId === currentId ? 600 : 500 } }, secondary: { sx: { fontSize: 12 } } }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}
