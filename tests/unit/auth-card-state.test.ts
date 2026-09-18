/**
 * The sign-in card's mode machine (docs/DESIGN_SYSTEM.md §27). The card switches between signing in and creating an
 * account inside the same container, so these are the rules that decide what is on screen and what survives a
 * switch. The component is a renderer over this reducer.
 */
import { describe, expect, it } from "vitest";
import { authCardReducer, FIELDS, initialAuthCardState, MODE_COPY, type AuthCardState } from "@/components/features/auth/auth-card-state";

const run = (state: AuthCardState, ...events: Parameters<typeof authCardReducer>[1][]) => events.reduce(authCardReducer, state);

describe("auth card mode machine", () => {
  it("starts in the mode it was opened with", () => {
    expect(initialAuthCardState()).toEqual({ mode: "signin", error: null, sentTo: null, busy: false });
    expect(initialAuthCardState("register")).toMatchObject({ mode: "register" });
  });

  it("switches between signing in and creating an account, and back", () => {
    const signin = initialAuthCardState();
    const register = authCardReducer(signin, { type: "switchMode", mode: "register" });
    expect(register.mode).toBe("register");
    expect(authCardReducer(register, { type: "switchMode", mode: "signin" }).mode).toBe("signin");
  });

  it("each mode shows its own fields and its own coral action", () => {
    expect(FIELDS.signin).toEqual(["email", "password"]);
    expect(FIELDS.register).toEqual(["email", "password", "confirmPassword"]);
    expect(MODE_COPY.signin).toMatchObject({ submit: "Continue", prompt: "New to Mellocrush?", action: "Create account", to: "register" });
    expect(MODE_COPY.register).toMatchObject({ submit: "Create account", prompt: "Already have an account?", action: "Sign in", to: "signin" });
    // The two switch links point at each other, so the card can always get back.
    expect(MODE_COPY[MODE_COPY.signin.to].to).toBe("signin");
  });

  it("switching clears a failed attempt and any busy state, so the other mode opens clean", () => {
    const failed = run(initialAuthCardState(), { type: "submit" }, { type: "failed", message: "That email and password don't match an account.", field: "password" });
    expect(failed).toMatchObject({ busy: false, error: { field: "password" } });
    const switched = authCardReducer(failed, { type: "switchMode", mode: "register" });
    expect(switched).toEqual({ mode: "register", error: null, sentTo: null, busy: false });
  });

  it("switching to the mode already on screen changes nothing, so a stray click cannot wipe an error being read", () => {
    const failed = run(initialAuthCardState(), { type: "submit" }, { type: "failed", message: "Wrong" });
    expect(authCardReducer(failed, { type: "switchMode", mode: "signin" })).toBe(failed);
  });

  it("submitting clears the previous error and marks the card busy; a failure releases it", () => {
    const busy = run(initialAuthCardState(), { type: "failed", message: "Old error" }, { type: "submit" });
    expect(busy).toMatchObject({ busy: true, error: null });
    expect(authCardReducer(busy, { type: "failed", message: "New error", field: "email" })).toMatchObject({ busy: false, error: { message: "New error", field: "email" } });
  });

  it("an accepted registration shows the check-your-email state, and leaving it returns to signing in", () => {
    const sent = run(initialAuthCardState("register"), { type: "submit" }, { type: "registered", email: "someone@example.com" });
    expect(sent).toMatchObject({ sentTo: "someone@example.com", busy: false, error: null, mode: "register" });
    const back = authCardReducer(sent, { type: "switchMode", mode: "signin" });
    expect(back).toEqual({ mode: "signin", error: null, sentTo: null, busy: false });
  });
});
