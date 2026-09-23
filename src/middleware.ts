import { NextRequest, NextResponse } from 'next/server';

// Generates a per-request nonce so script-src can stay locked to 'self' +
// this nonce instead of 'unsafe-inline', while still allowing Next.js's own
// inline bootstrap/RSC scripts to run. See next.config.js for the other
// security headers.
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // Next.js dev mode's Fast Refresh relies on eval(); production builds don't need it.
  // For admin pages, we need to be more permissive since they handle sensitive operations
  const isAdminPath = req.nextUrl.pathname.startsWith('/admin');
  const scriptSrc = isAdminPath
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
        process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''
      };`;
  
  const csp = `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ${scriptSrc} frame-ancestors 'none'; base-uri 'self';`;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};

