"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionErrorResult, mapActionError } from "@/app/_lib/map-errors";
import { identity } from "@/composition/container";
import { establishLogin } from "./session";

export interface AuthActionState {
  error?: ActionErrorResult["error"];
}

export async function login(
  next: string | null,
  _previous: AuthActionState,
  data: FormData,
): Promise<AuthActionState> {
  let destination: string;
  try {
    const requestHeaders = await headers();
    const jar = await cookies();
    const result = await identity.login.execute(
      {
        login: data.get("login"),
        password: data.get("password"),
        ip: identity.getClientIp(requestHeaders.get("x-forwarded-for")),
      },
      jar.get(identity.sessionCookie.name)?.value,
    );
    destination = await establishLogin(result, next);
  } catch (error) {
    return { error: mapActionError(error).error };
  }
  redirect(destination);
}

export async function logout(
  _previous: AuthActionState,
): Promise<AuthActionState> {
  try {
    const jar = await cookies();
    await identity.logout.execute(jar.get(identity.sessionCookie.name)?.value);
    jar.set(
      identity.sessionCookie.name,
      "",
      identity.sessionCookie.options(new Date(0).toISOString()),
    );
  } catch (error) {
    return { error: mapActionError(error).error };
  }
  redirect("/login");
}
