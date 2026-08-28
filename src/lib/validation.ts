import { z } from 'zod';

// Shared between server-side zod schemas (connect/confirm) and client-side
// inline field validation (ScreenshotConnect) — one definition of "what a
// valid name/email/phone looks like".

// Digits only, no spaces/dashes — "+7" followed by exactly 10 digits.
export const KZ_PHONE_REGEX = /^\+7\d{10}$/;
// At least two words (ФИО), letters only per word (allows hyphenated surnames).
export const FULL_NAME_REGEX =
  /^[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]+(?:[\s-][A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]+)+$/;

export const profileFieldsSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Аты-жөнін толтырыңыз')
    .max(200)
    .regex(FULL_NAME_REGEX, 'Аты-жөні кемінде екі сөзден тұруы керек'),
  email: z.string().trim().toLowerCase().max(200).email('Email дұрыс емес'),
  whatsapp: z
    .string()
    .trim()
    .regex(KZ_PHONE_REGEX, 'Телефон +7XXXXXXXXXX форматында, тек сандар болуы керек'),
});

export type ProfileFields = z.infer<typeof profileFieldsSchema>;

// Client-side, per-field — same rules, used for inline error messages
// without needing the whole object to be valid yet.
export function validateField(key: keyof ProfileFields, value: string): string | null {
  const result = profileFieldsSchema.shape[key].safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Дұрыс емес мән');
}
