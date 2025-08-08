const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { query } = require('../config/database');
const EventEmitter = require('events');

class TelegramService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // Store multiple client instances
    this.mainClient = null;
    this.io = null; // Socket.io instance
  }

  // Initialize Socket.io
  setSocketIO(io) {
    this.io = io;
  }

  // Initialize main company account
  async initializeMainAccount() {
    const apiId = parseInt(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    const stringSession = process.env.TELEGRAM_SESSION || '';
    
    if (!apiId || !apiHash) {
      console.error('❌ TELEGRAM_API_ID and TELEGRAM_API_HASH required for user accounts');
      return;
    }

    try {
      const session = new StringSession(stringSession);
      this.mainClient = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
      });

      await this.mainClient.start({
        phoneNumber: async () => process.env.TELEGRAM_PHONE_NUMBER,
        password: async () => process.env.TELEGRAM_PASSWORD,
        phoneCode: async () => {
          // In production, you'd want to implement a way to input this
          console.log('Phone code required - implement input method');
          return await getUserInput('Phone code:');
        },
        onError: (err) => console.error(err),
      });

      console.log('✅ Telegram user account connected');
      
      // Save session for next time
      console.log('Session string:', this.mainClient.session.save());
      
      // Listen for messages
      this.mainClient.addEventHandler(async (update) => {
        if (update.message) {
          await this.handleIncomingMessage(update.message, 'main');
        }
      });

    } catch (error) {
      console.error('❌ Failed to initialize Telegram account:', error);
    }
  }

  // Add user bot
  async addUserBot(userId, token) {
    try {
      const bot = new TelegramBot(token, { polling: true });
      
      bot.on('message', async (msg) => {
        await this.handleIncomingMessage(msg, userId);
      });

      this.bots.set(userId, bot);
      
      // Store encrypted token in database
      await query(
        `UPDATE users SET telegram_bot_token = $1 WHERE id = $2`,
        [token, userId] // In production, encrypt the token
      );

      return { success: true };
    } catch (error) {
      console.error('Failed to add user bot:', error);
      return { success: false, error: error.message };
    }
  }

  // Handle incoming messages
  async handleIncomingMessage(msg, botId) {
    try {
      // Store message in database
      const messageData = {
        chat_id: msg.chat.id,
        chat_title: msg.chat.title || msg.chat.username || 'Direct Message',
        chat_type: msg.chat.type,
        message_id: msg.message_id,
        from_id: msg.from.id,
        from_username: msg.from.username,
        from_first_name: msg.from.first_name,
        text: msg.text || '',
        date: new Date(msg.date * 1000),
        bot_id: botId
      };

      // Save to database
      const result = await query(
        `INSERT INTO telegram_messages (
          chat_id, chat_title, chat_type, message_id, 
          from_id, from_username, from_first_name, 
          text, date, bot_id, is_outgoing
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
        RETURNING id`,
        [
          messageData.chat_id,
          messageData.chat_title,
          messageData.chat_type,
          messageData.message_id,
          messageData.from_id,
          messageData.from_username,
          messageData.from_first_name,
          messageData.text,
          messageData.date,
          messageData.bot_id
        ]
      );

      // Emit to connected clients via Socket.io
      if (this.io) {
        this.io.emit('telegram:message', {
          ...messageData,
          id: result.rows[0].id
        });
      }

      // Check if this is a lead qualification opportunity
      if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        await this.checkForLeadQualification(msg);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  // Send message
  async sendMessage(chatId, text, options = {}, botId = 'main') {
    try {
      const bot = botId === 'main' ? this.mainBot : this.bots.get(botId);
      if (!bot) {
        throw new Error('Bot not found');
      }

      const result = await bot.sendMessage(chatId, text, options);
      
      // Store outgoing message
      await query(
        `INSERT INTO telegram_messages (
          chat_id, message_id, text, date, bot_id, is_outgoing
        ) VALUES ($1, $2, $3, $4, $5, true)`,
        [chatId, result.message_id, text, new Date(), botId]
      );

      return result;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  // Batch send messages
  async batchSendMessage(chatIds, text, options = {}, botId = 'main') {
    const results = [];
    const errors = [];

    for (const chatId of chatIds) {
      try {
        const result = await this.sendMessage(chatId, text, options, botId);
        results.push({ chatId, success: true, messageId: result.message_id });
      } catch (error) {
        errors.push({ chatId, success: false, error: error.message });
      }
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { results, errors };
  }

  // Get chat groups
  async getChatGroups() {
    try {
      const result = await query(`
        SELECT DISTINCT 
          chat_id,
          chat_title,
          chat_type,
          MAX(date) as last_message_date,
          COUNT(*) as message_count
        FROM telegram_messages
        WHERE chat_type IN ('group', 'supergroup')
        GROUP BY chat_id, chat_title, chat_type
        ORDER BY last_message_date DESC
      `);

      return result.rows;
    } catch (error) {
      console.error('Error fetching chat groups:', error);
      return [];
    }
  }

  // Get chat history
  async getChatHistory(chatId, limit = 100) {
    try {
      const result = await query(`
        SELECT *
        FROM telegram_messages
        WHERE chat_id = $1
        ORDER BY date DESC
        LIMIT $2
      `, [chatId, limit]);

      return result.rows.reverse(); // Return in chronological order
    } catch (error) {
      console.error('Error fetching chat history:', error);
      return [];
    }
  }

  // Lead qualification check
  async checkForLeadQualification(msg) {
    // Keywords that might indicate a lead
    const leadKeywords = ['interested', 'pricing', 'how much', 'cost', 'integrate', 'api', 'graph protocol'];
    const text = msg.text?.toLowerCase() || '';
    
    const hasLeadKeyword = leadKeywords.some(keyword => text.includes(keyword));
    
    if (hasLeadKeyword) {
      // Create or update telegram conversation for lead tracking
      await query(`
        INSERT INTO telegram_conversations (
          chat_id, username, qualification_status
        ) VALUES ($1, $2, 'qualifying')
        ON CONFLICT (chat_id) DO UPDATE
        SET qualification_status = 'qualifying'
      `, [msg.chat.id, msg.from.username]);
      
      // Emit lead alert
      if (this.io) {
        this.io.emit('telegram:lead', {
          chatId: msg.chat.id,
          username: msg.from.username,
          message: msg.text
        });
      }
    }
  }
}

module.exports = new TelegramService();