/**
 * IcalExportCard — the property's public iCal export link, with a copy button. The feed carries the
 * dates only (specs/ical-export-guest-privacy.md), which the card says.
 *
 * Props: propertyId, propertyName
 */
import React, { useEffect, useState } from 'react';
import { Box, Card, CardContent, Typography, TextField, CircularProgress, IconButton } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import api from '../api';
import ErrorAlert from './ErrorAlert';

export default function IcalExportCard({ propertyId, propertyName }) {
  const [icalUrl, setIcalUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadIcalToken();
  }, [propertyId]);

  const loadIcalToken = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getIcalToken(propertyId);
      setIcalUrl(data.url);
    } catch (err) {
      setIcalUrl('');
      setError(err.status === 403 ? err.message : 'Impossible de charger le lien iCal.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(icalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Erreur lors de la copie:', err);
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="sectionHeader" component="h2" sx={{ mb: 2 }}>
          Lien d’export iCal
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={30} />
          </Box>
        ) : error ? (
          <ErrorAlert message={error} />
        ) : (
          <>
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              À coller dans chaque plateforme pour bloquer les dates prises ici. Seules les dates sont transmises.
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                value={icalUrl}
                readOnly
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: '#f5f5f5',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  },
                }}
              />
              <IconButton
                onClick={copyToClipboard}
                size="small"
                title={copied ? 'Copié !' : 'Copier le lien'}
                sx={{
                  color: copied ? 'success.main' : 'primary.main',
                  backgroundColor: copied ? 'rgba(76, 175, 80, 0.1)' : 'transparent',
                  transition: 'all 0.2s',
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
