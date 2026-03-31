require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Load tokens
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HOTELS_API_KEY = process.env.HOTELS_API_KEY;

if (!TELEGRAM_TOKEN) {
  console.error('ERROR: TELEGRAM_TOKEN not set in .env');
  process.exit(1);
}

if (!HOTELS_API_KEY) {
  console.error('ERROR: HOTELS_API_KEY not set in .env');
  process.exit(1);
}

// Create bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('SmartStay Finder Bot started...');

// Real Hotels API search
async function searchHotels(location) {
  try {
    const url = `https://api.hotels-api.com/v1/hotels/search`;
    const response = await axios.get(url, {
      params: { city: location, limit: 10 },
      headers: { 'X-API-KEY': HOTELS_API_KEY }
    });

    if (response.data && response.data.data) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error('Hotel search API error:', error.message);
    return [];
  }
}

// /start handler
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome to SmartStay Finder! Send a city to search hotels.');
});

// Handle messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/start')) return;

  bot.sendMessage(chatId, `Searching hotels near "${text}"...`);
  const hotels = await searchHotels(text);

  if (hotels.length === 0) {
    bot.sendMessage(chatId, 'No hotels found. Try another location.');
    return;
  }

  const results = hotels.map(h =>
    `• ${h.name} — ${h.city} — ⭐ ${h.rating || 'N/A'}`
  ).join('\n');

  bot.sendMessage(chatId, `Top hotels:\n${results}`);
});

// Polling error log
bot.on('polling_error', console.error);
