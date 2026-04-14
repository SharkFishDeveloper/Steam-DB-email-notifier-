import { Redis } from "@upstash/redis";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG =================
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const GAME_ID = "240";
const PRICE_KEY = `price_history:${GAME_ID}`;
const GAME_KEY = `game:${GAME_ID}`;

// ================= HELPER: get last 5 days @ 9 AM =================
function getLast5Days9AM() {
  const days = [];

  for (let i = 4; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(9, 0, 0, 0); // 9:00 AM

    days.push(d.getTime());
  }

  return days;
}

// ================= SEED DATA =================
const timestamps = getLast5Days9AM();

// realistic pattern (₹480 base)
const prices = [
  { price: 480, discount: 0 },   // 5 days ago
  { price: 480, discount: 0 },   // 4 days ago
  { price: 360, discount: 25 },  // 3 days ago (sale starts)
  { price: 240, discount: 50 },  // 2 days ago (bigger sale)
  { price: 199, discount: 58 },  // today (🔥 near target)
];

// ================= MAIN FUNCTION =================
async function seed() {
  try {
    console.log("🧹 Cleaning old data...");

    await redis.del(PRICE_KEY);
    await redis.del(GAME_KEY);
    await redis.del(`last_email_sent:${GAME_ID}`);

    console.log("📦 Seeding game...");

    await redis.set(GAME_KEY, {
      id: GAME_ID,
      name: "Counter-Strike: Source",
      type: "app",
      targetPrice: 200,
    });

    console.log("📊 Seeding last 5 days @ 9 AM...");

    for (let i = 0; i < timestamps.length; i++) {
      await redis.zadd(PRICE_KEY, {
        score: timestamps[i], // 🔥 use score as time
        member: JSON.stringify({
          price: prices[i].price,
          discount: prices[i].discount,
        }),
      });
    }

    console.log("✅ Seeding complete!");
    console.log("🕘 Data at 9 AM for last 5 days");
  } catch (err) {
    console.error("❌ Seeding failed:", err);
  }
}

// ================= RUN =================
seed();