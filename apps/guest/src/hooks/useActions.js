/**
 * What a tile, a highlight or a booklet button does (rules 11bis, 12-15, 18): navigate inside the app, open
 * the gate app or Soliomap, show the wifi or the contacts. One place, so the home, the booklet and the
 * tiles agree.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from './useSession';

export function useActions() {
  const navigate = useNavigate();
  const { lodging, me } = useSession();
  // Rule 15 — Soliomap's address and the « Intégrer dans l'app » switch, as `/lodging` gives them; without them, the
  // suggestion's own link tells where Soliomap lives, opened outside the app.
  const fromSuggestion = me && me.suggestion && me.suggestion.url ? { url: new URL(me.suggestion.url).origin, embed: false } : null;
  const soliomap = (lodging && lodging.soliomap) || fromSuggestion;

  /** Rule 15 — in the app's frame when the studio allows it, else a new tab. */
  const openSoliomap = useCallback((url) => {
    const target = url || (soliomap && soliomap.url);
    if (!target) return;
    if (soliomap && soliomap.embed) navigate(`/activites?url=${encodeURIComponent(target)}`);
    else window.open(target, '_blank', 'noopener');
  }, [navigate, soliomap]);

  /** Rule 18 `button` targets that stay in the app. */
  const followTarget = useCallback((target) => {
    if (!target) return;
    if (target.kind === 'page') navigate(`/livret/${encodeURIComponent(target.slug)}`);
    else if (target.kind === 'item') navigate(`/boutique?article=${encodeURIComponent(`${target.itemKind}:${target.itemId}`)}`);
    else if (target.kind === 'url') window.open(target.href, '_blank', 'noopener');
  }, [navigate]);

  return { openSoliomap, followTarget, soliomapEmbedded: Boolean(soliomap && soliomap.embed) };
}
