import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@juz40-socialcheck.kz';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-immediately';

  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: {
      email,
      fullName: 'Admin',
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

  console.log(`Seeded admin user: ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
