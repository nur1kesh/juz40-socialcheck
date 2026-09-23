import { NextRequest, NextResponse } from 'next/server';

// Generates a per-request nonce so script-src can stay locked to 'self' +
// this nonce instead of 'unsafe-inline', while still allowing Next.js's own
// inline bootstrap/RSC scripts to run. See next.config.js for the other
// security headers.
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // For admin pages, we need to allow inline scripts without nonce
  // (Next.js inline scripts don't have nonce attributes)
  const isAdminPath = req.nextUrl.pathname.startsWith('/admin');
  
  let scriptSrc: string;
  let csp: string;
  
  if (isAdminPath) {
    // Admin pages: allow inline scripts and external scripts
    scriptSrc = `script-src 'self' 'unsafe-inline';`;
    csp = `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ${scriptSrc} frame-ancestors 'none'; base-uri 'self';`;
  } else {
    // Public pages: strict CSP with nonce
    scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''
    };`;
    csp = `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ${scriptSrc} frame-ancestors 'none'; base-uri 'self';`;
  }

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

