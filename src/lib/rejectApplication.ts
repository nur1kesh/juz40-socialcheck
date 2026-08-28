import { prisma } from '@/lib/db';
import { deleteDocumentFile } from '@/lib/storage';

// Called whenever an application resolves to 'rejected' — auto-decision at
// submit time, or an admin's manual reject. Rejected applications get no
// discount, so there's no reason to keep the uploaded document images
// (personal data) around; only the Application row + its event history
// stay, for audit ("who applied and was rejected on date X").
export async function purgeRejectedDocuments(applicationId: string): Promise<void> {
  const documents = await prisma.document.findMany({
    where: { applicationId },
    select: { id: true, filePath: true },
  });

  await Promise.all(documents.map((d) => deleteDocumentFile(d.filePath)));
  await prisma.document.deleteMany({ where: { applicationId } });
}
