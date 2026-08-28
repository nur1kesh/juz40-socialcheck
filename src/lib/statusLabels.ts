import type { ApplicationStatus } from '@prisma/client';

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Толтырылуда',
  pending_review: 'Тексерілуде',
  approved: 'Мақұлданды',
  rejected: 'Қабылданбады',
};

export const BENEFIT_LABELS: Record<string, string> = {
  many_children_family: 'Көпбалалы отбасы',
  incomplete_family: 'Толық емес отбасы',
  disability: 'Мүгедектік жағдайы бар',
};
