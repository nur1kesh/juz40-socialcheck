import { NextRequest, NextResponse } from 'next/server';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, verifyFileSignature } from '@/lib/storage';
import { extractProfileFromScreenshot } from '@/lib/profileOcr';
import { rateLimit } from '@/lib/rateLimit';

const IMAGE_MIME_TYPES = ALLOWED_MIME_TYPES.filter((m) => m !== 'application/pdf');

// The screenshot itself is never persisted — it's processed in memory and
// discarded. Only the OCR-derived draft fields go back to the client, and
// even those are never trusted directly: the student must review/edit them
// before /api/connect/confirm creates a session.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!rateLimit(`connect-screenshot:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Тым көп сұраныс' }, { status: 429 });
  }
  // The per-IP limit above is keyed on a client-controllable header
  // (X-Forwarded-For) with no reverse-proxy trust boundary configured, so
  // it's bypassable by an attacker who varies it per request. This endpoint
  // is unauthenticated and calls paid OpenAI vision on every hit — a fixed
  // site-wide daily ceiling bounds worst-case spend/abuse regardless of how
  // many distinct (real or spoofed) IPs a request comes from. 300/day is
  // generous for real onboarding traffic; tune if the school is larger.
  if (!rateLimit('connect-screenshot:daily-global', 300, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'Тым көп сұраныс. Ертең қайталаңыз.' }, { status: 429 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Файл жүктелмеді' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: 'Файл өлшемі 10 MB-тан аспауы керек.' }, { status: 400 });
  }
  if (!IMAGE_MIME_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Тек JPG немесе PNG скриншот қабылданады.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!verifyFileSignature(buffer, file.type)) {
    return NextResponse.json(
      { error: 'Құжат анық оқылмайды. Скриншоттың сапалы нұсқасын қайта жүктеңіз.' },
      { status: 400 },
    );
  }

  try {
    const extracted = await extractProfileFromScreenshot(buffer, file.type);
    return NextResponse.json({
      fullName: extracted.fullName,
      email: extracted.email,
      whatsapp: extracted.whatsapp,
    });
  } catch (e) {
    console.error('screenshot OCR failed', e);
    return NextResponse.json(
      { error: 'Скриншотты тану мүмкін болмады. Қайта көріңіз.' },
      { status: 502 },
    );
  }
}
