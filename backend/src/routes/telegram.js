const express = require('express');
const router = express.Router();
const telegramService = require('../services/telegramService');
const { query } = require('../config/database');

// Get all chat groups
router.get('/groups', async (req, res) => {
  try {
    const groups = await telegramService.getChatGroups();
    res.json({ success: true, data: groups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch groups' });
  }
});

// Get chat history
router.get('/chat/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 100 } = req.query;
    const messages = await telegramService.getChatHistory(chatId, parseInt(limit));
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chat history' });
  }
});

// Send message
router.post('/send', async (req, res) => {
  try {
    const { chatId, text, botId = 'main' } = req.body;
    const result = await telegramService.sendMessage(chatId, text, {}, botId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

// Batch send messages
router.post('/batch-send', async (req, res) => {
  try {
    const { chatIds, text, botId = 'main' } = req.body;
    const result = await telegramService.batchSendMessage(chatIds, text, {}, botId);
    
    // Store broadcast record
    await query(`
      INSERT INTO telegram_broadcasts (
        message, chat_ids, sent_by, success_count, error_count, status
      ) VALUES ($1, $2, $3, $4, $5, 'completed')
    `, [text, chatIds, req.user?.id, result.results.length, result.errors.length]);
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error batch sending:', error);
    res.status(500).json({ success: false, error: 'Failed to batch send' });
  }
});

// Connect user Telegram account
router.post('/connect-account', async (req, res) => {
  try {
    const { userId, botToken } = req.body;
    const result = await telegramService.addUserBot(userId, botToken);
    res.json(result);
  } catch (error) {
    console.error('Error connecting account:', error);
    res.status(500).json({ success: false, error: 'Failed to connect account' });
  }
});

// Get broadcast history
router.get('/broadcasts', async (req, res) => {
  try {
    const result = await query(`
      SELECT b.*, u.first_name, u.last_name
      FROM telegram_broadcasts b
      LEFT JOIN users u ON b.sent_by = u.id
      ORDER BY b.created_at DESC
      LIMIT 50
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching broadcasts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch broadcasts' });
  }
});

module.exports = router;