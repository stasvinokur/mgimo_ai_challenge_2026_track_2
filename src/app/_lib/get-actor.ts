import "server-only";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { identity } from "@/composition/container";
import { appPath } from "@/ui/shared/app-path.mjs";

type GuardOptions = { routeHandler?: boolean };

function loginRedirect(path: string, options: GuardOptions): never {
  // Pages/actions add basePath in Next; route handlers return Location verbatim.
  redirect(options.routeHandler ? appPath(path) : path);
}

export const getActor = cache(async () => {
  const token = (await cookies()).get(identity.sessionCookie.name)?.value;
  return (await identity.getCurrentActor.execute(token))?.actor ?? null;
});

export async function requireStudent(options: GuardOptions = {}) {
  const actor = await getActor();
  if (!actor) loginRedirect("/login", options);
  if (actor.kind === "teacher") loginRedirect("/teacher", options);
  if (actor.kind !== "student") loginRedirect("/staff/requests", options);
  return actor;
}

export async function requireStaff(options: GuardOptions = {}) {
  const actor = await getActor();
  if (!actor) loginRedirect("/login", options);
  if (actor.kind !== "staff") forbidden();
  return actor;
}

export async function requireTeacher(options: GuardOptions = {}) {
  const actor = await getActor();
  if (!actor) loginRedirect("/login", options);
  if (actor.kind !== "teacher") forbidden();
  return actor;
}
