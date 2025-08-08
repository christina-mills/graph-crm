const axios = require('axios');
const { query } = require('../config/database');

class WithorbService {
  constructor() {
    this.apiKey = process.env.WITHORB_API_KEY;
    this.baseURL = 'https://api.withorb.com/v1';
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  // Get all customers from Withorb with pagination
  async getAllCustomers() {
    try {
      let allCustomers = [];
      let hasMore = true;
      let cursor = null;
      
      while (hasMore) {
        console.log(`Fetching customers... (${allCustomers.length} so far)`);
        
        const params = {
          limit: 100
        };
        
        if (cursor) {
          params.cursor = cursor;
        }
        
        const response = await this.client.get('/customers', { params });
        
        const data = response.data;
        allCustomers = allCustomers.concat(data.data || []);
        
        // Check for pagination
        hasMore = data.pagination_metadata?.has_more || false;
        cursor = data.pagination_metadata?.next_cursor || null;
        
        // Safety check
        if (allCustomers.length > 10000) {
          console.log('⚠️  Reached 10,000 customers limit');
          break;
        }
      }
      
      console.log(`✅ Fetched ${allCustomers.length} total customers`);
      return allCustomers;
    } catch (error) {
      console.error('Error fetching Withorb customers:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get customer details including subscriptions
  async getCustomerDetails(customerId) {
    try {
      const [customer, subscriptions] = await Promise.all([
        this.client.get(`/customers/${customerId}`),
        this.client.get(`/subscriptions`, {
          params: {
            customer_id: customerId
          }
        })
      ]);
      
      return {
        customer: customer.data,
        subscriptions: subscriptions.data.data
      };
    } catch (error) {
      console.error(`Error fetching customer ${customerId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  // Get usage data for a customer
  async getCustomerUsage(customerId, startDate, endDate) {
    try {
      const response = await this.client.get(`/customers/${customerId}/usage`, {
        params: {
          timeframe_start: startDate,
          timeframe_end: endDate,
          granularity: 'day'
        }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching usage for customer ${customerId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  // Sync a single customer with our database
  async syncCustomerToDatabase(withorbCustomer) {
    try {
      // Get customer details and subscriptions
      const details = await this.getCustomerDetails(withorbCustomer.id);
      
      // Calculate MRR from active subscriptions
      let totalMRR = 0;
      let activeSubscriptions = 0;
      
      details.subscriptions.forEach(sub => {
        if (sub.status === 'active') {
          activeSubscriptions++;
          // Withorb stores amounts in cents
          totalMRR += (sub.plan.prices[0]?.price?.amount || 0) / 100;
        }
      });

      // Try to match company by wallet address, email domain, or name
      const customerEmail = withorbCustomer.email;
      const domain = customerEmail ? customerEmail.split('@')[1] : null;
      
      // Check if the customer name looks like a wallet address (starts with 0x)
      const isWalletAddress = withorbCustomer.name.toLowerCase().startsWith('0x');
      
      let companyResult;
      
      // First try to find by wallet address if the name looks like one
      if (isWalletAddress) {
        // Check both the main wallet_address field and the mapping table
        companyResult = await query(
          `SELECT DISTINCT c.id, c.name 
           FROM companies c
           LEFT JOIN company_wallets cw ON cw.company_id = c.id
           WHERE LOWER(c.wallet_address) = LOWER($1) 
              OR LOWER(cw.wallet_address) = LOWER($1)
           LIMIT 1`,
          [withorbCustomer.name]
        );
        if (companyResult && companyResult.rows.length > 0) {
          console.log(`   Matched by wallet: ${withorbCustomer.name} → ${companyResult.rows[0].name}`);
        }
      }
      
      // If not found and we have a domain, try by domain
      if ((!companyResult || companyResult.rows.length === 0) && domain) {
        companyResult = await query(
          `SELECT id, name FROM companies WHERE domain = $1 OR domain = $2 LIMIT 1`,
          [domain, `www.${domain}`]
        );
      }
      
      // If still not found, try by name
      if (!companyResult || companyResult.rows.length === 0) {
        companyResult = await query(
          `SELECT id, name FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [withorbCustomer.name]
        );
      }

      if (companyResult && companyResult.rows.length > 0) {
        const companyId = companyResult.rows[0].id;
        const companyName = companyResult.rows[0].name;
        
        // Update company with Withorb data
        await query(
          `UPDATE companies 
           SET mrr_usd = $1,
               withorb_customer_id = $2,
               withorb_sync_date = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [totalMRR, withorbCustomer.id, companyId]
        );
        
        console.log(`✅ Updated ${companyName}: MRR ${totalMRR.toFixed(2)}`);
        return { updated: true, companyId, mrr: totalMRR };
      } else {
        console.log(`⚠️  No match found for Withorb customer: ${withorbCustomer.name}`);
        return { updated: false, customer: withorbCustomer.name };
      }
    } catch (error) {
      console.error(`Error syncing customer ${withorbCustomer.name}:`, error);
      return { updated: false, error: error.message };
    }
  }

  // Sync usage data for a company
  async syncUsageData(companyId, withorbCustomerId) {
    try {
      // Get last 30 days of usage
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      
      const usage = await this.getCustomerUsage(
        withorbCustomerId,
        startDate.toISOString(),
        endDate.toISOString()
      );

      // Sum up query usage from Withorb
      let totalQueries = 0;
      usage.usage_data?.forEach(metric => {
        if (metric.metric_name?.toLowerCase().includes('query')) {
          totalQueries += metric.usage || 0;
        }
      });

      // Update company with latest usage
      await query(
        `UPDATE companies 
         SET monthly_query_volume = $1,
             withorb_last_usage_sync = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [totalQueries, companyId]
      );

      // Also insert daily usage records
      for (const metric of usage.usage_data || []) {
        if (metric.metric_name?.toLowerCase().includes('query')) {
          await query(
            `INSERT INTO usage_metrics (company_id, date, query_count, cost_usd)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (company_id, date) 
             DO UPDATE SET 
               query_count = EXCLUDED.query_count,
               cost_usd = EXCLUDED.cost_usd`,
            [companyId, metric.timeframe_start, metric.usage || 0, (metric.cost || 0) / 100]
          );
        }
      }

      return { success: true, totalQueries };
    } catch (error) {
      console.error(`Error syncing usage for company ${companyId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Main sync function
  async syncAllCustomers() {
    console.log('🔄 Starting Withorb sync...');
    
    try {
      const customers = await this.getAllCustomers();
      console.log(`📊 Found ${customers.length} customers in Withorb`);
      
      const results = {
        updated: 0,
        notFound: 0,
        errors: 0
      };

      for (const customer of customers) {
        const result = await this.syncCustomerToDatabase(customer);
        
        if (result.updated) {
          results.updated++;
          
          // Also sync usage data if we have a Withorb customer ID
          if (result.companyId) {
            await this.syncUsageData(result.companyId, customer.id);
          }
        } else if (result.error) {
          results.errors++;
        } else {
          results.notFound++;
        }
      }

      console.log('\n✅ Withorb sync complete:');
      console.log(`   Updated: ${results.updated} companies`);
      console.log(`   Not found: ${results.notFound} customers`);
      console.log(`   Errors: ${results.errors}`);
      
      return results;
    } catch (error) {
      console.error('❌ Withorb sync failed:', error);
      throw error;
    }
  }
}

module.exports = new WithorbService();