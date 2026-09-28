import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { describeError, getLanguage } from "../../src/lib/i18n";
import { ApiClientError } from "../../src/lib/api";

describe("user-facing errors", () => {
  beforeEach(() => localStorage.setItem("owncord:language", "ru"));
  afterEach(() => localStorage.removeItem("owncord:language"));
  it("explains rejected credentials and preserves the technical server message", () => {
    const error = new ApiClientError(401, "UNAUTHORIZED", "invalid credentials");
    expect(error.message).toContain("Неверное имя пользователя или пароль");
    expect(error.serverMessage).toBe("invalid credentials");
    expect(error.status).toBe(401);
  });
  it("distinguishes expired sessions, unavailable voice and busy calls", () => {
    expect(describeError("invalid or expired session", "UNAUTHORIZED")).toContain("Сеанс истёк");
    expect(describeError("voice is not configured on this server", "VOICE_ERROR")).toContain("настроить LiveKit");
    expect(describeError("recipient is busy", "CALL_BUSY")).toContain("Попробуйте позже");
    expect(describeError(new TypeError("Failed to fetch"))).toContain("интернет или VPN");
  });
  it("does not expose an unrecognized server diagnostic to the user", () => {
    const result = describeError("SQLite failure: /private/database", "UNEXPECTED_ERROR");
    expect(result).not.toContain("/private/database");
    expect(result).toContain("UNEXPECTED_ERROR");
  });
  it("honors an explicit English preference", () => {
    localStorage.setItem("owncord:language", "en");
    expect(getLanguage()).toBe("en");
    expect(describeError("invalid credentials")).toBe("invalid credentials");
  });
});
