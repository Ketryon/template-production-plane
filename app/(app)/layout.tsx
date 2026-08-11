import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPlaneUser } from "@/lib/auth";

/**
 * The admin check. COPY VERBATIM.
 *
 * The split matters. middleware.ts answers "are you logged in" — cheap, and it
 * runs on every request including static assets, so a database read there would
 * be a per-asset round trip. This layout answers "are you allowed", once per
 * render. Middleware alone is not authorization; this alone is not a gate.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getPlaneUser();
  if (!user) redirect("/login");
  return <>{children}</>;
}
