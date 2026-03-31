require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const storage = require("node-persist");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!TELEGRAM_TOKEN) { console.error("ERROR: TELEGRAM_TOKEN not set"); process.exit(1); }
if (!SERPAPI_KEY) { console.error("ERROR: SERPAPI_KEY not set"); process.exit(1); }

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

(async () => {
  await storage.init({ dir: "src/data" });
  console.log("SmartStay Finder Bot started...");
})();

const userState = {};

function getTomorrowDate() {
  const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0];
}
function getDayAfterDate() {
  const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split("T")[0];
}

const PRICE_FILTERS = {
  budget: { min_price: 0, max_price: 100 },
  midrange: { min_price: 100, max_price: 250 },
  luxury: { min_price: 250, max_price: 10000 },
  any: {}
};

async function searchHotels(query, priceFilter = "any") {
  try {
    const priceParams = PRICE_FILTERS[priceFilter] || {};
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
        ...priceParams
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
  const noDeposit = h.essential_info?.some(e => e.toLowerCase().includes("no deposit") || e.toLowerCase().includes("free cancellation")) ? "✅ No deposit / Free cancel" : "";
  const photo = h.images?.[0]?.thumbnail || null;
  const text =
    (i+1)+". 🏨 "+h.name+"
"+
    "⭐ "+(h.overall_rating ? h.overall_rating+"/5 ("+( h.reviews || "")+" reviews)" : "No rating")+"
"+
    "💰 "+(h.rate_per_night?.lowest ? "From "+h.rate_per_night.lowest+"/night" : "Price N/A")+"
"+
    "📍 "+(h.neighborhood || h.location || "")+"
"+
    (noDeposit ? noDeposit+"
" : "");
  return { text, photo };
}

async function sendHotelResults(chatId, hotels, location) {
  if (hotels.length === 0) {
    bot.sendMessage(chatId, "😕 No hotels found. Try a different location or price range."); return;
  }
  bot.sendMessage(chatId, "🏨 Top hotels in "+location+":
(Showing "+Math.min(hotels.length,10)+" results)");
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
  bot.sendMessage(chatId, "💾 Reply with a number (1-"+Math.min(top.length,10)+") to save a hotel to favorites.");
  userState[chatId] = { lastResults: top, location };
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "🏨 Welcome to SmartStay Finder!

"+
    "Search hotels anywhere by:
"+
    "📍 City name — e.g. Tokyo
"+
    "🔢 ZIP code — e.g. 90210
"+
    "🏠 Address — e.g. Times Square New York
"+
    "📡 Share GPS via 📎 attachment button

"+
    "💰 Filter by price:
"+
    "/budget — under $100/night
"+
    "/midrange — $100-$250/night
"+
    "/luxury — $250+/night
"+
    "/any — no filter

"+
    "⭐ /favorites — view saved hotels
"+
    "🗑 /clearfavorites — clear saved hotels"
  );
});

bot.onText(/\/(budget|midrange|luxury|any)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!userState[chatId]) userState[chatId] = {};
  userState[chatId].priceFilter = match[1];
  const labels = { budget: "💚 Budget (under $100)", midrange: "💛 Mid-range ($100-$250)", luxury: "💎 Luxury ($250+)", any: "🔓 No filter" };
  bot.sendMessage(chatId, labels[match[1]]+" selected!
Now send a city, ZIP, or address to search.");
});

bot.onText(/\/favorites/, async (msg) => {
  const chatId = msg.chat.id;
  const favs = await storage.getItem("favs_"+chatId) || [];
  if (favs.length === 0) { bot.sendMessage(chatId, "⭐ You have no saved hotels yet."); return; }
  let text = "⭐ Your saved hotels:

";
  favs.forEach((h, i) => {
    text += (i+1)+". 🏨 "+h.name+"
💰 "+(h.rate_per_night?.lowest || "N/A")+"/night
📍 "+(h.neighborhood || "")+"

";
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
  const priceFilter = userState[chatId]?.priceFilter || "any";
  const hotels = await searchHotels("hotels near "+city, priceFilter);
  await sendHotelResults(chatId, hotels, city);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const num = parseInt(text.trim());
  if (!isNaN(num) && userState[chatId]?.lastResults) {
    const hotel = userState[chatId].lastResults[num - 1];
    if (hotel) {
      const favs = await storage.getItem("favs_"+chatId) || [];
      const already = favs.some(f => f.name === hotel.name);
      if (already) { bot.sendMessage(chatId, "⭐ Already in your favorites!"); return; }
      favs.push(hotel);
      await storage.setItem("favs_"+chatId, favs);
      bot.sendMessage(chatId, "💾 Saved "+hotel.name+" to favorites! View with /favorites");
      return;
    }
  }

  bot.sendMessage(chatId, "🔍 Searching hotels for \""+text+"\"...");
  const priceFilter = userState[chatId]?.priceFilter || "any";
  const hotels = await searchHotels("hotels in "+text, priceFilter);
  await sendHotelResults(chatId, hotels, text);
});

bot.on("polling_error", console.error);
