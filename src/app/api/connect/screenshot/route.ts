import { NextRequest, NextResponse } from 'next/server';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, verifyFileSignature } from '@/lib/storage';
import { extractProfileFromScreenshot } from '@/lib/profileOcr';

const IMAGE_MIME_TYPES = ALLOWED_MIME_TYPES.filter((m) => m !== 'application/pdf');

// The screenshot itself is never persisted — it's processed in memory and
// discarded. Only the OCR-derived draft fields go back to the client, and
// even those are never trusted directly: the student must review/edit them
// before /api/connect/confirm creates a session.
export async function POST(req: NextRequest) {
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
