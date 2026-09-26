/**
 * Password length rules, shared by the server verifier (src/server/auth/password.ts) and the sign-in, register and
 * reset forms. Kept in its own dependency-free module because the verifier imports `node:crypto`: a client form that
 * imported the constant from there shipped a browser polyfill of Node's crypto (about 130 KB gzipped) to the welcome
 * page for two numbers.
 */
export const PASSWORD_RULES = {
  minLength: 10,
  maxLength: 200,
} as const;
