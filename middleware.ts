import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Gate the entire app behind a the observed system admin session.
 *
 * This is deny-by-default: everything except the login flow and static assets
 * requires a session. That ordering matters — an allow-list of protected routes
 * leaks every page someone forgets to add, and this app renders the observed system's
 * production invoices, payouts and payslips.
 *
 * The middleware only checks that a SESSION exists. The admin check needs a
 * database read, which is the layout's job via `getLabUser()` — middleware runs
 * on every request including static ones, and a query there would be a
 * per-asset round trip. So: middleware answers "are you logged in", the layout
 * answers "are you allowed".
 *
 * It also refreshes the session cookie on the way through, which is why
 * `getAll`/`setAll` are wired rather than just reading.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Unconfigured means the app cannot authenticate anyone. Fail CLOSED and send
  // everyone to /login, which explains what is missing — the alternative is an
  // unauthenticated production data browser because an env var was forgotten.
  if (!url || !anonKey) {
    if (request.nextUrl.pathname.startsWith("/login")) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: this revalidates the JWT rather than trusting the
  // cookie's contents.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth");

  if (!user && !isAuthRoute) {
    const redirect = new URL("/login", request.url);
    // Preserve where they were headed so the magic link lands them there.
    if (path !== "/") redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }

  if (user && path.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and the favicon. Deliberately
     * NOT excluding /api — those routes read the observed system production data and need
     * the same gate as the pages.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
