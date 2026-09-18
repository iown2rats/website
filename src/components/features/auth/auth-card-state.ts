/**
 * The sign-in card's mode machine (DESIGN_SYSTEM §27). The card is one container that switches between signing in
 * and creating an account in place — it never navigates to a differently-shaped page — so the rules for what is on
 * screen live here as pure data and the component below is only a renderer. Keeping them separate is what makes the
 * switching behaviour testable without a browser.
 */
export type AuthCardMode = "signin" | "register";
export type AuthField = "email" | "password" | "confirmPassword";

export interface AuthCardState {
  mode: AuthCardMode;
  error: { message: string; field?: AuthField } | null;
  /** Set once registration has been accepted: the address the confirmation went to. */
  sentTo: string | null;
  busy: boolean;
}

export type AuthCardEvent =
  | { type: "switchMode"; mode: AuthCardMode }
  | { type: "submit" }
  | { type: "failed"; message: string; field?: AuthField }
  | { type: "registered"; email: string };

export const initialAuthCardState = (mode: AuthCardMode = "signin"): AuthCardState => ({ mode, error: null, sentTo: null, busy: false });

/** Which inputs each mode shows, in order. */
export const FIELDS: Record<AuthCardMode, readonly AuthField[]> = {
  signin: ["email", "password"],
  register: ["email", "password", "confirmPassword"],
};

/** The coral primary action, and the line under it that swaps modes. */
export const MODE_COPY: Record<AuthCardMode, { submit: string; busy: string; prompt: string; action: string; to: AuthCardMode }> = {
  signin: { submit: "Continue", busy: "Signing in…", prompt: "New to Mellocrush?", action: "Create account", to: "register" },
  register: { submit: "Create account", busy: "Creating…", prompt: "Already have an account?", action: "Sign in", to: "signin" },
};

export function authCardReducer(state: AuthCardState, event: AuthCardEvent): AuthCardState {
  switch (event.type) {
    case "switchMode":
      // Switching is also how someone escapes a failed attempt, so it always starts clean. Switching to the mode
      // already on screen changes nothing, so a stray click cannot wipe an error the person is still reading.
      if (event.mode === state.mode) return state;
      return { mode: event.mode, error: null, sentTo: null, busy: false };
    case "submit":
      return { ...state, busy: true, error: null };
    case "failed":
      return { ...state, busy: false, error: { message: event.message, field: event.field } };
    case "registered":
      // A new account is redirected to the verification screen by the server action; this state is for an address
      // that already had one, which must look identical so the card never reveals which addresses exist.
      return { ...state, busy: false, error: null, sentTo: event.email };
  }
}
