/**
 * The studio's screens (specs/guest-app.md rules 47-50, §4.2): lodging first — every screen of a lodging under
 * `/:propertyId/…` — then the settings shared by every lodging under `/reglages/…`.
 */
import { Navigate, Route, Routes, useParams } from 'react-router';
import { Box } from '@mui/material';
import LoadingState from '@guestflow/components/LoadingState';
import ErrorAlert from '@guestflow/components/ErrorAlert';
import EmptyState from '@guestflow/components/EmptyState';
import StudioShell from './components/StudioShell';
import { DirtyGuardProvider } from './hooks/useDirtyGuard';
import { useLoad } from './hooks/useLoad';
import { api } from './services/api';
import ModulesPage from './pages/ModulesPage';
import LodgingInfoPage from './pages/LodgingInfoPage';
import BookletPage from './pages/BookletPage';
import ShopItemsPage from './pages/ShopItemsPage';
import ServicePage from './pages/ServicePage';
import SettingsPage from './pages/SettingsPage';
import MediaLibraryPage from './pages/MediaLibraryPage';

/** The lodging the URL names, from the live list (rule 48). */
function LodgingRoute({ lodgings, children }) {
  const { propertyId } = useParams();
  const lodging = lodgings.find((l) => String(l.propertyId) === propertyId);
  if (!lodging) return <EmptyState title="Logement introuvable" message="Ce logement n’existe plus dans GuestFlow, ou il a été archivé." />;
  return children(lodging);
}

export default function App() {
  const list = useLoad(() => api.lodgings(), []);
  if (!list.data) {
    return (
      <Box sx={{ p: 3 }}>
        {list.error ? <ErrorAlert message={list.error.message} onRetry={list.reload} /> : <LoadingState />}
      </Box>
    );
  }
  const { lodgings } = list.data;
  const first = lodgings.find((l) => l.enabled) || lodgings[0];
  const updateLodging = (propertyId, patch) => list.setData((d) => ({
    ...d, lodgings: d.lodgings.map((l) => (l.propertyId === propertyId ? { ...l, ...patch } : l)),
  }));
  const lodgingScreen = (Screen) => (
    <LodgingRoute lodgings={lodgings}>
      {(lodging) => <Screen key={lodging.propertyId} lodging={lodging} lodgings={lodgings} onLodgingChange={(patch) => updateLodging(lodging.propertyId, patch)} />}
    </LodgingRoute>
  );
  return (
    <DirtyGuardProvider>
      <StudioShell lodgings={lodgings}>
        <Routes>
          <Route path="/" element={first ? <Navigate to={`/${first.propertyId}/modules`} replace /> : <EmptyState title="Aucun logement" message="Créer d’abord un logement dans GuestFlow." />} />
          <Route path="/reglages/service" element={<ServicePage lodgings={lodgings} />} />
          <Route path="/reglages/application" element={<SettingsPage lodgings={lodgings} onLodgingChange={updateLodging} />} />
          <Route path="/reglages/photos" element={<MediaLibraryPage />} />
          <Route path="/:propertyId/modules" element={lodgingScreen(ModulesPage)} />
          <Route path="/:propertyId/infos" element={lodgingScreen(LodgingInfoPage)} />
          <Route path="/:propertyId/livret" element={lodgingScreen(BookletPage)} />
          <Route path="/:propertyId/livret/:pageId" element={lodgingScreen(BookletPage)} />
          <Route path="/:propertyId/boutique" element={lodgingScreen(ShopItemsPage)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </StudioShell>
    </DirtyGuardProvider>
  );
}
