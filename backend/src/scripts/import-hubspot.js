const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const { query } = require('../config/database');

// Paths to your CSV files
const DATA_DIR = path.join(__dirname, '../../../data-migration');
const COMPANIES_CSV = path.join(DATA_DIR, 'companies.csv');
const CONTACTS_CSV = path.join(DATA_DIR, 'contacts.csv');
const DEALS_CSV = path.join(DATA_DIR, 'deals.csv');

// Progress tracking
let stats = {
  companies: { total: 0, imported: 0, failed: 0 },
  contacts: { total: 0, imported: 0, failed: 0 },
  deals: { total: 0, imported: 0, failed: 0 }
};

// Helper function to clean and parse data
function cleanValue(value) {
  if (!value || value === 'null' || value === 'undefined' || value === '') {
    return null;
  }
  return value.trim();
}

// Helper function to parse numbers
function parseNumber(value) {
  const cleaned = cleanValue(value);
  if (!cleaned) return null;
  const num = parseFloat(cleaned.replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? null : num;
}

// Import companies
async function importCompanies() {
  console.log('\n📁 Importing Companies...');
  
  // Get default organization (Edge & Node)
  const orgResult = await query(`
    SELECT id FROM organizations WHERE name = 'Edge & Node' LIMIT 1
  `);
  const defaultOrgId = orgResult.rows[0]?.id;

  return new Promise((resolve, reject) => {
    const companies = [];
    
    fs.createReadStream(COMPANIES_CSV)
      .pipe(csv())
      .on('data', (row) => {
        stats.companies.total++;
        
        // Map HubSpot fields to our schema
        const company = {
          hubspot_id: cleanValue(row['Record ID']),
          name: cleanValue(row['Company name']),
          domain: cleanValue(row['Company Domain Name'] || row['Website URL']),
          industry: cleanValue(row['Industry']),
          employee_count: parseNumber(row['Number of Employees']),
          organization_id: defaultOrgId,
          // Graph-specific metrics
          monthly_query_volume: parseNumber(row['All Studio User Query Volume 30D'] || row['Domain queries 30D'] || row['Network queries 30D']),
          total_queries_to_date: parseNumber(row['All Studio User Query Volume Lifetime']),
          mrr_usd: parseNumber(row['Fees earned 30D USD'])
        };
        
        companies.push(company);
      })
      .on('end', async () => {
        console.log(`📊 Found ${companies.length} companies to import`);
        
        // Batch insert companies
        for (const company of companies) {
          try {
            await query(`
              INSERT INTO companies (
                hubspot_id, name, domain, industry, 
                employee_count, organization_id,
                monthly_query_volume, total_queries_to_date, mrr_usd
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (hubspot_id) 
              DO UPDATE SET
                name = EXCLUDED.name,
                domain = EXCLUDED.domain,
                industry = EXCLUDED.industry,
                employee_count = EXCLUDED.employee_count,
                monthly_query_volume = EXCLUDED.monthly_query_volume,
                total_queries_to_date = EXCLUDED.total_queries_to_date,
                mrr_usd = EXCLUDED.mrr_usd
            `, [
              company.hubspot_id,
              company.name || 'Unknown Company',
              company.domain,
              company.industry,
              company.employee_count,
              company.organization_id,
              company.monthly_query_volume,
              company.total_queries_to_date,
              company.mrr_usd
            ]);
            
            stats.companies.imported++;
            
            if (stats.companies.imported % 100 === 0) {
              console.log(`✅ Imported ${stats.companies.imported} companies...`);
            }
          } catch (error) {
            stats.companies.failed++;
            console.error(`❌ Failed to import company ${company.name}:`, error.message);
          }
        }
        
        console.log(`✅ Companies import complete: ${stats.companies.imported}/${stats.companies.total} successful`);
        resolve();
      })
      .on('error', reject);
  });
}

// Import contacts
async function importContacts() {
  console.log('\n📁 Importing Contacts...');
  
  // Create a map of company names to IDs as fallback
  const companyMap = new Map();
  const companyNameMap = new Map();
  const companyResult = await query(`SELECT id, hubspot_id, name FROM companies`);
  companyResult.rows.forEach(row => {
    if (row.hubspot_id) companyMap.set(row.hubspot_id, row.id);
    if (row.name) companyNameMap.set(row.name.toLowerCase(), row.id);
  });

  return new Promise((resolve, reject) => {
    const contacts = [];
    
    fs.createReadStream(CONTACTS_CSV)
      .pipe(csv())
      .on('data', (row) => {
        stats.contacts.total++;
        
        // Map HubSpot fields to our schema
        const contact = {
          hubspot_id: cleanValue(row['Record ID']),
          email: cleanValue(row['Email']),
          first_name: cleanValue(row['First Name']),
          last_name: cleanValue(row['Last Name']),
          phone: cleanValue(row['Phone Number'] || row['Mobile Phone Number']),
          company_name: cleanValue(row['Company Name']),
          telegram_id: cleanValue(row['Telegram ID'])
        };
        
        contacts.push(contact);
      })
      .on('end', async () => {
        console.log(`📊 Found ${contacts.length} contacts to import`);
        
        // Batch insert contacts
        for (const contact of contacts) {
          try {
            // Look up company ID by name since contacts don't have company HubSpot IDs
            let companyId = null;
            if (contact.company_name) {
              companyId = companyNameMap.get(contact.company_name.toLowerCase());
            }
            
            await query(`
              INSERT INTO contacts (
                hubspot_id, email, first_name, last_name, 
                phone, company_id, telegram_username
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (hubspot_id) 
              DO UPDATE SET
                email = EXCLUDED.email,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                phone = EXCLUDED.phone,
                company_id = EXCLUDED.company_id,
                telegram_username = EXCLUDED.telegram_username
            `, [
              contact.hubspot_id,
              contact.email,
              contact.first_name,
              contact.last_name,
              contact.phone,
              companyId,
              contact.telegram_id
            ]);
            
            stats.contacts.imported++;
            
            if (stats.contacts.imported % 1000 === 0) {
              console.log(`✅ Imported ${stats.contacts.imported} contacts...`);
            }
          } catch (error) {
            stats.contacts.failed++;
            if (stats.contacts.failed < 10) { // Only log first 10 errors
              console.error(`❌ Failed to import contact ${contact.email}:`, error.message);
            }
          }
        }
        
        console.log(`✅ Contacts import complete: ${stats.contacts.imported}/${stats.contacts.total} successful`);
        resolve();
      })
      .on('error', reject);
  });
}

// Import deals
async function importDeals() {
  console.log('\n📁 Importing Deals...');
  
  // Create maps for lookups
  const companyMap = new Map();
  const contactMap = new Map();
  
  const companyResult = await query(`SELECT id, hubspot_id FROM companies WHERE hubspot_id IS NOT NULL`);
  companyResult.rows.forEach(row => {
    companyMap.set(row.hubspot_id, row.id);
  });
  
  const contactResult = await query(`SELECT id, hubspot_id FROM contacts WHERE hubspot_id IS NOT NULL`);
  contactResult.rows.forEach(row => {
    contactMap.set(row.hubspot_id, row.id);
  });

  return new Promise((resolve, reject) => {
    const deals = [];
    
    fs.createReadStream(DEALS_CSV)
      .pipe(csv())
      .on('data', (row) => {
        stats.deals.total++;
        
        // Map HubSpot fields to our schema
        const deal = {
          hubspot_id: cleanValue(row['Record ID']),
          name: cleanValue(row['Deal Name']),
          stage: cleanValue(row['Deal Stage']),
          amount: parseNumber(row['Amount']),
          close_date: cleanValue(row['Close Date']),
          // Get associated IDs from the CSV
          company_ids: cleanValue(row['Associated Company IDs']),
          contact_ids: cleanValue(row['Associated Contact IDs']),
          // Graph-specific fields
          monthly_queries: parseNumber(row['Combined queries 30D'] || row['Network Queries 30D'])
        };
        
        deals.push(deal);
      })
      .on('end', async () => {
        console.log(`📊 Found ${deals.length} deals to import`);
        
        // Batch insert deals
        for (const deal of deals) {
          try {
            // Look up our IDs from HubSpot IDs
            // Handle multiple company/contact IDs (semicolon separated in HubSpot)
            let companyId = null;
            let contactId = null;
            
            if (deal.company_ids) {
              const companyIdList = deal.company_ids.split(';').map(id => id.trim());
              companyId = companyMap.get(companyIdList[0]); // Use first company
            }
            
            if (deal.contact_ids) {
              const contactIdList = deal.contact_ids.split(';').map(id => id.trim());
              contactId = contactMap.get(contactIdList[0]); // Use first contact
            }
            
            // Map HubSpot stages to our stages
            let stage = 'lead';
            const dealStage = (deal.stage || '').toLowerCase();
            
            // Map based on your specific HubSpot stages
            if (dealStage.includes('active user') || dealStage.includes('active partnership')) {
              stage = 'closed_won';
            } else if (dealStage.includes('churned') || dealStage.includes('closed lost')) {
              stage = 'closed_lost';
            } else if (dealStage.includes('qualified')) {
              stage = 'qualified';
            } else if (dealStage.includes('discovery') || dealStage.includes('appointment')) {
              stage = 'proposal';
            } else if (dealStage.includes('negotiating') || dealStage.includes('contract')) {
              stage = 'negotiation';
            }
            
            // Parse close date
            let closeDate = null;
            if (deal.close_date) {
              const parsed = new Date(deal.close_date);
              if (!isNaN(parsed.getTime())) {
                closeDate = parsed.toISOString().split('T')[0];
              }
            }
            
            await query(`
              INSERT INTO deals (
                hubspot_id, name, company_id, primary_contact_id,
                stage, amount, close_date, expected_monthly_queries
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (hubspot_id) 
              DO UPDATE SET
                name = EXCLUDED.name,
                company_id = EXCLUDED.company_id,
                primary_contact_id = EXCLUDED.primary_contact_id,
                stage = EXCLUDED.stage,
                amount = EXCLUDED.amount,
                close_date = EXCLUDED.close_date,
                expected_monthly_queries = EXCLUDED.expected_monthly_queries
            `, [
              deal.hubspot_id,
              deal.name || 'Untitled Deal',
              companyId,
              contactId,
              stage,
              deal.amount,
              closeDate,
              deal.monthly_queries
            ]);
            
            stats.deals.imported++;
            
            if (stats.deals.imported % 1000 === 0) {
              console.log(`✅ Imported ${stats.deals.imported} deals...`);
            }
          } catch (error) {
            stats.deals.failed++;
            if (stats.deals.failed < 10) { // Only log first 10 errors
              console.error(`❌ Failed to import deal ${deal.name}:`, error.message);
            }
          }
        }
        
        console.log(`✅ Deals import complete: ${stats.deals.imported}/${stats.deals.total} successful`);
        resolve();
      })
      .on('error', reject);
  });
}

// Main import function
async function runImport() {
  console.log('🚀 Starting HubSpot data import...');
  console.log(`📂 Looking for CSV files in: ${DATA_DIR}`);
  
  try {
    // Check if files exist
    if (!fs.existsSync(COMPANIES_CSV)) {
      console.error(`❌ Companies CSV not found at: ${COMPANIES_CSV}`);
      console.log('Please update the file paths in this script with your actual file names.');
      return;
    }
    
    // Import in order: Companies → Contacts → Deals
    await importCompanies();
    
    if (fs.existsSync(CONTACTS_CSV)) {
      await importContacts();
    } else {
      console.log('⚠️  Contacts CSV not found, skipping contacts import');
    }
    
    if (fs.existsSync(DEALS_CSV)) {
      await importDeals();
    } else {
      console.log('⚠️  Deals CSV not found, skipping deals import');
    }
    
    // Print final summary
    console.log('\n📊 Import Summary:');
    console.log('=================');
    console.log(`Companies: ${stats.companies.imported}/${stats.companies.total} imported (${stats.companies.failed} failed)`);
    console.log(`Contacts: ${stats.contacts.imported}/${stats.contacts.total} imported (${stats.contacts.failed} failed)`);
    console.log(`Deals: ${stats.deals.imported}/${stats.deals.total} imported (${stats.deals.failed} failed)`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

// Run the import
runImport();