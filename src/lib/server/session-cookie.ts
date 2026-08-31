import type { Cookies } from "@sveltejs/kit";
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from "./auth.ts";
import { useSecureCookies } from "./config.ts";

type CookieOptions = Parameters<Cookies["set"]>[2];

export function sessionCookieOptions(now = new Date()): CookieOptions {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: useSecureCookies(),
    maxAge: SESSION_COOKIE_MAX_AGE,
    expires: new Date(now.getTime() + SESSION_COOKIE_MAX_AGE * 1_000),
  };
}

export function setSessionCookie(cookies: Cookies, token: string, now = new Date()): void {
  cookies.set(SESSION_COOKIE, token, sessionCookieOptions(now));
}

export function deleteSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}
