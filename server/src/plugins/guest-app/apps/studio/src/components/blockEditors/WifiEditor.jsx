/** `wifi` (rules 11ter, 18): nothing to type here — the block reads the lodging's network and password. */
import { Typography } from '@mui/material';

export default function WifiEditor() {
  return (
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      Le réseau, le mot de passe et la précision viennent des Infos du logement : les changer là change aussi ce bloc. Sans wifi, le livret affiche « Pas de wifi ».
    </Typography>
  );
}
