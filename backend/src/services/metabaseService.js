const { Pool } = require('pg');
const { query } = require('../config/database');

class MetabaseService {
  constructor() {
    // Metabase database connection
    // You'll need to add these to your .env file
    this.metabasePool = new Pool({
      host: process.env.METABASE_DB_HOST || 'localhost',
      port: process.env.METABASE_DB_PORT || 5432,
      database: process.env.METABASE_DB_NAME,
      user: process.env.METABASE_DB_USER,
      password: process.env.METABASE_DB_PASSWORD,
      ssl: process.env.METABASE_DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
  }

  // Get wallet to company mappings from Metabase
  async getWalletCompanyMappings() {
    console.log('🔄 Fetching wallet → company mappings from Metabase...');
    
    try {
      // This query will need to be adjusted based on your Metabase schema
      const result = await this.metabasePool.query(`
        SELECT DISTINCT
          wallet_address,
          company_name
        FROM prod_hubspot_dimensions
        WHERE wallet_address IS NOT NULL
          AND wallet_address != ''
          AND company_name IS NOT NULL
        ORDER BY company_name, wallet_address
      `);
      
      console.log(`✅ Found ${result.rows.length} wallet mappings in Metabase`);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching from Metabase:', error);
      throw error;
    }
  }

  // Import wallet mappings to our CRM
  async importWalletMappings() {
    console.log('🚀 Starting Metabase wallet import...');
    
    try {
      const mappings = await this.getWalletCompanyMappings();
      
      let stats = {
        companiesCreated: 0,
        companiesUpdated: 0,
        walletsAdded: 0,
        errors: 0
      };

      // Group mappings by company
      const companyMap = new Map();
      mappings.forEach(row => {
        const key = row.company_name.toLowerCase();
        if (!companyMap.has(key)) {
          companyMap.set(key, {
            name: row.company_name,
            wallets: []
          });
        }
        
        companyMap.get(key).wallets.push(row.wallet_address.toLowerCase());
      });

      // Process each company
      for (const [key, data] of companyMap) {
        try {
          // Check if company exists
          let companyResult = await query(
            `SELECT id FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
            [data.name]
          );

          let companyId;
          
          if (companyResult.rows.length === 0) {
            // Create new company
            const insertResult = await query(
              `INSERT INTO companies (name, organization_id, wallet_address)
               VALUES ($1, (SELECT id FROM organizations WHERE name = 'Edge & Node'), $2)
               RETURNING id`,
              [data.name, data.wallets[0]]
            );
            companyId = insertResult.rows[0].id;
            stats.companiesCreated++;
            console.log(`✅ Created company: ${data.name}`);
          } else {
            companyId = companyResult.rows[0].id;
            
            // Update primary wallet if not set
            await query(
              `UPDATE companies 
               SET wallet_address = COALESCE(wallet_address, $1)
               WHERE id = $2`,
              [data.wallets[0], companyId]
            );
            stats.companiesUpdated++;
          }

          // Add all wallets to mapping table
          for (const wallet of data.wallets) {
            await query(
              `INSERT INTO company_wallets (company_id, wallet_address, is_primary)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING`,
              [companyId, wallet, wallet === data.wallets[0]]
            );
            stats.walletsAdded++;
          }

        } catch (error) {
          console.error(`❌ Error processing ${data.name}:`, error.message);
          stats.errors++;
        }
      }

      console.log('\n✅ Metabase import complete:');
      console.log(`   Companies created: ${stats.companiesCreated}`);
      console.log(`   Companies updated: ${stats.companiesUpdated}`);
      console.log(`   Wallets added: ${stats.walletsAdded}`);
      console.log(`   Errors: ${stats.errors}`);
      
      return stats;
    } catch (error) {
      console.error('❌ Import failed:', error);
      throw error;
    }
  }

  // Close connection
  async close() {
    await this.metabasePool.end();
  }
}

module.exports = new MetabaseService();