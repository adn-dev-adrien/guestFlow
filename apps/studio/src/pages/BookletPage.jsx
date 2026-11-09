/**
 * Livret — one lodging's booklet (rules 16-20, 48-49): its pages, then the page being edited, and beside them the
 * phone preview of that page as the lodging's guests will read it — the saved draft, resolved by the server
 * (restricted blocks filtered, lodging facts injected) and drawn by the guest app's own components.
 *
 * « Publier » publishes the lodging's booklet; a shared page is patched into every lodging it is placed in.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  Alert, Box, Chip, TextField, Typography,
} from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import PageActionBar from '@guestflow/components/PageActionBar';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import LoadingState from '@guestflow/components/LoadingState';
import FormDialog from '@guestflow/components/FormDialog';
import StudioPage from '../components/StudioPage';
import PagesList from '../components/PagesList';
import PageEditor from '../components/PageEditor';
import PhonePreview from '../components/PhonePreview';
import { useLoad } from '../hooks/useLoad';
import { useGuardedNavigate } from '../hooks/useDirtyGuard';
import { usePreviewLang } from '../hooks/usePreviewLang';
import { pageView } from '../utils/previewViews';
import { slugify } from '../utils/pageDraft';
import { api } from '../services/api';

/** « Publié le 6 nov. à 14 h 02 » — the booklet's state under the list. */
function versionLine(booklet) {
  const parts = [];
  if (!booklet.version) parts.push('Jamais publié : les clients voient un livret vide.');
  else {
    const at = new Date(booklet.version.publishedAt);
    const when = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
    parts.push(booklet.upToDate ? `Publié le ${when}, à jour.` : `Publié le ${when} — des changements ne sont pas encore publiés.`);
  }
  if (booklet.untranslated) parts.push(`${booklet.untranslated} texte${booklet.untranslated > 1 ? 's' : ''} non traduit${booklet.untranslated > 1 ? 's' : ''}.`);
  return parts.join(' ');
}

function NewPageDialog({ open, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setTitle(''); setSlug(''); setTouched(false); setError(null); } }, [open]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate({ title: { fr: title.trim() }, slug });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog open={open} onClose={onClose} title="Nouvelle page" submitLabel="Créer la page" onSubmit={submit} submitDisabled={!title.trim() || !slug} submitBusy={busy}>
      <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
        {error ? <ErrorAlert message={error} /> : null}
        <TextField autoFocus label="Titre" required value={title} onChange={(e) => { setTitle(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} slotProps={{ htmlInput: { maxLength: 120 } }} />
        <TextField label="Adresse de la page" required value={slug} onChange={(e) => { setTouched(true); setSlug(e.target.value); }} helperText="Lettres minuscules, chiffres et tirets." slotProps={{ htmlInput: { maxLength: 60, autoCapitalize: 'off', spellCheck: false } }} />
      </Box>
    </FormDialog>
  );
}

export default function BookletPage({ lodging, lodgings }) {
  const id = lodging.propertyId;
  const { pageId } = useParams();
  const go = useGuardedNavigate();
  const currentId = pageId ? Number(pageId) : null;
  const [lang, setLang] = usePreviewLang();
  const data = useLoad(() => Promise.all([api.booklet(id), api.media(), api.items(id)]).then(([booklet, media, items]) => ({ booklet, media, items })), [id]);
  const preview = useLoad(() => api.preview(id, lang), [id, lang]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [creating, setCreating] = useState(false);
  const previewRef = useRef(null);

  const refresh = async () => { await Promise.all([data.reload(), preview.reload()]); };

  const writeBooklet = async (pages) => {
    const before = data.data.booklet;
    data.setData((d) => ({ ...d, booklet: { ...d.booklet, pages } }));
    setBusy(true);
    setError(null);
    try {
      const booklet = await api.saveBooklet(id, pages.map((p, sortOrder) => ({ pageId: p.id, sortOrder, published: p.published })));
      data.setData((d) => ({ ...d, booklet }));
      preview.reload();
    } catch (err) {
      data.setData((d) => ({ ...d, booklet: before }));
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    await api.publish(id);
    await refresh();
  };
  const publishFromList = async () => {
    setBusy(true);
    setError(null);
    try {
      await publish();
      setNotice(`Livret de ${lodging.name} publié.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async (page) => {
    const created = await api.createPage(id, page);
    setCreating(false);
    await refresh();
    go(`/${id}/livret/${created.id}`);
  };

  if (!data.data) {
    return (
      <StudioPage bar={<PageActionBar title="Livret" subtitle={<Chip size="small" label={lodging.name} />} />}>
        {data.error ? <ErrorAlert message={data.error.message} onRetry={data.reload} /> : <LoadingState />}
      </StudioPage>
    );
  }

  const { booklet, media, items } = data.data;
  const current = booklet.pages.find((p) => p.id === currentId) || null;
  const resolved = (preview.data && preview.data.pages) || [];
  const shownSlug = current ? current.slug : (booklet.pages[0] && booklet.pages[0].slug);
  const at = resolved.findIndex((p) => p.slug === shownSlug);
  const phone = (
    <Box ref={previewRef} sx={{ scrollMarginTop: 140 }}>
      <PhonePreview
        view={pageView({
          lodgingName: lodging.name,
          page: at >= 0 ? resolved[at] : null,
          nextTitle: at >= 0 && resolved[at + 1] ? resolved[at + 1].title : null,
          modules: ['booklet', 'shop', 'orders'],
        })}
        title={`Aperçu · ${lodging.name}`}
        caption={current && at < 0 ? 'Cette page est en brouillon dans ce livret : montrez-la pour la voir ici.' : 'Le brouillon enregistré, avec les vrais composants de l’app.'}
        lang={lang}
        onLang={setLang}
      />
    </Box>
  );
  const list = (
    <PagesList
      lodging={lodging}
      pages={booklet.pages}
      currentId={currentId}
      busy={busy}
      onOpen={(pid) => go(`/${id}/livret/${pid}`)}
      onReorder={writeBooklet}
      onTogglePublished={(page, published) => writeBooklet(booklet.pages.map((p) => (p.id === page.id ? { ...p, published } : p)))}
      onCreate={() => setCreating(true)}
      footer={<Typography variant="body2" sx={{ color: 'text.secondary' }}>{versionLine(booklet)}</Typography>}
    />
  );
  const alerts = (
    <>
      {error ? <ErrorAlert message={error} /> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert> : null}
    </>
  );
  const dialog = <NewPageDialog open={creating} onClose={() => setCreating(false)} onCreate={create} />;

  if (current) {
    return (
      <>
        <PageEditor
          key={current.id}
          pageId={current.id}
          lodging={lodging}
          lodgings={lodgings}
          media={media}
          items={items.filter((i) => i.sold)}
          bookletPages={booklet.pages}
          upToDate={booklet.upToDate}
          list={<>{alerts}{list}</>}
          preview={phone}
          previewRef={previewRef}
          onChanged={() => refresh()}
          onPublish={publish}
          onDeleted={async () => { await refresh(); go(`/${id}/livret`); }}
        />
        {dialog}
      </>
    );
  }

  return (
    <StudioPage
      bar={(
        <PageActionBar
          title="Livret"
          subtitle={<Chip size="small" label={lodging.name} />}
          actionsBefore={[{
            icon: <PublicIcon />, label: 'Publier', tooltip: booklet.upToDate ? 'Le livret publié est déjà à jour' : `Publier le livret de ${lodging.name}`, onClick: publishFromList, color: 'success', ariaDisabled: booklet.upToDate || busy,
          }]}
        />
      )}
      preview={phone}
    >
      {alerts}
      {list}
      {booklet.pages.length ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>Choisissez une page pour la modifier.</Typography> : null}
      {dialog}
    </StudioPage>
  );
}
