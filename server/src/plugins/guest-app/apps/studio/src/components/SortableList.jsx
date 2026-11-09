/**
 * SortableList — a list the operator reorders (modules, pages, blocks): drag by the handle, the row glued to the
 * finger from where it was grabbed while the others make room, or the « Monter » / « Descendre » buttons — the
 * keyboard and screen-reader path. Nothing is moved until the drop; `onMove(from, to)` then decides.
 *
 * Props:
 *   items        array
 *   getKey       (item) => string
 *   onMove       (from, to) => void
 *   renderItem   (item, { index, handle, up, down }) => ReactNode — `handle` is the drag handle element,
 *                `up` / `down` the two buttons (null at the ends' disabled state is drawn by the buttons)
 *   label        (item) => string — the item's name in the buttons' labels (« Monter Portail »)
 *   disabled     boolean
 */
import { useRef, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

const reduced = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function moveItem(list, from, to) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function SortableList({ items, getKey, onMove, renderItem, label, disabled = false }) {
  const rows = useRef([]);
  const [drag, setDrag] = useState(null);

  const start = (index) => (event) => {
    if (disabled || event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rects = rows.current.slice(0, items.length).map((el) => el.getBoundingClientRect());
    setDrag({ from: index, to: index, startY: event.clientY, dy: 0, rects });
  };
  const move = (event) => {
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    const { rects, from } = drag;
    const center = rects[from].top + rects[from].height / 2 + dy;
    let to = 0;
    rects.forEach((r, i) => { if (i !== from && center > r.top + r.height / 2) to += 1; });
    setDrag({ ...drag, dy, to });
  };
  const end = () => {
    if (!drag) return;
    const { from, to } = drag;
    setDrag(null);
    if (from !== to) onMove(from, to);
  };

  const offsetOf = (index) => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    const h = drag.rects[drag.from].height + 8;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -h;
    if (drag.from > drag.to && index < drag.from && index >= drag.to) return h;
    return 0;
  };

  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
      {items.map((item, index) => {
        const name = label(item);
        const dragging = drag && drag.from === index;
        const handle = (
          <Box
            component="span"
            role="presentation"
            aria-hidden="true"
            onPointerDown={start(index)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            title={`Déplacer ${name}`}
            sx={{
              display: 'grid', placeItems: 'center', width: 32, height: 44, flexShrink: 0, color: 'text.secondary',
              cursor: disabled ? 'default' : (dragging ? 'grabbing' : 'grab'), touchAction: 'none',
            }}
          >
            <DragIndicatorIcon fontSize="small" />
          </Box>
        );
        const up = (
          <Tooltip title="Monter"><span>
            <IconButton aria-label={`Monter ${name}`} disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)} sx={{ width: 44, height: 44, border: 1, borderColor: 'divider' }}>
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span></Tooltip>
        );
        const down = (
          <Tooltip title="Descendre"><span>
            <IconButton aria-label={`Descendre ${name}`} disabled={disabled || index === items.length - 1} onClick={() => onMove(index, index + 1)} sx={{ width: 44, height: 44, border: 1, borderColor: 'divider' }}>
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </span></Tooltip>
        );
        return (
          <Box
            component="li"
            key={getKey(item)}
            ref={(el) => { rows.current[index] = el; }}
            sx={{
              position: 'relative',
              zIndex: dragging ? 2 : 1,
              transform: `translateY(${offsetOf(index)}px)`,
              transition: dragging || !drag || reduced() ? 'none' : 'transform 160ms cubic-bezier(.2,.8,.2,1)',
              boxShadow: dragging ? '0 12px 28px rgba(22,28,22,.18)' : 'none',
              borderRadius: 2,
              bgcolor: dragging ? 'background.paper' : undefined,
            }}
          >
            {renderItem(item, { index, handle, up, down })}
          </Box>
        );
      })}
    </Box>
  );
}
