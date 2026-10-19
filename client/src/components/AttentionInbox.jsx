/**
 * AttentionInbox — the home's « À traiter (n) » box, and `AttentionPinned`, the subjects that stay
 * unfolded above the day (specs/shell-and-home-day-first.md rules 3, 10–12).
 *
 * Props (both): the server's subjects, already counted and ordered (GET /api/dashboard/attention).
 *   AttentionInbox   { items: Subject[], total: number }
 *   AttentionPinned  { subjects: Subject[] }
 *   Subject = { key, severity, count, title, detail }
 *
 * A subject's content is the component registered for its key — a core one (`attentionSubjects.js`)
 * or a plugin's contribution to `dashboard.alerts` / `dashboard.alerts.urgent` with the same key. It
 * receives `attention` (the subject) and draws itself with `AttentionCard`. Content loads when its row
 * unfolds; an unknown key still shows the server's detail. The only state kept here is which rows
 * are open.
 */
import React, { Suspense, useId, useMemo, useState } from 'react';
import { Box, ButtonBase, Collapse, Typography, useMediaQuery } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AttentionCard, { AttentionLayoutContext, CountChip, SeverityGlyph } from './AttentionCard';
import { CORE_ATTENTION_SUBJECTS } from './attentionSubjects';
import { useSlot } from '../plugins/sdk/useSlot';

function useSubjectComponents() {
  const urgent = useSlot('dashboard.alerts.urgent');
  const others = useSlot('dashboard.alerts');
  return useMemo(() => {
    const map = { ...CORE_ATTENTION_SUBJECTS };
    [...urgent, ...others].forEach(({ key, Component }) => { map[key] = Component; });
    return map;
  }, [urgent, others]);
}

function SubjectContent({ subject, components }) {
  const Component = components[subject.key];
  if (!Component) return <AttentionCard attention={subject} />;
  return (
    <Suspense fallback={null}>
      <Component attention={subject} />
    </Suspense>
  );
}

export function AttentionPinned({ subjects }) {
  const components = useSubjectComponents();
  if (!subjects || subjects.length === 0) return null;
  return (
    <Box data-testid="attention-pinned">
      {subjects.map((subject) => <SubjectContent key={subject.key} subject={subject} components={components} />)}
    </Box>
  );
}

function InboxRow({ subject, open, onToggle, first, components, reducedMotion }) {
  const bodyId = useId();
  return (
    <Box sx={{ borderTop: first ? 0 : '1px solid', borderColor: 'divider' }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        data-testid={`attention-row-${subject.key}`}
        sx={{
          width: '100%', minHeight: 48, py: 0.75, px: 0.5, gap: 1.5,
          justifyContent: 'flex-start', textAlign: 'left', borderRadius: 1,
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          '@media (hover: hover) and (pointer: fine)': { '&:hover': { bgcolor: 'action.hover' } },
        }}
      >
        <SeverityGlyph severity={subject.severity} />
        <Typography component="span" sx={{ flex: 1, minWidth: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>
          {subject.title}
        </Typography>
        <CountChip severity={subject.severity} count={subject.count} />
        <ExpandMoreIcon
          aria-hidden="true"
          sx={{
            color: 'text.secondary', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: reducedMotion ? 'none' : 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
          }}
        />
      </ButtonBase>
      <Collapse in={open} timeout={reducedMotion ? 0 : 'auto'} unmountOnExit>
        <Box id={bodyId} role="region" aria-label={subject.title} sx={{ pl: { xs: 0.5, sm: 6 }, pr: 0.5, pb: 1.5 }}>
          <AttentionLayoutContext.Provider value="embedded">
            <SubjectContent subject={subject} components={components} />
          </AttentionLayoutContext.Provider>
        </Box>
      </Collapse>
    </Box>
  );
}

export default function AttentionInbox({ items, total }) {
  const components = useSubjectComponents();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const headingId = useId();
  const [open, setOpen] = useState({});
  const list = items || [];
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="attention-inbox"
      sx={{ mb: 3, p: { xs: 1.5, sm: 2 }, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: list.length ? 0.5 : 0 }}>
        <Typography id={headingId} variant="sectionHeader">À traiter</Typography>
        <Typography component="span" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="attention-total">
          {total || 0}
        </Typography>
      </Box>
      {list.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>Rien à traiter.</Typography>
      ) : list.map((subject, index) => (
        <InboxRow
          key={subject.key}
          subject={subject}
          first={index === 0}
          open={Boolean(open[subject.key])}
          onToggle={() => setOpen((prev) => ({ ...prev, [subject.key]: !prev[subject.key] }))}
          components={components}
          reducedMotion={reducedMotion}
        />
      ))}
    </Box>
  );
}
