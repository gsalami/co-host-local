import { getUncachableStripeClient } from '../server/stripeClient';

const CREDIT_PACKAGES = [
  {
    name: "Teaser",
    priceChf: 1000, // CHF 10 in cents
    transcriptMinutes: 60,
    voiceMinutes: 20,
    metadata: {
      packageId: "teaser",
      transcriptSeconds: String(60 * 60), // 60 min = 3600 sec
      voiceSeconds: String(20 * 60), // 20 min = 1200 sec
    }
  },
  {
    name: "Episode",
    priceChf: 2000, // CHF 20 in cents
    transcriptMinutes: 150,
    voiceMinutes: 50,
    metadata: {
      packageId: "episode",
      transcriptSeconds: String(150 * 60), // 150 min = 9000 sec
      voiceSeconds: String(50 * 60), // 50 min = 3000 sec
    }
  },
  {
    name: "Staffel",
    priceChf: 5000, // CHF 50 in cents
    transcriptMinutes: 450,
    voiceMinutes: 150,
    metadata: {
      packageId: "staffel",
      transcriptSeconds: String(450 * 60), // 450 min = 27000 sec
      voiceSeconds: String(150 * 60), // 150 min = 9000 sec
    }
  },
  {
    name: "Produzent",
    priceChf: 10000, // CHF 100 in cents
    transcriptMinutes: 1000,
    voiceMinutes: 330,
    metadata: {
      packageId: "produzent",
      transcriptSeconds: String(1000 * 60), // 1000 min = 60000 sec
      voiceSeconds: String(330 * 60), // 330 min = 19800 sec
    }
  },
  {
    name: "Podcast-Imperium",
    priceChf: 20000, // CHF 200 in cents
    transcriptMinutes: 2000,
    voiceMinutes: 650,
    metadata: {
      packageId: "podcast-imperium",
      transcriptSeconds: String(2000 * 60), // 2000 min = 120000 sec
      voiceSeconds: String(650 * 60), // 650 min = 39000 sec
    }
  }
];

async function seedProducts() {
  const stripe = await getUncachableStripeClient();
  
  console.log("Creating Stripe credit packages...\n");
  
  for (const pkg of CREDIT_PACKAGES) {
    console.log(`\n--- Creating ${pkg.name} ---`);
    
    const existingProducts = await stripe.products.search({
      query: `name:'${pkg.name}' AND active:'true'`
    });
    
    if (existingProducts.data.length > 0) {
      console.log(`Product "${pkg.name}" already exists, skipping...`);
      continue;
    }
    
    const product = await stripe.products.create({
      name: pkg.name,
      description: `${pkg.transcriptMinutes} Minuten Transkription + ${pkg.voiceMinutes} Minuten AI Co-Host`,
      metadata: pkg.metadata,
    });
    
    console.log(`Created product: ${product.id}`);
    
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: pkg.priceChf,
      currency: 'chf',
    });
    
    console.log(`Created price: ${price.id} (CHF ${pkg.priceChf / 100})`);
  }
  
  console.log("\n\nDone! Products created in Stripe.");
}

seedProducts().catch(console.error);
