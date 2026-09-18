import { z } from "zod";
import { PASSWORD_RULES } from "@/server/auth/password";

/**
 * Email + password input (docs/ARCHITECTURE.md §4.1b). Addresses are normalised the conservative way — trimmed and
 * lowercased — and nothing else: stripping dots or `+tags` would silently merge addresses that many providers treat
 * as different people.
 */
export const EMAIL_MAX = 254;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(EMAIL_MAX)
  .transform(normalizeEmail)
  .refine((v) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v), { message: "Enter a valid email address." });

const passwordField = z.string().min(1).max(PASSWORD_RULES.maxLength + 1);

export const registerSchema = z
  .object({ email: emailSchema, password: passwordField, confirmPassword: passwordField })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Both passwords must match." });

export const loginSchema = z.object({ email: emailSchema, password: passwordField });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z
  .object({ token: z.string().min(16).max(200), password: passwordField, confirmPassword: passwordField })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Both passwords must match." });
export const changeEmailSchema = z.object({ email: emailSchema });
export const passwordReauthSchema = z.object({ password: passwordField });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
