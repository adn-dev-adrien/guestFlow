import React, { useEffect, useState, useCallback } from 'react';
import { Box, Button, Alert } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import DeleteIcon from '@mui/icons-material/Delete';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PageActionBar from '../components/PageActionBar';
import FormDialog from '../components/FormDialog';
import SchoolHolidayFormFields from '../components/SchoolHolidayFormFields';
import SchoolHolidaysTimeline from '../components/SchoolHolidaysTimeline';
import SchoolHolidaysSyncBanner from '../components/SchoolHolidaysSyncBanner';
import SchoolHolidaysSyncSettingsDialog from '../components/SchoolHolidaysSyncSettingsDialog';
import { useAppDialogs } from '../components/DialogProvider';
import api from '../api';

const emptyForm = {
  label: '',
  zoneA_start: '', zoneA_end: '',
  zoneB_start: '', zoneB_end: '',
  zoneC_start: '', zoneC_end: '',
};

export default function SchoolHolidaysPage() {
  const { confirm } = useAppDialogs();
  const [periods, setPeriods] = useState([]);
  const [syncState, setSyncState] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [editPeriod, setEditPeriod] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [validationError, setValidationError] = useState('');

  const [settingsOpen, setSettingsOpen] = useState(false);

  const reload = useCallback(async () => {
    const data = await api.getSchoolHolidays();
    setPeriods(data?.periods || []);
    setSyncState(data?.syncState || null);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const openCreate = () => {
    setEditPeriod(null);
    setForm(emptyForm);
    setValidationError('');
    setDialogOpen(true);
  };

  const openEdit = (period) => {
    setEditPeriod(period);
    setForm({
      label: period.label || '',
      zoneA_start: period.zoneA_start || '',
      zoneA_end: period.zoneA_end || '',
      zoneB_start: period.zoneB_start || '',
      zoneB_end: period.zoneB_end || '',
      zoneC_start: period.zoneC_start || '',
      zoneC_end: period.zoneC_end || '',
    });
    setValidationError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setValidationError('');
    try {
      if (editPeriod) {
        await api.updateSchoolHoliday(editPeriod.id, form);
      } else {
        await api.createSchoolHoliday(form);
      }
      setDialogOpen(false);
      await reload();
    } catch (e) {
      setValidationError(e?.body?.error || e?.message || 'Erreur lors de l’enregistrement.');
    }
  };

  const handleDelete = async () => {
    if (!editPeriod) return;
    const ok = await confirm({
      title: 'Confirmer la suppression',
      message: editPeriod.externalRef
        ? 'Supprimer cette période ? Elle a été importée automatiquement et sera ré-importée à la prochaine synchronisation.'
        : 'Supprimer cette période de vacances ?',
    });
    if (!ok) return;
    await api.deleteSchoolHoliday(editPeriod.id);
    setDialogOpen(false);
    await reload();
  };

  const handleUnlock = async () => {
    if (!editPeriod) return;
    await api.unlockSchoolHoliday(editPeriod.id);
    setDialogOpen(false);
    await reload();
  };

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await api.syncSchoolHolidays();
      await reload();
    } catch (e) {
      // Surface server-side errors via the banner reload (lastSyncStatus will reflect).
      await reload();
    } finally {
      setSyncing(false);
    }
  };

  const handleSettingsSaved = async () => {
    await reload();
  };

  return (
    <Box>
      <PageActionBar
        title="Vacances scolaires"
        backTo="/settings"
        actionsBefore={[
          {
            icon: <SyncIcon />,
            tooltip: 'Synchroniser maintenant',
            onClick: triggerSync,
            color: 'info',
            disabled: syncing,
          },
          {
            icon: <AddIcon />,
            tooltip: 'Ajouter une période',
            onClick: openCreate,
            color: 'primary',
          },
        ]}
      />

      <Box sx={{ px: { xs: 1.5, sm: 3 }, maxWidth: 1200, mx: 'auto' }}>
        <SchoolHolidaysSyncBanner
          syncState={syncState}
          onSync={triggerSync}
          onOpenSettings={() => setSettingsOpen(true)}
          busy={syncing}
        />

        <SchoolHolidaysTimeline periods={periods} onEdit={openEdit} />
      </Box>

      <FormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editPeriod ? 'Modifier la période' : 'Ajouter une période'}
        onSubmit={handleSave}
        submitDisabled={!form.label?.trim()}
      >
        {editPeriod?.externalRef ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Source officielle (data.education.gouv.fr).
            {editPeriod.isLocked === 1
              ? ' Cette période est actuellement verrouillée — la synchronisation automatique ne la touchera plus.'
              : ' Toute modification verrouillera cette période contre la synchronisation automatique.'}
          </Alert>
        ) : null}

        <SchoolHolidayFormFields form={form} setField={setField} validationError={validationError} />

        {editPeriod ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
            {editPeriod.externalRef && editPeriod.isLocked === 1 ? (
              <Button
                size="small"
                startIcon={<LockOpenIcon />}
                onClick={handleUnlock}
                color="info"
                variant="outlined"
              >
                Réactiver la mise à jour automatique
              </Button>
            ) : null}
            <Button
              size="small"
              startIcon={<DeleteIcon />}
              onClick={handleDelete}
              color="error"
              variant="outlined"
              sx={{ ml: 'auto' }}
            >
              Supprimer
            </Button>
          </Box>
        ) : null}
      </FormDialog>

      <SchoolHolidaysSyncSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initial={syncState}
        onSaved={handleSettingsSaved}
      />
    </Box>
  );
}
