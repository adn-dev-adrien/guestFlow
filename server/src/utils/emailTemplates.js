// Plain-text email bodies (French) for the admin account-management flow
// (specs/admin-account-management.md §3.3 rule 14). Pure functions — no I/O, no nodemailer
// dependency. The caller (emailService) takes the rendered { subject, text } and ships it.

function formatRecipientName({ firstName, lastName }) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  const full = `${first} ${last}`.trim();
  return full || 'bonjour';
}

function welcomeEmailBody({
  firstName,
  lastName,
  email,
  temporaryPassword,
  publicUrl,
  companyName,
}) {
  const greeting = formatRecipientName({ firstName, lastName });
  const lines = [
    `Bonjour ${greeting},`,
    '',
    'Un compte vient d\'être créé pour vous sur GuestFlow.',
    '',
    `Adresse de connexion : ${publicUrl}`,
    `Email : ${email}`,
    `Mot de passe provisoire : ${temporaryPassword}`,
    '',
    'Ce mot de passe est temporaire : connectez-vous avec puis suivez les instructions pour en choisir un personnel. Vous serez ensuite redirigé vers la page de connexion pour utiliser votre nouveau mot de passe.',
    '',
  ];
  if (companyName && String(companyName).trim()) {
    lines.push(`Société associée : ${companyName}`);
    lines.push('');
  }
  lines.push('— GuestFlow');
  return {
    subject: 'Votre accès GuestFlow',
    text: lines.join('\n'),
  };
}

function passwordResetEmailBody({
  firstName,
  lastName,
  email,
  temporaryPassword,
  publicUrl,
}) {
  const greeting = formatRecipientName({ firstName, lastName });
  const lines = [
    `Bonjour ${greeting},`,
    '',
    'Un administrateur a réinitialisé votre mot de passe GuestFlow. Votre ancien mot de passe ne fonctionne plus.',
    '',
    `Adresse de connexion : ${publicUrl}`,
    `Email : ${email}`,
    `Nouveau mot de passe provisoire : ${temporaryPassword}`,
    '',
    'Ce mot de passe est temporaire : connectez-vous avec puis choisissez-en un personnel à l\'invite. Vous serez ensuite redirigé vers la page de connexion pour utiliser votre nouveau mot de passe.',
    '',
    '— GuestFlow',
  ];
  return {
    subject: 'Réinitialisation de votre mot de passe GuestFlow',
    text: lines.join('\n'),
  };
}

function testEmailBody() {
  return {
    subject: 'Email de test GuestFlow',
    text: [
      'Cet email confirme que la configuration SMTP de GuestFlow fonctionne.',
      '',
      'Si vous le recevez, vous pouvez créer des comptes utilisateurs depuis la page Comptes.',
      '',
      '— GuestFlow',
    ].join('\n'),
  };
}

module.exports = {
  welcomeEmailBody,
  passwordResetEmailBody,
  testEmailBody,
};
