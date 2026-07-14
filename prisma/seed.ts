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
  } else {
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



  // Seed VM Config Presets
  const presets = [
    { name: "16GB / 4 vCPU / 200GB SSD", vcpus: 4, ramGb: 16, diskGb: 200, diskType: "SSD" },
    { name: "32GB / 8 vCPU / 500GB SSD", vcpus: 8, ramGb: 32, diskGb: 500, diskType: "SSD" },
  ];

  for (const p of presets) {
    const existingPreset = await prisma.vmConfigPreset.findFirst({ where: { name: p.name } });
    if (!existingPreset) {
      await prisma.vmConfigPreset.create({ data: p });
      console.log(`✅ Created VM Config Preset: ${p.name}`);
    }
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
