const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function check() {
  const configs = await prisma.productPdfConfig.findMany();
  for (const config of configs) {
    console.log(`Config for product ${config.productId}`);
    if (config.pdfTemplateFile) {
      console.log(`File size: ${config.pdfTemplateFile.length} bytes`);
      // check if it starts with %PDF
      const header = config.pdfTemplateFile.subarray(0, 5).toString('utf8');
      console.log(`Header: ${header}`);
      if (header !== '%PDF-') {
        console.log(`WARNING: INVALID PDF HEADER!`);
      }
    } else {
      console.log(`No file.`);
    }
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
