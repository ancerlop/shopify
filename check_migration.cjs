const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAndMigrate() {
  console.log("Checking for orphaned mappings or templates...");
  const mappings = await prisma.pdfFieldMapping.findMany();
  console.log(`Found ${mappings.length} mappings in total.`);
  
  if (mappings.length > 0) {
    console.log("Mappings found. Some might be orphaned or mapped to empty configs.");
  }

  // Find stores
  const stores = await prisma.store.findMany({ include: { products: true, settings: true }});
  for (const store of stores) {
    console.log(`Store: ${store.myshopifyDomain}, Products: ${store.products.length}`);
    if (store.products.length > 0) {
      const firstProduct = store.products[0];
      const config = await prisma.productPdfConfig.findUnique({ where: { productId: firstProduct.id }});
      if (config) {
         console.log(` Product ${firstProduct.id} already has a pdfConfig`);
      } else {
         console.log(` Product ${firstProduct.id} has NO pdfConfig`);
      }
    }
  }

  console.log("Done.");
}

checkAndMigrate()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
