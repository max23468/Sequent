import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cookies } from "@sveltejs/kit";
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from "../../src/lib/server/auth.ts";
import {
  deleteSessionCookie,
  sessionCookieOptions,
  setSessionCookie,
} from "../../src/lib/server/session-cookie.ts";

afterEach(() => vi.unstubAllEnvs());

describe("persistenza della sessione nel browser", () => {
  it("imposta una scadenza esplicita di dodici mesi anche in Production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const now = new Date("2026-08-31T10:00:00.000Z");

    expect(sessionCookieOptions(now)).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      maxAge: SESSION_COOKIE_MAX_AGE,
      expires: new Date(now.getTime() + SESSION_COOKIE_MAX_AGE * 1_000),
    });
  });

  it("usa la stessa policy per login, setup, auto-login e rinnovo", () => {
    vi.stubEnv("NODE_ENV", "test");
    const set = vi.fn();
    const cookies = { set } as unknown as Cookies;
    const now = new Date("2026-08-31T10:00:00.000Z");

    setSessionCookie(cookies, "token-sintetico", now);

    expect(set).toHaveBeenCalledWith(SESSION_COOKIE, "token-sintetico", {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      maxAge: SESSION_COOKIE_MAX_AGE,
      expires: new Date(now.getTime() + SESSION_COOKIE_MAX_AGE * 1_000),
    });
  });

  it("rimuove il cookie sullo stesso percorso al logout", () => {
    const remove = vi.fn();
    const cookies = { delete: remove } as unknown as Cookies;

    deleteSessionCookie(cookies);

    expect(remove).toHaveBeenCalledWith(SESSION_COOKIE, { path: "/" });
  });
});
