/**
 * The booklet (rules 16-21, §6.6): the index with its search, and a page — its cover with the title inside,
 * the blocks at 24 px rhythm, « Page suivante » at the bottom. From 900 px the two are side by side (rule 51).
 *
 * Rule 21 — the first read of the index also reads every page once, in the background, so the service worker
 * holds the whole booklet (texts and mobile-size photos) for the domain's weak coverage.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import AppBar from '../components/AppBar';
import PhotoCard from '../components/PhotoCard';
import Photo from '../components/Photo';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import Skeleton from '../components/Skeleton';
import { BlockList } from '../components/BlockRenderer';
import { useToast } from '../components/Toast';
import { useSession } from '../hooks/useSession';
import { useLoad } from '../hooks/useLoad';
import { useLayout } from '../hooks/useLayout';
import { useActions } from '../hooks/useActions';
import { api } from '../services/api';
import { useT } from '../i18n';
import { copyText } from '../utils/format';

const warmed = new Set();

/** Rule 21 — read every page once so the service worker caches the booklet, photos at mobile size included. */
function warmBooklet(index, lang) {
  const key = `${lang}:${index.version}`;
  if (warmed.has(key) || typeof navigator === 'undefined' || navigator.onLine === false) return;
  warmed.add(key);
  index.pages.forEach((p, i) => {
    setTimeout(() => {
      api.bookletPage(p.slug).then((page) => {
        const urls = [page.cover, ...(page.blocks || []).flatMap((b) => [b.image, ...(b.items || []).map((x) => x.image), ...(b.steps || []).map((x) => x.image)])]
          .filter(Boolean).map((m) => (m.sizes && (m.sizes[800] || m.sizes[400])) || m.url);
        urls.forEach((url) => { const img = new Image(); img.src = url; });
      }).catch(() => {});
    }, 400 * (i + 1));
  });
}

function useSearch(query, lang) {
  const [state, setState] = useState({ results: null, loading: false });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setState({ results: null, loading: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      api.bookletSearch(q)
        .then((r) => { if (live) setState({ results: r.results, loading: false }); })
        .catch(() => { if (live) setState({ results: [], loading: false }); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, lang]);
  return state;
}

function BookletIndex({ index, current, onOpen }) {
  const t = useT();
  const { lodging, lang } = useSession();
  const [query, setQuery] = useState('');
  const search = useSearch(query, lang);
  const searching = search.results !== null;
  const list = searching ? search.results : index.pages;
  return (
    <div className="scroll enter">
      <AppBar title={t('booklet.title')} />
      <div className="pad">
        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('booklet.searchPh')}
            aria-label={t('booklet.search')}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="search"
          />
        </label>
        {searching && list.length ? <p className="hint" aria-live="polite">{t('booklet.results', { n: list.length })}</p> : null}
        {searching && !list.length && !search.loading ? (
          <EmptyState icon="search" title={t('booklet.none')} text={t('booklet.noneText', { q: query.trim() })}>
            <button type="button" className="btn ghost" onClick={() => setQuery('')}>{t('booklet.all')}</button>
          </EmptyState>
        ) : null}
        {!searching && !list.length ? <EmptyState icon="booklet" title={t('booklet.empty')} /> : null}
        <div className="bkgrid">
          {list.map((p) => {
            const page = index.pages.find((x) => x.slug === p.slug) || p;
            return (
              <PhotoCard
                key={p.slug}
                cover={page.cover}
                eyebrow={lodging.name}
                title={p.title}
                excerpt={searching ? p.excerpt : null}
                highlight={searching ? p.highlight : null}
                current={current === p.slug}
                onClick={() => onOpen(p.slug)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookletPageView({ slug, index, inPane }) {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const { lodging, lang } = useSession();
  const { followTarget } = useActions();
  const page = useLoad(() => api.bookletPage(slug), [slug, lang]);
  const scroller = useRef(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [slug]);
  const at = index ? index.pages.findIndex((p) => p.slug === slug) : -1;
  const next = at >= 0 ? index.pages[at + 1] : null;
  const onCopy = async (text) => { if (await copyText(text)) toast(t('common.copied')); };
  if (page.error && !page.data) {
    return (
      <div className="scroll enter" ref={scroller}>
        <AppBar title={t('booklet.title')} back={inPane ? null : '/livret'} />
        <div className="pad">
          {page.error.status === 404 ? <EmptyState icon="booklet" title={t('booklet.pageMissing')}><button type="button" className="btn ghost" onClick={() => navigate('/livret')}>{t('booklet.all')}</button></EmptyState> : <ErrorAlert error={page.error} onRetry={page.reload} />}
        </div>
      </div>
    );
  }
  const data = page.data;
  return (
    <div className="scroll enter" key={slug} ref={scroller} lang={lang}>
      <Photo src={data && data.cover ? data.cover.url : null} sizes={data && data.cover ? data.cover.sizes : null} scrim className="cover">
        {!inPane ? <button type="button" className="back bk" aria-label={t('common.back')} onClick={() => navigate('/livret')}><Icon name="back" /></button> : null}
        <div className="in"><p className="eb">{lodging.name}</p><h1>{data ? data.title : ''}</h1></div>
      </Photo>
      {data ? <BlockList blocks={data.blocks} onNavigate={followTarget} onCopy={onCopy} /> : <Skeleton lines={5} label={t('common.loading')} />}
      {next ? (
        <button type="button" className="next" onClick={() => navigate(`/livret/${encodeURIComponent(next.slug)}`)}>
          <span><small>{t('booklet.next')}</small><b>{next.title}</b></span>
          <Icon name="chev" />
        </button>
      ) : null}
      <p className="cached"><Icon name="check" />{t('booklet.offline')}</p>
    </div>
  );
}

export default function BookletScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { slug } = useParams();
  const { lang } = useSession();
  const layout = useLayout();
  const index = useLoad(() => api.booklet(), [lang]);
  useEffect(() => { if (index.data) warmBooklet(index.data, lang); }, [index.data, lang]);
  const open = (s) => navigate(`/livret/${encodeURIComponent(s)}`);
  const first = useMemo(() => (index.data && index.data.pages[0] ? index.data.pages[0].slug : null), [index.data]);

  if (!index.data) {
    return (
      <div className="scroll enter">
        <AppBar title={t('booklet.title')} />
        {index.error ? <div className="pad"><ErrorAlert error={index.error} onRetry={index.reload} /></div> : <Skeleton blocks={3} lines={0} label={t('common.loading')} />}
      </div>
    );
  }
  if (layout.wide) {
    const shown = slug || first;
    return (
      <div className="twopane">
        <div className="paneL"><BookletIndex index={index.data} current={shown} onOpen={open} /></div>
        <div className="paneR">{shown ? <BookletPageView slug={shown} index={index.data} inPane /> : <EmptyState icon="booklet" title={t('booklet.empty')} />}</div>
      </div>
    );
  }
  return slug ? <BookletPageView slug={slug} index={index.data} /> : <BookletIndex index={index.data} onOpen={open} />;
}
