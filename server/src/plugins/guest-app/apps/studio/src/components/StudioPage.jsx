/**
 * StudioPage — one studio screen: its `PageActionBar`, its content, and the phone preview beside it from 1200 px,
 * under it below (the boards' tablet layout).
 *
 * Props: `bar` (a PageActionBar), `preview` (a PhonePreview, optional), `children`.
 */
import { Box } from '@mui/material';

export default function StudioPage({ bar, preview, children }) {
  return (
    <Box>
      {bar}
      <Box
        sx={{
          display: 'grid',
          gap: 3,
          p: { xs: 1.5, sm: 3 },
          gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: preview ? 'minmax(0,1fr) 340px' : 'minmax(0,1fr)' },
          alignItems: 'start',
          maxWidth: 1320,
        }}
      >
        <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>{children}</Box>
        {preview ? <Box sx={{ position: { lg: 'sticky' }, top: { lg: 140 } }}>{preview}</Box> : null}
      </Box>
    </Box>
  );
}
