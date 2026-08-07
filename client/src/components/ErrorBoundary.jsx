/**
 * ErrorBoundary — app-level render-crash guard (specs/ds-components.md §3.4). A component throw
 * used to blank the whole page; it now shows a recoverable EmptyState. Remounts on every route
 * change (key = pathname in the RouteErrorBoundary wrapper), so navigating away self-resets.
 *
 * Usage: wrap the routed shell with <RouteErrorBoundary> (inside the Router).
 */
import React from 'react';
import { useLocation } from 'react-router';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import EmptyState from './EmptyState';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState
          icon={<ReportProblemIcon />}
          title="Une erreur est survenue"
          message="L'affichage de cette page a rencontré un problème. Recharger la page devrait rétablir la situation."
          actionLabel="Recharger la page"
          onAction={() => window.location.reload()}
          py={10}
        />
      );
    }
    return this.props.children;
  }
}

export default function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}
