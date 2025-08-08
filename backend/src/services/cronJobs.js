const cron = require('node-cron');
const withorbService = require('./withorbService');

class CronJobs {
  start() {
    console.log('⏰ Starting scheduled jobs...');

    // Sync Withorb data every day at 2 AM
    cron.schedule('0 2 * * *', async () => {
      console.log('🔄 Running scheduled Withorb sync...');
      try {
        await withorbService.syncAllCustomers();
      } catch (error) {
        console.error('Scheduled Withorb sync failed:', error);
      }
    });

    // Also sync every 6 hours for more frequent updates
    cron.schedule('0 */6 * * *', async () => {
      console.log('🔄 Running 6-hour Withorb usage sync...');
      try {
        // This could be a lighter sync - just usage data
        const { query } = require('../config/database');
        const companies = await query(
          `SELECT id, withorb_customer_id 
           FROM companies 
           WHERE withorb_customer_id IS NOT NULL 
           LIMIT 50`
        );
        
        for (const company of companies.rows) {
          await withorbService.syncUsageData(company.id, company.withorb_customer_id);
        }
        console.log('✅ Usage sync complete');
      } catch (error) {
        console.error('Usage sync failed:', error);
      }
    });

    console.log('✅ Scheduled jobs started');
  }
}

module.exports = new CronJobs();