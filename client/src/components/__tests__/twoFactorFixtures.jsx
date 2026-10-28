// Shared fixtures of the « Validation en deux étapes » suites (specs/hosting-h2-account-security.md
// rules 38-53). Not a test file: each suite imports it and declares its own `vi.mock('../../api')`.
import { vi } from 'vitest';

export const STATUS_OFF = {
  enabled: false, method: null, methodLabel: null, enabledLabel: null, backupCodesLeft: 0, backupCodesTotal: 10,
  backupCodesLabel: null, backupCodesLow: false, backupCodesWarning: null, emailAvailable: true, reauthNeedsCode: false,
  nudge: true, events: [], eventsCount: 0,
};

export const STATUS_ON = {
  ...STATUS_OFF,
  enabled: true,
  method: 'totp',
  methodLabel: 'Appli d’authentification',
  enabledLabel: 'depuis le 12/10/2026',
  backupCodesLeft: 8,
  backupCodesLabel: '8 codes de secours sur 10',
  reauthNeedsCode: true,
  nudge: false,
  events: [
    { at: '2026-10-12T09:00:00.000Z', atLabel: '12/10/2026 11:00', label: 'Validation en deux étapes activée (appli)' },
    { at: '2026-10-11T09:00:00.000Z', atLabel: '11/10/2026 11:00', label: 'Mot de passe réinitialisé par lien' },
  ],
  eventsCount: 2,
};

export const TOTP_ENROLMENT = {
  method: 'totp',
  qrDataUrl: 'data:image/png;base64,QR',
  secret: 'ABCD EFGH IJKL MNOP',
  otpauthUri: 'otpauth://totp/GuestFlow%3AOliviers?secret=ABCDEFGHIJKLMNOP&issuer=GuestFlow',
  issuer: 'GuestFlow',
  accountLabel: 'Domaine des Oliviers · marie@x.fr',
  replacing: false,
  expiresAt: '2026-10-28T10:15:00.000Z',
  enrolmentToken: 'tok-1',
};

export const EMAIL_ENROLMENT = { method: 'email', sentTo: 'm•••e@x.fr', resendInSeconds: 60, replacing: false, expiresAt: '2026-10-28T10:15:00.000Z' };

export const apiMock = () => ({
  __esModule: true,
  default: {
    getTwoFactorStatus: vi.fn(),
    startTwoFactor: vi.fn(),
    confirmTwoFactor: vi.fn(),
    cancelTwoFactor: vi.fn(),
    sendTwoFactorActionCode: vi.fn(),
    disableTwoFactor: vi.fn(),
    regenerateBackupCodes: vi.fn(),
  },
});

export const apiError = (error, message, extra = {}) => Object.assign(new Error(message), { error, message, ...extra });

export const media = ({ coarse = false, phone = false } = {}) => (query) => ({
  matches: /pointer:\s*coarse/.test(query) ? coarse : (/max-width/.test(query) ? phone : false),
  media: query,
  onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});
