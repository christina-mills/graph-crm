const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const { query } = require('../config/database');

const MAPPINGS_CSV = path.join(__dirname, '../../../data-migration/metabase-wallet-mappings.csv');

async function importMetabaseMappings() {
  console.log('🚀 Starting Metabase wallet mappings import...');
  
  // Ensure company_wallets table exists
  await query(`
    CREATE TABLE IF NOT EXISTS company_wallets (
      id SERIAL PRIMARY KEY,
      company_id UUID REFERENCES companies(id),
      wallet_address VARCHAR(255) NOT NULL,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_company_wallets_address ON company_wallets(LOWER(wallet_address));
    CREATE INDEX IF NOT EXISTS idx_company_wallets_company ON company_wallets(company_id);
  `);
  
  const stats = {
    companiesCreated: 0,
    companiesMatched: 0,
    walletsAdded: 0,
    errors: 0
  };
  
  // Get Edge & Node organization ID
  const orgResult = await query(`
    SELECT id FROM organizations WHERE name = 'Edge & Node' LIMIT 1
  `);
  const defaultOrgId = orgResult.rows[0]?.id;
  
  // Read and process mappings
  const mappings = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(MAPPINGS_CSV)
      .pipe(csv())
      .on('data', (row) => {
        if (row.wallet_address && row.company_name) {
          mappings.push({
            wallet: row.wallet_address.toLowerCase(),
            company: row.company_name
          });
        }
      })
      .on('end', async () => {
        console.log(`📊 Processing ${mappings.length} wallet mappings...`);
        
        // Group by company
        const companyMap = new Map();
        mappings.forEach(m => {
          if (!companyMap.has(m.company)) {
            companyMap.set(m.company, []);
          }
          companyMap.get(m.company).push(m.wallet);
        });
        
        console.log(`📊 Found ${companyMap.size} unique companies`);
        
        // Process each company
        for (const [companyName, wallets] of companyMap) {
          try {
            // Check if company exists
            let companyResult = await query(
              `SELECT id, name FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
              [companyName]
            );
            
            let companyId;
            
            if (companyResult.rows.length === 0) {
              // Create new company
              const insertResult = await query(
                `INSERT INTO companies (name, organization_id, wallet_address)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [companyName, defaultOrgId, wallets[0]]
              );
              companyId = insertResult.rows[0].id;
              stats.companiesCreated++;
              console.log(`✅ Created company: ${companyName}`);
            } else {
              companyId = companyResult.rows[0].id;
              stats.companiesMatched++;
              
              // Update primary wallet if not set
              await query(
                `UPDATE companies 
                 SET wallet_address = COALESCE(wallet_address, $1)
                 WHERE id = $2`,
                [wallets[0], companyId]
              );
            }
            
            // Add all wallets to mapping table
            for (let i = 0; i < wallets.length; i++) {
              const result = await query(
                `INSERT INTO company_wallets (company_id, wallet_address, is_primary)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (company_id, wallet_address) DO NOTHING
                 RETURNING id`,
                [companyId, wallets[i], i === 0]
              );
              
              if (result.rowCount > 0) {
                stats.walletsAdded++;
              }
            }
            
          } catch (error) {
            console.error(`❌ Error processing ${companyName}:`, error.message);
            stats.errors++;
          }
        }
        
        console.log('\n✅ Import complete:');
        console.log(`   Companies created: ${stats.companiesCreated}`);
        console.log(`   Companies matched: ${stats.companiesMatched}`);
        console.log(`   Wallets added: ${stats.walletsAdded}`);
        console.log(`   Errors: ${stats.errors}`);
        
        resolve(stats);
      })
      .on('error', reject);
  });
}

// Add unique constraint if it doesn't exist
async function addUniqueConstraint() {
  try {
    await query(`
      ALTER TABLE company_wallets 
      ADD CONSTRAINT unique_company_wallet 
      UNIQUE (company_id, wallet_address)
    `);
    console.log('✅ Added unique constraint');
  } catch (error) {
    if (error.code !== '42710') { // Constraint already exists
      console.error('Error adding constraint:', error.message);
    }
  }
}

// Run the import
async function run() {
  try {
    await addUniqueConstraint();
    await importMetabaseMappings();
    
    // Show summary
    const summary = await query(`
      SELECT 
        COUNT(DISTINCT c.id) as companies_with_wallets,
        COUNT(DISTINCT cw.id) as total_wallet_mappings,
        COUNT(DISTINCT CASE WHEN c.withorb_customer_id IS NOT NULL THEN c.id END) as companies_with_withorb
      FROM companies c
      JOIN company_wallets cw ON cw.company_id = c.id
    `);
    
    console.log('\n📊 Database Summary:');
    console.log(`   Companies with wallets: ${summary.rows[0].companies_with_wallets}`);
    console.log(`   Total wallet mappings: ${summary.rows[0].total_wallet_mappings}`);
    console.log(`   Companies matched in Withorb: ${summary.rows[0].companies_with_withorb}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

run();