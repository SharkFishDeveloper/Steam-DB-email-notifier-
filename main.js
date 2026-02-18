import express from "express";
import dotenv from "dotenv";
import { Redis } from "@upstash/redis";
import { sendEmail } from "./sendEmail.js";
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;

const EMAIL_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days



// ================= PRICE CHECK =================

async function checkPrice(game) {
  try {
    const url =
      game.type === "sub"
        ? `https://store.steampowered.com/api/packagedetails?packageids=${game.id}&cc=IN`
        : `https://store.steampowered.com/api/appdetails?appids=${game.id}&cc=IN`;

    // 🚀 Always fetch fresh from Steam (no caching)
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-cache" },
    });

    const data = await res.json();
    const item = data[game.id];

    if (!item?.success) return null;

    const priceInfo =
      game.type === "sub"
        ? item.data.price
        : item.data.price_overview;

    if (!priceInfo) return null;

    const currentPrice = priceInfo.final / 100;

    if (currentPrice === 0) return null;
    if (currentPrice > Number(game.targetPrice)) return null;

    // 🔥 Check last email time
    const lastSent = await redis.get(`last_email_sent:${game.id}`);

    if (lastSent) {
      const now = Date.now();
      const diff = now - Number(lastSent);

      if (diff < EMAIL_INTERVAL_MS) {
        return null; // Not old enough
      }
    }

    return { ...game, currentPrice };
  } catch (err) {
    console.log("Error checking:", game.name);
    return null;
  }
}

// ================= ROUTES =================

// Add game via URL
app.post("/games", async (req, res) => {
  const { url, targetPrice } = req.body;

  if (!url || !targetPrice)
    return res.status(400).json({ error: "URL and targetPrice required" });

  const match = url.match(/store\.steampowered\.com\/(app|sub)\/(\d+)/);
  if (!match)
    return res.status(400).json({ error: "Invalid Steam URL" });

  const type = match[1];
  const id = match[2];

  const apiUrl =
    type === "sub"
      ? `https://store.steampowered.com/api/packagedetails?packageids=${id}&cc=IN`
      : `https://store.steampowered.com/api/appdetails?appids=${id}&cc=IN`;

  const response = await fetch(apiUrl);
  const data = await response.json();
  const item = data[id];

  if (!item?.success)
    return res.status(400).json({ error: "Steam fetch failed" });

  const name = item.data.name;

  await redis.set(`game:${id}`, {
    name,
    type,
    id,
    targetPrice:Number(targetPrice),
  });

  res.json({ message: "Game added", name, id, type, targetPrice });
});

// List games only
app.get("/games", async (req, res) => {
  const keys = await redis.keys("game:*");
  const games = await Promise.all(keys.map((k) => redis.get(k)));
  res.json(games);
});

// Delete by URL or ID
app.delete("/games", async (req, res) => {
  const { url, id } = req.body;

  let gameId = id;

  if (url) {
    const match = url.match(/store\.steampowered\.com\/(app|sub)\/(\d+)/);
    if (!match)
      return res.status(400).json({ error: "Invalid Steam URL" });
    gameId = match[2];
  }

  if (!gameId)
    return res.status(400).json({ error: "Provide url or id" });

  await redis.del(`game:${gameId}`);
  await redis.del(`last_email_sent:${gameId}`);

  res.json({ message: "Game removed", id: gameId });
});

// Trigger price check (parallel + single email)
app.get("/check", async (req, res) => {
  const keys = await redis.keys("game:*");
  const games = await Promise.all(keys.map((k) => redis.get(k)));
  if (games.length === 0) {
  return res.json({ checked: 0, discounted: 0 });
}
  const results = await Promise.all(games.map(checkPrice));
  const discountedGames = results.filter(Boolean);

  if (discountedGames.length > 0) {
    const sent = await sendEmail(discountedGames);

    if (sent) {
    const now = Date.now();

    await Promise.all(
        discountedGames.map((game) =>
        redis.set(`last_email_sent:${game.id}`, now)
        )
    );
    }
  }

  res.json({
    checked: games.length,
    discounted: discountedGames.length,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
