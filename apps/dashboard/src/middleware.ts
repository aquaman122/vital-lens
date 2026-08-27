import { NextResponse, type NextRequest } from 'next/server';

/**
 * HTTP Basic 인증 — 대시보드는 자체 로그인이 없고 수집 데이터를 그대로 보여준다.
 * Vercel의 Password Protection은 유료 플랜 기능이라 Hobby에서는 쓸 수 없어서,
 * 플랜과 무관하게 도는 최소한의 문을 앱 안에 둔다.
 *
 * 운영 원칙: 비밀번호가 없으면 열지 않는다(fail closed).
 * `DASHBOARD_PASSWORD`가 비어 있으면 프로덕션에서는 503으로 막고,
 * 개발 서버에서는 통과시킨다 — 로컬에서 매번 입력하게 만들 이유가 없다.
 */

const REALM = 'vital-lens';

/** 길이·내용 노출을 줄이기 위한 상수 시간 비교. */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      // 인증 페이지가 캐시되거나 색인되지 않게
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export function middleware(req: NextRequest): NextResponse {
  const password = process.env.DASHBOARD_PASSWORD;
  const user = process.env.DASHBOARD_USER || 'vital-lens';

  if (!password) {
    if (process.env.NODE_ENV === 'development') return NextResponse.next();
    return new NextResponse('DASHBOARD_PASSWORD 미설정 — 대시보드를 열지 않습니다', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    let decoded = '';
    try {
      decoded = atob(header.slice(6));
    } catch {
      return unauthorized();
    }
    const sep = decoded.indexOf(':');
    const gotUser = sep === -1 ? '' : decoded.slice(0, sep);
    const gotPass = sep === -1 ? '' : decoded.slice(sep + 1);
    // 두 비교를 모두 수행해 사용자명 불일치로 조기 반환하지 않는다.
    const ok = timingSafeEqual(gotUser, user) && timingSafeEqual(gotPass, password);
    if (ok) return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  // 정적 자산과 favicon은 인증 대상에서 제외 — 페이지·데이터 경로만 막는다.
  // vital-lens.min.js 는 Framer 등 외부 사이트가 <script src>로 가져가는 공개 배포물이라
  // 인증 뒤에 두면 수집 자체가 불가능하다. 수집 데이터가 아니라 수집기 코드일 뿐이므로 공개해도 안전.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|vital-lens\\.min\\.js).*)'],
};
