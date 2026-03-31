require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!TELEGRAM_TOKEN) { console.error('ERROR: TELEGRAM_TOKEN not set'); process.exit(1); }
if (!SERPAPI_KEY) { console.error('ERROR: SERPAPI_KEY not set'); process.exit(1); }

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('SmartStay Finder Bot started...');

function getTomorrowDate() {
  const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
}
function getDayAfterDate() {
  const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0];
}

async function searchHotels(query) {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: { engine: 'google_hotels', q: query, api_key: SERPAPI_KEY, currency: 'USD', hl: 'en', gl: 'us', check_in_date: getTomorrowDate(), check_out_date: getDayAfterDate(), adults: 1 }
    });
    return response.data.properties || [];
  } catch (error) {
    console.error('SerpApi error:', error.response?.data || error.message);
    return [];
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json' }, headers: { 'User-Agent': 'SmartStayBot/1.0' }
    });
    const addr = res.data.address;
    return addr.city || addr.town || addr.village || addr.county || lat+','+lon;
  } catch(e) { return lat+','+lon; }
}

function sendHotelResults(chatId, hotels, location) {
  if (hotels.length === 0) {
    bot.sendMessage(chatId, 'No hotels found. Try a different city, address or ZIP code.'); return;
  }
  const results = hotels.slice(0, 5).map((h, i) =>
    (i+1)+'. '+h.name+'\n'+
    'Rating: '+(h.overall_rating ? h.overall_rating+'/5' : 'N/A')+'\n'+
    'Price: '+(h.rate_per_night?.lowest ? 'From '+h.rate_per_night.lowest+'/night' : 'N/A')+'\n'+
    'Location: '+(h.neighborhood || h.location || '')
  ).join('\n\n');
  bot.sendMessage(chatId, 'Hotels near '+location+':\n\n'+results);
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome to SmartStay Finder!\n\nSearch by:\n- City name (e.g. Tokyo)\n- ZIP code (e.g. 90210)\n- Address (e.g. Times Square New York)\n- Share your GPS location via the attachment button');
});

bot.on('location', async (msg) => {
  const chatId = msg.chat.id;
  const { latitude, longitude } = msg.location;
  bot.sendMessage(chatId, 'Got your location! Searching nearby hotels...');
  const city = await reverseGeocode(latitude, longitude);
  const hotels = await searchHotels('hotels near '+city);
  sendHotelResults(chatId, hotels, city);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  bot.sendMessage(chatId, 'Searching hotels for "'+text+'"...');
  const hotels = await searchHotels('hotels in '+text);
  sendHotelResults(chatId, hotels, text);
});

bot.on('polling_error', console.error);
