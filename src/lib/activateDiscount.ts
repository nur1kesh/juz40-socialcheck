import { prisma } from '@/lib/db';

export type ActivationSummary = {
  activated: string[];
  alreadyActivated: string[];
  noApprovedApplication: string[];
  notFound: string[];
  invalid: string[];
};

function emptySummary(): ActivationSummary {
  return { activated: [], alreadyActivated: [], noApprovedApplication: [], notFound: [], invalid: [] };
}

// Matches the "Excel ПФ" export back against the DB by email — that file's
// only job once it leaves this app is to tell the external billing system
// (Kaspi/the school's own ПФ system) who to actually turn the discount on
// for. Re-importing the same-shaped file (now confirmed by that external
// system) is how we learn it actually happened, since our own 'approved'
// status only ever meant our review passed, not that money is being
// discounted yet. One admin's re-upload of a stale or partial file is
// harmless: rows already marked activated are simply skipped, never
// re-timestamped or re-notified.
export async function activateDiscountsFromEmails(
  emails: string[],
  adminEmail: string,
): Promise<ActivationSummary> {
  const summary = emptySummary();

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      summary.invalid.push(raw.trim());
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }

  for (const email of normalized) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        applications: {
          where: { status: 'approved' },
          orderBy: { submittedAt: 'desc' },
          select: { id: true, discountActivatedAt: true },
        },
      },
    });
    if (!user) {
      summary.notFound.push(email);
      continue;
    }
    if (user.applications.length === 0) {
      summary.noApprovedApplication.push(email);
      continue;
    }
    const target = user.applications.find((a) => !a.discountActivatedAt);
    if (!target) {
      summary.alreadyActivated.push(email);
      continue;
    }

    // Compare-and-swap on discountActivatedAt: guards against two admins
    // importing overlapping spreadsheets at the same moment both reading
    // this row as un-activated and both writing — only the first write's
    // `count` comes back 1, matching the CAS pattern used everywhere else
    // status-like fields change (decideApplicationAdmin.ts, submit/route.ts).
    const activated = await prisma.$transaction(async (tx) => {
      const result = await tx.application.updateMany({
        where: { id: target.id, discountActivatedAt: null },
        data: { discountActivatedAt: new Date() },
      });
      if (result.count === 0) return false;
      await tx.applicationEvent.create({
        data: {
          applicationId: target.id,
          eventType: 'discount_activated',
          actor: `admin:${adminEmail}`,
        },
      });
      return true;
    });
    if (activated) {
      summary.activated.push(email);
    } else {
      summary.alreadyActivated.push(email);
    }
  }

  return summary;
}
