/**
 * Paramètres → Conditions générales (specs/terms-acceptance-record.md §3.1, §6).
 *
 * The CGV draft (Markdown FR + EN, rendered by the server), its publication as an immutable version,
 * the published versions, and the emergency switch of the online enforcement. Every label, date and
 * verdict (can publish? stale facts? outdated plugin?) comes from GET /api/terms.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, FormControlLabel, Stack, Switch, Tab, Table, TableBody,
  TableCell, TableHead, TableRow, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PublishIcon from '@mui/icons-material/Publish';
import PageActionBar from '../../components/PageActionBar';
import PageTabs from '../../components/PageTabs';
import ConfirmDialog from '../../components/ConfirmDialog';
import ErrorAlert from '../../components/ErrorAlert';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import MarkdownEditorField from '../../components/MarkdownEditorField';
import ArchivedHtmlDialog from '../../components/ArchivedHtmlDialog';
import { useToast } from '../../components/DialogProvider';
import api from '../../api';

const PREVIEW_DELAY_MS = 400;
const LANGS = [
  { key: 'fr', label: 'Français' },
  { key: 'en', label: 'English' },
];

function publishTooltip(overview, dirty) {
  if (dirty) return 'Enregistrez d’abord le brouillon';
  if (!overview.canPublish) return overview.publishBlockedReason;
  return `Publier la version ${overview.nextVersion}`;
}

export default function TermsSettingsPage() {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const { showSuccess, showError } = useToast();
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState({ fr: '', en: '' });
  const [lang, setLang] = useState('fr');
  const [preview, setPreview] = useState({ fr: '', en: '' });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [versionView, setVersionView] = useState(null);
  const previewSeq = useRef(0);

  const applyOverview = useCallback((o) => {
    setOverview(o);
    setDraft({ fr: o.draft.fr, en: o.draft.en });
  }, []);

  useEffect(() => {
    api.getTerms()
      .then(applyOverview)
      .catch(() => setLoadError('Impossible de charger les conditions générales.'));
  }, [applyOverview]);

  // Server-side rendering of the draft being typed (the client never parses Markdown).
  useEffect(() => {
    if (!overview) return undefined;
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      api.previewTerms(draft)
        .then((r) => { if (previewSeq.current === seq) setPreview(r.html); })
        .catch(() => {})
        .finally(() => { if (previewSeq.current === seq) setPreviewLoading(false); });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, overview]);

  if (!overview) {
    return (
      <Box>
        <PageActionBar title="Conditions générales" />
        <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
          {loadError ? <ErrorAlert message={loadError} onRetry={() => window.location.reload()} /> : <LoadingState />}
        </Box>
      </Box>
    );
  }

  const dirty = draft.fr !== overview.draft.fr || draft.en !== overview.draft.en;

  const handleSave = async () => {
    setSaving(true);
    try {
      applyOverview(await api.saveTermsDraft(draft));
      showSuccess('Brouillon enregistré');
    } catch (e) {
      showError(e.message || 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setConfirmPublish(false);
    setSaving(true);
    try {
      const o = await api.publishTerms();
      applyOverview(o);
      showSuccess(`Version ${o.current.version} publiée`);
    } catch (e) {
      showError(e.message || 'Échec de la publication.');
    } finally {
      setSaving(false);
    }
  };

  const setEnforcement = async (value) => {
    setConfirmDisable(false);
    try {
      applyOverview(await api.updateTermsEnforcement(value));
      showSuccess(value ? 'Acceptation des CGV exigée' : 'Exigence désactivée');
    } catch (e) {
      showError(e.message || 'Échec de l’enregistrement.');
    }
  };

  const openVersion = async (version) => {
    setVersionView({ version, loading: true, documents: [], subtitle: null, error: '' });
    try {
      const v = await api.getTermsVersion(version);
      setVersionView({
        version,
        loading: false,
        error: '',
        subtitle: `Publiée le ${v.publishedAtLabel} · empreinte ${v.contentHash.slice(0, 12)}`,
        documents: [
          { key: 'fr', label: 'Français', html: v.html.fr },
          { key: 'en', label: 'English', html: v.html.en },
        ],
      });
    } catch {
      setVersionView((prev) => ({ ...prev, loading: false, error: 'Impossible de charger cette version.' }));
    }
  };

  const variablesHelp = (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Variables :</Typography>
      {overview.variables.map((name) => (
        <Chip key={name} size="small" variant="outlined" label={`{{${name}}}`} sx={{ fontFamily: 'monospace' }} />
      ))}
      <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mt: 0.5 }}>
        Titres « ## » et « ### », listes « - », **gras**, *italique*, [lien](https://…). Tout autre code reste du texte.
      </Typography>
    </Stack>
  );

  return (
    <Box>
      <PageActionBar
        title="Conditions générales"
        subtitle={overview.current
          ? <Chip size="small" color="success" variant="outlined" label={`v${overview.current.version} en vigueur`} />
          : <Chip size="small" color="warning" variant="outlined" label="Aucune version publiée" />}
        onSave={handleSave}
        saveDisabled={!dirty || saving}
        saveBusy={saving}
        saveTooltip="Enregistrer le brouillon"
        onCancel={() => setDraft({ fr: overview.draft.fr, en: overview.draft.en })}
        cancelDisabled={!dirty || saving}
        actionsBefore={[{
          icon: <PublishIcon />,
          tooltip: publishTooltip(overview, dirty),
          ariaLabel: `Publier la version ${overview.nextVersion}`,
          onClick: () => setConfirmPublish(true),
          color: 'success',
          disabled: dirty || !overview.canPublish || saving,
        }]}
      />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 1280, mx: 'auto' }}>
        {!overview.current && overview.requireTermsAcceptance && (
          <Alert severity="error">
            Aucune version publiée : la réservation en ligne est fermée. Publiez vos conditions générales pour la rouvrir.
          </Alert>
        )}
        {overview.current && overview.staleVariables.length > 0 && (
          <Alert severity="warning">
            Un élément cité a changé depuis la version {overview.current.version} (
            {overview.staleVariables.map((n) => `{{${n}}}`).join(', ')}
            ) : publiez une nouvelle version pour l’intégrer. D’ici là, le site affiche la version {overview.current.version} telle qu’elle a été publiée.
          </Alert>
        )}
        {overview.pluginOutdated && overview.requireTermsAcceptance && (
          <Alert severity="error">
            Le site utilise le plugin {overview.lastSeenPluginVersion}, qui n’envoie pas l’acceptation : toutes les demandes de réservation sont refusées.
            Mettez-le à jour en {overview.minPluginVersion} ou désactivez l’exigence ci-dessous.
          </Alert>
        )}

        {!dirty && overview.unknownVariables.length > 0 && (
          <Alert severity="error">
            Publication impossible, variable(s) inconnue(s) dans le brouillon : {overview.unknownVariables.map((n) => `{{${n}}}`).join(', ')}.
          </Alert>
        )}
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
            <Typography variant="sectionHeader" component="h2">Brouillon</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Le brouillon n’est jamais visible sur le site. « Publier » le fige en version {overview.nextVersion}, qui ne pourra plus être modifiée.
            </Typography>
            <PageTabs
              value={lang}
              onChange={setLang}
              variant="card"
              ariaLabel="Langue du brouillon"
              items={LANGS.map((l) => ({ value: l.key, label: l.label }))}
            />
            <MarkdownEditorField
              key={lang}
              label={lang === 'fr' ? 'Texte en français (Markdown)' : 'Texte en anglais (Markdown)'}
              value={draft[lang]}
              onChange={(value) => setDraft((prev) => ({ ...prev, [lang]: value }))}
              previewHtml={preview[lang]}
              previewLoading={previewLoading}
              disabled={saving}
              helper={variablesHelp}
            />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
            <Typography variant="sectionHeader" component="h2" sx={{ mb: 1 }}>Versions publiées</Typography>
            {overview.versions.length === 0 ? (
              <EmptyState title="Aucune version publiée" message="Publiez le brouillon pour proposer vos conditions générales aux clients." py={3} />
            ) : isXs ? (
              <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
                {overview.versions.map((v) => (
                  <Box key={v.version} sx={{ py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Version {v.version}{overview.current?.version === v.version ? ' · en vigueur' : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {v.publishedAtLabel} · {v.acceptanceCount} acceptation{v.acceptanceCount > 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Button size="small" onClick={() => openVersion(v.version)} sx={{ minHeight: 44 }}>Voir</Button>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Version</TableCell>
                    <TableCell>Publiée le</TableCell>
                    <TableCell>Empreinte</TableCell>
                    <TableCell align="right">Acceptations</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {overview.versions.map((v) => (
                    <TableRow key={v.version}>
                      <TableCell>
                        v{v.version}
                        {overview.current?.version === v.version && <Chip size="small" label="en vigueur" sx={{ ml: 1 }} />}
                      </TableCell>
                      <TableCell>{v.publishedAtLabel}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{v.shortHash}</TableCell>
                      <TableCell align="right">{v.acceptanceCount}</TableCell>
                      <TableCell align="right"><Button size="small" onClick={() => openVersion(v.version)}>Voir</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
            <Typography variant="sectionHeader" component="h2">Réservation en ligne</Typography>
            <FormControlLabel
              sx={{ mt: 1 }}
              control={(
                <Switch
                  checked={overview.requireTermsAcceptance}
                  onChange={(e) => (e.target.checked ? setEnforcement(true) : setConfirmDisable(true))}
                />
              )}
              label="Exiger l’acceptation des CGV sur le site"
            />
            <Typography variant="body2" color="text.secondary">
              {overview.requireTermsAcceptance
                ? 'Une demande de réservation sans case cochée, ou acceptée sur une version dépassée, est refusée.'
                : 'Exigence désactivée : les demandes sans acceptation sont créées, sans preuve. À réserver aux urgences.'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {overview.lastSeenPluginVersion
                ? `Dernière demande reçue du plugin WordPress ${overview.lastSeenPluginVersion}.`
                : 'Version du plugin WordPress : pas encore vue sur une demande.'}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={handlePublish}
        title={`Publier la version ${overview.nextVersion} ?`}
        message={`La version ${overview.nextVersion} sera figée et proposée aux clients dès maintenant. Elle ne pourra plus être modifiée.`}
        confirmLabel="Publier"
        confirmColor="success"
      />
      <ConfirmDialog
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        onConfirm={() => setEnforcement(false)}
        title="Désactiver l’exigence ?"
        message="Les demandes de réservation seront acceptées même sans case cochée, et sans preuve d’acceptation. Réservez ce réglage aux urgences."
        confirmLabel="Désactiver"
      />
      <ArchivedHtmlDialog
        open={Boolean(versionView)}
        onClose={() => setVersionView(null)}
        title={versionView ? `Conditions générales — version ${versionView.version}` : ''}
        subtitle={versionView?.subtitle}
        documents={versionView?.documents || []}
        loading={Boolean(versionView?.loading)}
        error={versionView?.error || ''}
      />
    </Box>
  );
}
