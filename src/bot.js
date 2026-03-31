require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const storage = require("node-persist");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!TELEGRAM_TOKEN) { console.error("ERROR: TELEGRAM_TOKEN not set"); process.exit(1); }
if (!SERPAPI_KEY) { console.error("ERROR: SERPAPI_KEY not set"); process.exit(1); }

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const userState = {};

(async () => {
  await storage.init({ dir: "src/data" });
  console.log("SmartStay Finder Bot started...");
})();

function getTomorrowDate() {
  const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0];
}
function getDayAfterDate() {
  const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split("T")[0];
}

async function searchHotels(query, minPrice=45, maxPrice=85) {
  try {
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "google_hotels",
        q: query,
        api_key: SERPAPI_KEY,
        currency: "USD",
        hl: "en",
        gl: "us",
        check_in_date: getTomorrowDate(),
        check_out_date: getDayAfterDate(),
        adults: 1,
        min_price: minPrice,
        max_price: maxPrice
      }
    });
    return response.data.properties || [];
  } catch (error) {
    console.error("SerpApi error:", error.response?.data || error.message);
    return [];
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      params: { lat, lon, format: "json" },
      headers: { "User-Agent": "SmartStayBot/1.0" }
    });
    const addr = res.data.address;
    return addr.city || addr.town || addr.village || addr.county || lat+","+lon;
  } catch(e) { return lat+","+lon; }
}

function formatHotel(h, i) {
  const noDeposit = h.essential_info?.some(e =>
    e.toLowerCase().includes("no deposit") || e.toLowerCase().includes("free cancellation")
  ) ? "✅ No deposit / Free cancel" : "";
  const photo = h.images?.[0]?.thumbnail || null;
  const text = (i+1)+". 🏨 "+h.name+"\n"+
    "⭐ "+(h.overall_rating ? h.overall_rating+"/5" : "No rating")+"\n"+
    "💰 "+(h.rate_per_night?.lowest ? "From "+h.rate_per_night.lowest+"/night" : "Price N/A")+"\n"+
    "📍 "+(h.neighborhood || h.location || "")+"\n"+
    (noDeposit ? noDeposit+"\n" : "");
  return { text, photo };
}

async function sendHotelResults(chatId, hotels, location) {
  if (hotels.length === 0) {
    bot.sendMessage(chatId, "😕 No hotels found in the $45-$85/night range. Try a different location.");
    return;
  }
  bot.sendMessage(chatId, "🏨 Hotels in "+location+" ($45-$85/night):\n"+Math.min(hotels.length,10)+" results found:");
  const top = hotels.slice(0, 10);
  for (let i = 0; i < top.length; i++) {
    const { text, photo } = formatHotel(top[i], i);
    if (photo) {
      await bot.sendPhoto(chatId, photo, { caption: text }).catch(() => bot.sendMessage(chatId, text));
    } else {
      await bot.sendMessage(chatId, text);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  bot.sendMessage(chatId, "💾 Reply with a number 1-"+Math.min(top.length,10)+" to save a hotel to favorites.");
  userState[chatId] = { lastResults: top, location };
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "🏨 Welcome to SmartStay Finder!\n\n" +
    "Find hotels $45-$85/night anywhere in the world.\n\n" +
    "Search by:\n" +
    "📍 City name — e.g. Tokyo\n" +
    "🔢 ZIP code — e.g. 90210\n" +
    "🏠 Address — e.g. Times Square New York\n" +
    "📡 Share GPS via the 📎 attachment button\n\n" +
    "Commands:\n" +
    "⭐ /favorites — view saved hotels\n" +
    "🗑 /clearfavorites — clear saved hotels"
  );
});

bot.onText(/\/favorites/, async (msg) => {
  const chatId = msg.chat.id;
  const favs = await storage.getItem("favs_"+chatId) || [];
  if (favs.length === 0) { bot.sendMessage(chatId, "⭐ No saved hotels yet."); return; }
  let text = "⭐ Your saved hotels:\n\n";
  favs.forEach((h, i) => {
    text += (i+1)+". 🏨 "+h.name+"\n💰 "+(h.rate_per_night?.lowest || "N/A")+"/night\n📍 "+(h.neighborhood || "")+"\n\n";
  });
  bot.sendMessage(chatId, text);
});

bot.onText(/\/clearfavorites/, async (msg) => {
  await storage.setItem("favs_"+msg.chat.id, []);
  bot.sendMessage(msg.chat.id, "🗑 Favorites cleared.");
});

bot.on("location", async (msg) => {
  const chatId = msg.chat.id;
  const { latitude, longitude } = msg.location;
  bot.sendMessage(chatId, "📡 Got your GPS! Looking up location...");
  const city = await reverseGeocode(latitude, longitude);
  bot.sendMessage(chatId, "🔍 Searching hotels near "+city+"...");
  const hotels = await searchHotels("hotels near "+city);
  await sendHotelResults(chatId, hotels, city);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;
  const num = parseInt(text.trim());
  if (!isNaN(num) && userState[chatId]?.lastResults) {
    const hotel = userState[chatId].lastResults[num-1];
    if (hotel) {
      const favs = await storage.getItem("favs_"+chatId) || [];
      if (favs.some(f => f.name === hotel.name)) {
        bot.sendMessage(chatId, "⭐ Already in favorites!"); return;
      }
      favs.push(hotel);
      await storage.setItem("favs_"+chatId, favs);
      bot.sendMessage(chatId, "💾 Saved "+hotel.name+" to favorites! View with /favorites");
      return;
    }
  }
  bot.sendMessage(chatId, "🔍 Searching hotels for \""+text+"\"...");
  const hotels = await searchHotels("hotels in "+text);
  await sendHotelResults(chatId, hotels, text);
});

bot.on("polling_error", console.error);

const http = require("http");
http.createServer((req, res) => res.end("SmartStay Bot is alive!")).listen(process.env.PORT || 3000);

