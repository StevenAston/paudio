const { PrismaClient } = require('./src/generated/client/client.js'); 
const prisma = new PrismaClient(); 
prisma.jobQueue.findMany({orderBy: {updatedAt: 'desc'}, take: 1})
  .then(jobs => console.log(jobs[0].errorMessage))
  .finally(() => prisma.$disconnect());
