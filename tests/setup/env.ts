import "dotenv/config";

// Vitest sets NODE_ENV=test. These are test-only fallbacks so the suite runs without a .env file.
process.env.CONTACT_HASH_SALT ??= "test-contact-salt-0123456789abcdef0123456789abcdef";
process.env.SESSION_SECRET ??= "test-session-secret-0123456789abcdef0123456789abcdef";
process.env.OTP_PEPPER ??= "test-otp-pepper-0123456789abcdef0123456789abcdef";
