import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getCurrentAdmin } from '@/lib/adminSession';
import { activateDiscountsFromEmails } from '@/lib/activateDiscount';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

// Takes the same no-header "Excel ПФ" shape this app exports (see
// admin/export/route.ts's `format=pf` branch) — column A is the student's
// email, the rest (subject, discount %, limit) is whatever the external
// billing system round-tripped back and isn't needed here, since the only
// question this endpoint answers is "which of these emails now have a live
// discount". See activateDiscount.ts for the matching/update logic itself.
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Файл таңдалмады' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Тек .xlsx файлы қабылданады' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Файл өлшемі 5 MB-тан аспауы керек' }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: 'Файлды оқу мүмкін болмады — Excel форматы дұрыс па тексеріңіз' }, { status: 400 });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return NextResponse.json({ error: 'Файлда парақ табылмады' }, { status: 400 });
  }
  if (sheet.rowCount > MAX_ROWS) {
    return NextResponse.json({ error: `Файлда тым көп жол бар (максимум ${MAX_ROWS})` }, { status: 400 });
  }

  const emails: string[] = [];
  sheet.eachRow((row) => {
    const cell = row.getCell(1).value;
    const email = typeof cell === 'string' ? cell : cell && typeof cell === 'object' && 'text' in cell ? String(cell.text) : '';
    if (email) emails.push(email);
  });

  if (emails.length === 0) {
    return NextResponse.json({ error: 'Файлда email табылмады' }, { status: 400 });
  }

  const summary = await activateDiscountsFromEmails(emails, admin.email);

  return NextResponse.json({ summary });
}
