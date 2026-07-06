/**
 * Seed script — creates a default admin user.
 * Run: npm run db:seed
 */
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Admin",
      password: hash,
      role: UserRole.ADMIN,
    },
  });

  console.log(`✅ Admin user created: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
