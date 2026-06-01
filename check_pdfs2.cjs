const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const configs = await prisma.productPdfConfig.findMany();
  for (const config of configs) {
    console.log(`Config for product ${config.productId}`);
    if (config.pdfTemplateFile) {
      console.log(`Is Buffer? ${Buffer.isBuffer(config.pdfTemplateFile)}`);
      const b = Buffer.from(config.pdfTemplateFile);
      console.log(`Header: ${b.subarray(0, 5).toString('utf8')}`);
      console.log(`First 20 chars of base64: ${b.toString('base64').substring(0, 20)}`);
    } else {
      console.log(`No file.`);
    }
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
