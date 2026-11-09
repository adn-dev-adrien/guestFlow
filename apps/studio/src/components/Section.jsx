/**
 * Section — one card of a studio screen: a serif heading, an optional sentence under it, an optional action on the
 * right (« Ajouter », a switch), and its content. The « Maison » card: paper, divider border, radius from the theme.
 *
 * Props: `title`, `description`, `action` (ReactNode), `children`, `id`.
 */
import { Box, Paper, Typography } from '@mui/material';

export default function Section({ title, description, action, children, id }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Paper variant="outlined" component="section" aria-labelledby={headingId} sx={{ p: { xs: 2, sm: 2.5 }, display: 'grid', gap: 2 }}>
      {title || action ? (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            {title ? <Typography id={headingId} component="h2" variant="sectionHeader">{title}</Typography> : null}
            {description ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{description}</Typography> : null}
          </Box>
          {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
        </Box>
      ) : null}
      {children}
    </Paper>
  );
}
