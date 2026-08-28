import type { BenefitType } from '@prisma/client';

// One benefit selected -> 10% discount. Two or more -> 15% (flat — no
// tier beyond that, since there are only 3 benefit categories total).
export function discountPercentFor(benefitTypes: BenefitType[]): number {
  return benefitTypes.length >= 2 ? 15 : 10;
}
