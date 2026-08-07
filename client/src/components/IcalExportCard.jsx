import React, { useEffect, useState } from 'react';
import { Box, Card, CardContent, Typography, TextField, CircularProgress, IconButton } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import api from '../api';

export default function IcalExportCard({ propertyId, propertyName }) {
  const [icalUrl, setIcalUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadIcalToken();
  }, [propertyId]);

  const loadIcalToken = async () => {
    setLoading(true);
    try {
      const data = await api.getIcalToken(propertyId);
      setIcalUrl(data.url);
    } catch (err) {
      console.error('Erreur lors du chargement du lien iCal:', err);
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
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          📅 Lien iCal pour synchronisation
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={30} />
          </Box>
        ) : (
          <>
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              Utilisez ce lien pour synchroniser vos réservations sur d'autres plateformes (Airbnb, Booking.com, etc.)
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
