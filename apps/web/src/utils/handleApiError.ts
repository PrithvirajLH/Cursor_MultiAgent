import { ApiError } from "../api/client";

/**
 * What Nest sends when a refusal carries no sentence of its own.
 *
 * `new ForbiddenException()` bodies read "Forbidden", and the roles guard's
 * read "Forbidden resource". Neither tells a person anything, so both fall back
 * to our own wording rather than being quoted onto the screen.
 */
const NEST_DEFAULT_MESSAGES = new Set(["Forbidden", "Forbidden resource"]);

/**
 * The sentence the server wrote for a person, or null if it did not write one.
 *
 * The API returns `{ message }` as either a string or, from class-validator, an
 * array of them.
 */
function serverSentence(error: ApiError): string | null {
  try {
    const parsed = JSON.parse(error.message) as {
      message?: string | string[];
    };
    if (Array.isArray(parsed?.message)) {
      const messages = parsed.message.filter(
        (message): message is string =>
          typeof message === "string" && message.trim().length > 0,
      );
      if (messages.length > 0) {
        return messages.join(". ");
      }
    }
    if (typeof parsed?.message === "string" && parsed.message.trim()) {
      return NEST_DEFAULT_MESSAGES.has(parsed.message.trim())
        ? null
        : parsed.message;
    }
  } catch {
    // Not JSON - the raw text is handled by the caller.
  }
  return null;
}

/**
 * Centralized error handler that produces user-friendly messages
 * based on error type and HTTP status codes.
 */
export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Your session has expired. Please refresh.";
    if (error.status === 403) {
      // ⚠️ CARD 1.132. A 403 IS A DELIBERATE REFUSAL, SO IT IS QUOTED.
      //
      // This branch used to discard the body and print "You do not have
      // permission to perform this action." for every one of them. An owner
      // adding another owner to a team therefore read a sentence that was both
      // generic and WRONG - they have permission; the person they picked is
      // ineligible - while the server was saying exactly that, in a sentence
      // card 1.126 wrote for a human and an integration test asserts on
      // (`teams.spec.ts:282`).
      //
      // ⚠️ 403 IS QUOTED AND 404 IS NOT, AND THAT ASYMMETRY IS THE WHOLE RULE.
      // This codebase hides a record's EXISTENCE with 404, never with 403 -
      // `listMessages` says so outright: "non-owners get 404, never 403, so the
      // ticket's existence is not revealed". So every 403 body is a refusal
      // already written to be read, and none of the 27 sites that throw one
      // names a record the caller could not already name. Quoting 404 would
      // undo the concealment; quoting 403 completes it.
      //
      // ⚠️ This is card 1.107's line held, not moved: a deliberate refusal is
      // quoted, an internal failure is not. 5xx below is untouched.
      return (
        serverSentence(error) ??
        "You do not have permission to perform this action."
      );
    }
    if (error.status === 404) return "The requested resource was not found.";
    if (error.status === 409)
      return "A conflict occurred. Please refresh and try again.";
    if (error.status === 422)
      return error.message || "Invalid data. Please check your input.";
    if (error.status >= 500) return "Server error. Please try again later.";
    return (
      serverSentence(error) || error.message || "An unexpected error occurred."
    );
  }

  if (
    error instanceof TypeError &&
    /fetch|network|failed/i.test(error.message)
  ) {
    return "Network error. Please check your connection.";
  }

  if (error instanceof Error) {
    return error.message || "An unexpected error occurred.";
  }

  return "An unexpected error occurred.";
}
