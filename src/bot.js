require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!TELEGRAM_TOKEN) {
  console.error('ERROR: TELEGRAM_TOKEN not set in .env');
  process.exit(1);
}
if (!SERPAPI_KEY) {
  console.error('ERROR: SERPAPI_KEY not set in .env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('SmartStay Finder Bot started...');

async function searchHotels(location) {
  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google_hotels',
        q: `hotels in ${location}`,
        api_key: SERPAPI_KEY,
        currency: 'USD',
        gl: 'us',
        hl: 'en',
      }
    });
    return response.data.properties || [];
  } catch (error) {
    console.error('SerpApi error:', error.message);
    return [];
  }
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome to SmartStay Finder! 🏨\nSend me a city name to search for hotels.');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) return;

  bot.sendMessage(chatId, `🔍 Searching hotels in "${text}"...`);

  const hotels = await searchHotels(text);

  if (hotels.length === 0) {
    bot.sendMessage(chatId, '😕 No hotels found. Try another city.');
    return;
  }

  const results = hotels.slice(0, 5).map(h =>
    `🏨 ${h.name}\n⭐ ${h.overall_rating || 'N/A'} — 💰 ${h.rate_per_night?.lowest || 'N/A'}/night`
  ).join('\n\n');

  bot.sendMessage(chatId, `Top hotels in ${text}:\n\n${results}`);
});

bot.on('polling_error', console.error);
