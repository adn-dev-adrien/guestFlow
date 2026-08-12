/**
 * TariffRecipesPage — read-only browser of the tariff recipes (specs/tariff-recipes/spec.md §3.5
 * rule 28). One card per recipe: label, id, version, source badge (« Livrée » / « Locale »), an
 * override chip, the properties using it, and an expandable pretty-printed view of the document.
 * Invalid recipes surface as error cards naming their file — a bad drop in `data/recipes/` is
 * visible, never silent. Updating a recipe = dropping a file in the data directory + restarting.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Chip, Collapse, IconButton, Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';

function RecipeCard({ recipe }) {
  const [expanded, setExpanded] = useState(false);
  const [document, setDocument] = useState(null);

  const toggle = async () => {
    if (!expanded && !document) {
      try {
        const res = await api.getTariffRecipe(recipe.id);
        setDocument(res?.recipe || null);
      } catch { setDocument(null); }
    }
    setExpanded((v) => !v);
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{recipe.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {recipe.id} · v{recipe.version}
            </Typography>
            {recipe.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{recipe.description}</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={recipe.source === 'local' ? 'Locale' : 'Livrée'}
              color={recipe.source === 'local' ? 'info' : 'default'}
              variant="outlined"
            />
            {recipe.overridesBundled && (
              <Chip size="small" label="Écrase la version livrée" color="warning" variant="outlined" />
            )}
            <Tooltip title={expanded ? 'Replier' : 'Voir le document'}>
              <IconButton size="small" onClick={toggle} aria-label={`Document ${recipe.id}`}>
                {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {(recipe.usedByProperties || []).length === 0 ? (
            <Typography variant="caption" color="text.secondary">Utilisée par aucun logement</Typography>
          ) : (
            recipe.usedByProperties.map((p) => (
              <Chip
                key={p.id}
                size="small"
                label={`${p.name}${p.appliedVersion && p.appliedVersion !== recipe.version ? ` (v${p.appliedVersion} appliquée)` : ''}`}
                color={p.appliedVersion && p.appliedVersion !== recipe.version ? 'warning' : 'success'}
                variant="outlined"
              />
            ))
          )}
        </Box>

        <Collapse in={expanded}>
          <Box
            component="pre"
            sx={{
              mt: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1,
              fontSize: 12, overflowX: 'auto', maxHeight: 420, m: 0, mb: 0,
            }}
          >
            {document ? JSON.stringify(document, null, 2) : 'Chargement…'}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

export default function TariffRecipesPage() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setData(await api.getTariffRecipes());
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
      <PageActionBar title="Recettes tarifaires" backTo="/settings" />

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 2 }}>
        Les saisons et tarifs des logements en mode automatique sont calculés à partir de ces
        recettes — jours fériés compris. Une recette déposée dans le dossier <code>recipes/</code> du
        serveur est prise en compte au redémarrage et remplace la version livrée du même identifiant.
      </Typography>

      {loadError && <ErrorAlert message="Impossible de charger les recettes." onRetry={load} />}
      {!loadError && !data && <LoadingState py={4} label="Chargement…" />}

      {data && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {(data.invalid || []).map((invalid) => (
            <ErrorAlert
              key={`${invalid.source}-${invalid.file}`}
              message={`Recette invalide (${invalid.source === 'local' ? 'locale' : 'livrée'} · ${invalid.file}) : ${invalid.error}`}
            />
          ))}
          {(data.recipes || []).length === 0 && (data.invalid || []).length === 0 && (
            <EmptyState icon={<MenuBookIcon />} py={6} message="Aucune recette tarifaire." />
          )}
          {(data.recipes || []).map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} />)}
        </Box>
      )}
    </Box>
  );
}
