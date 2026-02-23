/**
 * Ensures an AI team exists, sets the employee's department to "AI",
 * and adds the Owner to the AI team so the ticket lifecycle can run.
 * Run from api root: npx ts-node scripts/setup-ai-department.ts
 */

import { PrismaClient, TeamRole, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const aiTeam = await prisma.team.upsert({
    where: { slug: 'ai' },
    update: { name: 'AI', description: 'AI support team' },
    create: { name: 'AI', slug: 'ai', description: 'AI support team' }
  });

  const employee = await prisma.user.findFirst({
    where: { role: UserRole.EMPLOYEE }
  });
  const owner = await prisma.user.findFirst({
    where: { role: UserRole.OWNER }
  });

  if (!employee) {
    throw new Error('No user with role EMPLOYEE found in the database.');
  }
  if (!owner) {
    throw new Error('No user with role OWNER found in the database.');
  }

  await prisma.user.update({
    where: { id: employee.id },
    data: { department: 'AI' }
  });

  await prisma.teamMember.upsert({
    where: {
      teamId_userId: { teamId: aiTeam.id, userId: owner.id }
    },
    update: { role: TeamRole.ADMIN },
    create: {
      teamId: aiTeam.id,
      userId: owner.id,
      role: TeamRole.ADMIN
    }
  });

  await prisma.user.update({
    where: { id: owner.id },
    data: { primaryTeamId: aiTeam.id }
  });

  const existingRule = await prisma.routingRule.findFirst({
    where: { teamId: aiTeam.id, name: 'AI and automation' }
  });
  if (!existingRule) {
    await prisma.routingRule.create({
      data: {
        teamId: aiTeam.id,
        name: 'AI and automation',
        keywords: ['ai', 'automation', 'model', 'llm'],
        priority: 10,
        isActive: true
      }
    });
  }

  console.log('AI department setup complete.');
  console.log(`  Team: ${aiTeam.name} (${aiTeam.slug})`);
  console.log(`  Employee "${employee.displayName}" department set to AI`);
  console.log(`  Owner "${owner.displayName}" added to AI team as Admin`);
  console.log(`  Routing rule "AI and automation" ensured for team`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
