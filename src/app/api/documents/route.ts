import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  extensionForMime,
  saveDocumentFile,
  verifyFileSignature,
  deleteDocumentFile,
} from '@/lib/storage';
import { runOcr, namesLikelyMatch } from '@/lib/ocr';
import { rateLimit } from '@/lib/rateLimit';
import { isPastAlmatyDay } from '@/lib/timezone';

const CONFIDENCE_THRESHOLD = 0.75;

const CATEGORY_LABELS: Record<string, string> = {
  // Must be one of two specific eGov-style electronic cards (same blue
  // gradient template, both carry ЖСН/ИИН + full name + validity dates):
  // 1) "SOC-ID" card — large "SOC-ID" title/logo, "Мәртебе/Статус" field
  //    reading either "Көпбалалы отбасылар/Многодетные семьи" or "Көп
  //    балалы отбасы мүшесі/Член многодетной семьи" (two real wordings
  //    eGov has issued for the same underlying status — both count),
  //    "Басталған кезі — Дата начала" / "Аяқталатын кезі — Дата
  //    окончания" dates.
  // 2) "Көп балалы отбасыға берілетін жәрдемақы алушысы / Получатель
  //    пособия многодетной семьи" card — same template, "Берілген
  //    күні/дата выдачи" / "Аяқталған күні/дата окончания" dates, plus an
  //    "Отбасы құрамы/Состав семьи" list of children with their ЖСН.
  // Any other kind of document (paper certificate, akimat reference,
  // differently formatted proof) does NOT count, even if it plausibly
  // proves multi-child status — the model is told this explicitly so
  // matchesExpectedCategory comes back false for anything that isn't one
  // of these two cards.
  //
  // A third, explicitly-rejected trap: the exact same SOC-ID template also
  // gets issued for "Алтын алқа"/"Күміс алқа" pendants, a former "Батыр
  // ана" title, or "Ана даңқы" I/II degree orders — a state award for
  // mothers historically recognized for having many children, NOT the
  // "Көпбалалы отбасы" (multi-child family benefit) status this app
  // grants a discount for. Same card design, same ЖСН/dates layout, only
  // the Мәртебе/Статус text differs — so the model has to actually read
  // that field rather than pattern-match on the template, or it'll accept
  // an award card as if it were the benefit-status card.
  many_children_family:
    'нақ осы екі электрондық картаның бірі: 1) "SOC-ID" картасы — үлкен "SOC-ID" деген тақырыппен, "Мәртебе/Статус" өрісінде НАҚ "Көпбалалы отбасылар/Многодетные семьи" НЕМЕСЕ "Көп балалы отбасы мүшесі/Член многодетной семьи" деп жазылған (екеуі де бір мәртебенің eGov-тің әртүрлі нұсқаларындағы жазылуы, екеуі де жарамды), "Басталған кезі — Дата начала" / "Аяқталатын кезі — Дата окончания" мерзімдерімен; 2) "Көп балалы отбасыға берілетін жәрдемақы алушысы / Получатель пособия многодетной семьи" картасы — "Берілген күні/дата выдачи" / "Аяқталған күні/дата окончания" мерзімдерімен және "Отбасы құрамы/Состав семьи" бөлімінде балалардың тізімімен. Екеуі де ЖСН/ИИН және аты-жөні бар бірдей көк градиентті шаблон. Басқа пішіндегі құжат (қағаз анықтама, әкімшілік анықтама, өзге формат) — тіпті көпбалалы мәртебені растаса да — бұл санатқа сай КЕЛМЕЙДІ. Аса маңызды: дәл осындай SOC-ID шаблонындағы, бірақ "Мәртебе/Статус" өрісінде "Алтын алқа", "Күміс алқа", "Батыр ана" атағы немесе "Ана даңқы" ордені деп жазылған карта — бұл МҮЛДЕМ БАСҚА мәртебе (аналарды марапаттау), "Көпбалалы отбасылар" мәртебесі ЕМЕС, сондықтан бұл санатқа сай КЕЛМЕЙДІ (matchesExpectedCategory: false), тіпті мәтінде "көп балалы аналар" деген сөз кездессе де. Мәртебе өрісінде нақ "Көпбалалы отбасылар", "Многодетные семьи", "Көп балалы отбасы мүшесі" немесе "Член многодетной семьи" деген тіркестердің бірі тұрмаса — қабылдама.',
  incomplete_family: 'толық емес отбасы (ажырасу немесе қайтыс болған ата-ана) құжаты',
  disability: 'мүгедектік жағдайын растайтын құжат',
  student_certificate: '18 жастан асқан оқушы бала үшін оқу орнынан анықтама',
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  // This is the one endpoint on the whole site that calls a paid OpenAI
  // vision request per hit — keyed by user, not IP, since it's already
  // authenticated and IP-sharing (NAT, campus wifi) shouldn't tighten it.
  if (!rateLimit(`documents:${user.id}`, 15, 10 * 60_000)) {
    return NextResponse.json({ error: 'Тым көп сұраныс. Сәл кейін қайталаңыз.' }, { status: 429 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');
  const applicationId = formData?.get('applicationId');
  const documentType = formData?.get('documentType');

  if (
    !(file instanceof File) ||
    typeof applicationId !== 'string' ||
    typeof documentType !== 'string' ||
    !CATEGORY_LABELS[documentType]
  ) {
    return NextResponse.json({ error: 'Деректер форматы дұрыс емес' }, { status: 400 });
  }

  const application = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!application || application.userId !== user.id) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }
  if (application.status !== 'draft') {
    return NextResponse.json({ error: 'Бұл өтінімге құжат қосуға болмайды.' }, { status: 409 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: 'Файл өлшемі 10 MB-тан аспауы керек.' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Қолдау көрсетілмейтін файл түрі.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!verifyFileSignature(buffer, file.type)) {
    return NextResponse.json(
      { error: 'Құжат анық оқылмайды. Құжаттың сапалы нұсқасын қайта жүктеңіз.' },
      { status: 400 },
    );
  }

  const storageKey = await saveDocumentFile(buffer, extensionForMime(file.type));
  const ocr = await runOcr(buffer, file.type, CATEGORY_LABELS[documentType]!, {
    applicationId: application.id,
    documentType,
  });

  const confident = ocr.isReadable && ocr.confidence >= CONFIDENCE_THRESHOLD;

  // runOcr just spent several seconds awaiting OpenAI — re-check the
  // application wasn't submitted/decided out from under us in the
  // meantime (another tab, a slow first upload racing a second). Without
  // this, a document could land on an application that's already
  // approved/rejected without ever having gone through decideAutomatically.
  const stillDraft = await prisma.application.findUnique({
    where: { id: application.id },
    select: { status: true },
  });
  if (stillDraft?.status !== 'draft') {
    await deleteDocumentFile(storageKey);
    return NextResponse.json({ error: 'Бұл өтінімге құжат қосуға болмайды.' }, { status: 409 });
  }

  // Re-uploading the same document slot (student replacing a blurry photo,
  // or resuming a draft) should replace the old row, not add a second one
  // — otherwise decision logic that does `.find()` for a given
  // documentType picks an arbitrary one of several. The delete+create is
  // wrapped in one transaction so two concurrent uploads of the same slot
  // (double-click, two tabs) can't both pass `findFirst` and both create —
  // the DB's `@@unique([applicationId, documentType])` makes the loser's
  // `create` fail instead of silently leaving two rows of the same type.
  const existing = await prisma.document.findFirst({
    where: { applicationId: application.id, documentType },
    select: { id: true, filePath: true },
  });

  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.document.delete({ where: { id: existing.id } });
      }
      return tx.document.create({
        data: {
          applicationId: application.id,
          documentType,
          filePath: storageKey,
          originalFilename: file.name,
          mimeType: file.type,
          fileSize: file.size,
          documentIssueDate: ocr.issueDate,
          documentExpiryDate: ocr.expiryDate,
          ocrStatus: confident ? 'pending' : 'needs_manual_review',
          verificationStatus: !confident
            ? 'pending'
            : ocr.matchesExpectedCategory === false
              ? 'rejected'
              : ocr.matchesExpectedCategory === true
                ? 'verified'
                : 'pending',
          ocrExtractedName: ocr.extractedFullName,
          nameMatchesProfile: confident ? namesLikelyMatch(user.fullName, ocr.extractedFullName) : null,
        },
      });
    });
  } catch (e) {
    // The just-saved file was never referenced by any row that survived —
    // clean it up rather than leaking it on disk.
    await deleteDocumentFile(storageKey);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json(
        { error: 'Бұл құжат түрі дәл қазір жүктелуде. Сәл кейін қайталаңыз.' },
        { status: 409 },
      );
    }
    throw e;
  }

  if (existing) {
    await deleteDocumentFile(existing.filePath).catch(() => {});
  }

  const expiryStatus: 'valid' | 'expired' | 'unknown' = !ocr.expiryDate
    ? 'unknown'
    : isPastAlmatyDay(ocr.expiryDate)
      ? 'expired'
      : 'valid';

  // The full OCR read is returned alongside the saved document — the
  // frontend shows a friendly summary of it immediately (real-time
  // feedback), not just the subset persisted on the Document row.
  return NextResponse.json({
    document,
    ocr: {
      isReadable: ocr.isReadable,
      extractedFullName: ocr.extractedFullName,
      issueDate: ocr.issueDate,
      expiryDate: ocr.expiryDate,
      documentTypeGuess: ocr.documentTypeGuess,
      confidence: ocr.confidence,
      matchesExpectedCategory: ocr.matchesExpectedCategory,
      expiryStatus,
    },
  });
}
