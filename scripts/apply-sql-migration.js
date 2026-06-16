const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/apply-sql-migration.js <migration.sql>');
  process.exit(1);
}

const statements = fs.readFileSync(file, 'utf8')
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

const prisma = new PrismaClient();

(async () => {
  for (const statement of statements) {
    console.log(`EXEC ${statement.split('\n')[0].slice(0, 80)}`);
    await prisma.$executeRawUnsafe(statement);
  }

  await prisma.$disconnect();
  console.log(`migration_applied ${statements.length}`);
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
