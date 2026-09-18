/**
 * Domain errors. Server actions map these to UI states; nothing else is thrown across the boundary.
 * Every error carries a stable `code` so the client never has to parse messages.
 */

export type DomainErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "INVALID_STATE"
  | "ENTITLEMENT_REQUIRED"
  | "LIKE_LIMIT_REACHED"
  | "MESSAGE_COOLDOWN"
  | "MESSAGE_RATE_LIMIT"
  | "BOOST_LIMIT_REACHED"
  | "BOOST_ALREADY_ACTIVE"
  | "UNDO_UNAVAILABLE";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

/** Used for anything the actor may not see or that does not exist. Never confirms existence. */
export class NotFoundError extends DomainError {
  constructor(what = "Resource") {
    super("NOT_FOUND", `${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION", message);
    this.name = "ValidationError";
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super("INVALID_STATE", message);
    this.name = "InvalidStateError";
  }
}

export class EntitlementRequiredError extends DomainError {
  readonly feature: string;
  constructor(feature: string) {
    super("ENTITLEMENT_REQUIRED", `${feature} requires Mellocrush Plus`);
    this.name = "EntitlementRequiredError";
    this.feature = feature;
  }
}

export class LikeLimitReachedError extends DomainError {
  readonly limit: number;
  readonly resetsAt: Date;
  constructor(limit: number, resetsAt: Date) {
    super("LIKE_LIMIT_REACHED", `You've used today's ${limit} likes`);
    this.name = "LikeLimitReachedError";
    this.limit = limit;
    this.resetsAt = resetsAt;
  }
}

export class MessageCooldownError extends DomainError {
  readonly availableAt: Date;
  constructor(availableAt: Date) {
    super("MESSAGE_COOLDOWN", "Your next free message is not available yet");
    this.name = "MessageCooldownError";
    this.availableAt = availableAt;
  }
}

export class MessageRateLimitError extends DomainError {
  constructor() {
    super("MESSAGE_RATE_LIMIT", "You're sending messages too quickly");
    this.name = "MessageRateLimitError";
  }
}

export class BoostLimitReachedError extends DomainError {
  readonly limit: number;
  readonly resetsAt: Date;
  constructor(limit: number, resetsAt: Date) {
    super("BOOST_LIMIT_REACHED", "No boosts left this week");
    this.name = "BoostLimitReachedError";
    this.limit = limit;
    this.resetsAt = resetsAt;
  }
}

export class BoostAlreadyActiveError extends DomainError {
  readonly endsAt: Date;
  constructor(endsAt: Date) {
    super("BOOST_ALREADY_ACTIVE", "A boost is already active");
    this.name = "BoostAlreadyActiveError";
    this.endsAt = endsAt;
  }
}

export class UndoUnavailableError extends DomainError {
  constructor(reason: string) {
    super("UNDO_UNAVAILABLE", reason);
    this.name = "UndoUnavailableError";
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
