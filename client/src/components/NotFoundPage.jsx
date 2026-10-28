/**
 * NotFoundPage — the app-level 404 (specs/ds-components.md §3.4). For an administrator, an address
 * that belongs to a plugin that is not active reads « Plugin inactif » with a link to Plugins
 * instead (specs/plugins-phase-p-productisation.md rule 40): the server names the plugin, since a
 * release does not ship the pages of a plugin that is not installed. On an operator-managed space there
 * is no Plugins page to open: the address reads « Page introuvable » for every role
 * (specs/plugin-operator-provisioning.md rule 7).
 *
 * Props: none — reads the current location and the signed-in user.
 */
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import ExtensionOffIcon from '@mui/icons-material/ExtensionOff';
import api from '../api';
import { useAuth } from '../hooks/useAuth';
import { ADMIN, userHasRole } from '../constants/roles';
import EmptyState from './EmptyState';
import LoadingState from './LoadingState';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const asksOwner = userHasRole(user, ADMIN) && Boolean(user.pluginsManageable);
  const [owner, setOwner] = useState(asksOwner ? undefined : null);

  useEffect(() => {
    if (!asksOwner) return undefined;
    let alive = true;
    setOwner(undefined);
    api.getPluginPage(pathname)
      .then((answer) => { if (alive) setOwner(answer && answer.plugins && answer.plugins.length ? answer : null); })
      .catch(() => { if (alive) setOwner(null); });
    return () => { alive = false; };
  }, [asksOwner, pathname]);

  if (owner === undefined) return <LoadingState />;
  if (owner) {
    return (
      <EmptyState
        icon={<ExtensionOffIcon />}
        title={owner.plugins.length > 1 ? 'Plugins inactifs' : 'Plugin inactif'}
        message={owner.message}
        actionLabel="Ouvrir Plugins"
        onAction={() => navigate('/parametres/plugins')}
        py={10}
      />
    );
  }
  return (
    <EmptyState
      icon={<SearchOffIcon />}
      title="Page introuvable"
      message="Cette adresse ne correspond à aucune page de GuestFlow."
      actionLabel="Retour au tableau de bord"
      onAction={() => navigate('/')}
      py={10}
    />
  );
}
