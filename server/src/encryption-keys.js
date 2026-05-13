const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Path to store the encryption key locally (not committed to git)
const ENV_LOCAL_PATH = path.join(__dirname, '..', '.env.local');

/**
 * Load or generate the encryption key for sensitive data.
 * 
 * On first startup:
 *   - Generates a strong random key
 *   - Saves it to .env.local (should be in .gitignore)
 * 
 * On subsequent startups:
 *   - Loads the key from .env.local
 * 
 * Can be overridden by ENCRYPTION_KEY environment variable (for production deployments)
 * 
 * @returns {Buffer} 32-byte encryption key (derived via SHA-256)
 */
function loadOrGenerateEncryptionKey() {
  // Check if explicitly set via environment variable (takes precedence)
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    console.log('[Encryption] Using ENCRYPTION_KEY from environment variable');
    return crypto.createHash('sha256').update(envKey).digest();
  }

  // Check if .env.local exists with a saved key
  if (fs.existsSync(ENV_LOCAL_PATH)) {
    try {
      const content = fs.readFileSync(ENV_LOCAL_PATH, 'utf8');
      const match = content.match(/^ENCRYPTION_KEY=(.+)$/m);
      
      if (match && match[1]) {
        const key = match[1].trim();
        console.log('[Encryption] Using ENCRYPTION_KEY from .env.local');
        return crypto.createHash('sha256').update(key).digest();
      }
    } catch (err) {
      console.error('[Encryption] Error reading .env.local:', err.message);
      // Fall through to generate new key
    }
  }

  // Generate a new key and save it
  const rawKey = crypto.randomBytes(32).toString('base64');
  
  try {
    // Save to .env.local
    const envContent = `# GuestFlow Encryption Key (auto-generated)\n# Do NOT commit this file to git\nENCRYPTION_KEY=${rawKey}\n`;
    fs.writeFileSync(ENV_LOCAL_PATH, envContent, { mode: 0o600 }); // Restrict to user read/write only
    console.log('[Encryption] ✅ Generated new encryption key and saved to .env.local');
    console.log('[Encryption] ⚠️  Keep .env.local safe and never commit it to git');
  } catch (err) {
    console.error('[Encryption] Warning: Could not save key to .env.local:', err.message);
    console.log('[Encryption] Key will be lost on restart. Consider setting ENCRYPTION_KEY environment variable.');
  }

  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Get the current encryption key (for use in database encryption/decryption)
 * @returns {Buffer} 32-byte encryption key
 */
function getEncryptionKey() {
  return loadOrGenerateEncryptionKey();
}

module.exports = {
  loadOrGenerateEncryptionKey,
  getEncryptionKey,
};
