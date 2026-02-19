import express from "express";
import dotenv from "dotenv";
import { Redis } from "@upstash/redis";
import { sendEmail } from "./sendEmail.js";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());

app.use(
  cors({
    // origin: "https://steam-frontend-pearl.vercel.app",
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "OPTIONS", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

const PORT = process.env.PORT || 10000;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;

const EMAIL_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const TWO_YEAR = 4 * 180 * 24 * 60 * 60 * 1000;

/* ============================================================
   FETCH CURRENT PRICE FROM STEAM
============================================================ */

async function fetchCurrentPrice(game) {
  try {
    const url =
      game.type === "sub"
        ? `https://store.steampowered.com/api/packagedetails?packageids=${game.id}&cc=IN`
        : `https://store.steampowered.com/api/appdetails?appids=${game.id}&cc=IN`;

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

    return {
      price: priceInfo.final / 100,
      discount: priceInfo.discount_percent || 0,
    };
  } catch (err) {
    console.log("Steam fetch error:", err);
    return null;
  }
}

/* ============================================================
   STORE PRICE HISTORY (ONLY IF CHANGED)
============================================================ */

async function storePriceHistory(game, price, discount) {
  const key = `price_history:${game.id}`;

  const last = await redis.zrange(key, -1, -1);

  if (last.length > 0) {
    const lastData = JSON.parse(last[0]);
    if (lastData.price === price) return;
  }

  await redis.zadd(key, {
    score: Date.now(),
    member: JSON.stringify({ price, discount }),
  });

  // Trim older than 6 months
  const cutoff = Date.now() - TWO_YEAR;
  await redis.zremrangebyscore(key, 0, cutoff);
}

/* ============================================================
   ADD GAME
============================================================ */

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
    targetPrice: Number(targetPrice),
  });

  res.json({ message: "Game added", name, id, type, targetPrice });
});

/* ============================================================
   LIST GAMES (NO PRICE)
============================================================ */

app.get("/games", async (req, res) => {
  const keys = await redis.keys("game:*");
  const games = await Promise.all(keys.map((k) => redis.get(k)));
  res.json(games);
});

/* ============================================================
   GET SINGLE GAME WITH CURRENT PRICE + STATS
============================================================ */

app.get("/games/:id", async (req, res) => {
  const { id } = req.params;

  const game = await redis.get(`game:${id}`);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const priceData = await fetchCurrentPrice(game);
  if (!priceData)
    return res.status(400).json({ error: "Price fetch failed" });

  const history = await redis.zrange(
    `price_history:${id}`,
    0,
    -1
  );

  const parsed = history.map((h) => JSON.parse(h));

  const lowest =
    parsed.length > 0
      ? Math.min(...parsed.map((p) => p.price))
      : priceData.price;

  res.json({
    ...game,
    currentPrice: priceData.price,
    discount: priceData.discount,
    lowestPrice: lowest,
  });
});

/* ============================================================
   GET PRICE HISTORY (GRAPH READY)
============================================================ */

app.get("/games/:id/history", async (req, res) => {
  const { id } = req.params;

  const raw = await redis.zrange(
    `price_history:${id}`,
    0,
    -1,
    { withScores: true }
  );

  const formatted = [];

  for (let i = 0; i < raw.length; i += 2) {
    formatted.push({
      ...JSON.parse(raw[i]),
      time: Number(raw[i + 1]),
    });
  }

  res.json(formatted);
});

/* ============================================================
   DELETE GAME
============================================================ */

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
  await redis.del(`price_history:${gameId}`);
  await redis.del(`last_email_sent:${gameId}`);

  res.json({ message: "Game removed", id: gameId });
});

/* ============================================================
   DAILY CHECK ROUTE
============================================================ */

app.get("/check", async (req, res) => {
  const keys = await redis.keys("game:*");
  const games = await Promise.all(keys.map((k) => redis.get(k)));

  if (games.length === 0) {
    return res.json({ checked: 0 });
  }

  await Promise.all(
    games.map(async (game) => {
      try {
        const priceData = await fetchCurrentPrice(game);
        if (!priceData) return;

        await storePriceHistory(
          game,
          priceData.price,
          priceData.discount
        );

        if (priceData.price <= Number(game.targetPrice)) {
          const lastSent = await redis.get(`last_email_sent:${game.id}`);
          const now = Date.now();

          if (!lastSent || now - Number(lastSent) > EMAIL_INTERVAL_MS) {
            const sent = await sendEmail(
              [{ ...game, currentPrice: priceData.price }],
              RESEND_API_KEY,
              ALERT_EMAIL
            );

            if (sent) {
              await redis.set(`last_email_sent:${game.id}`, now);
            }
          }
        }
      } catch (err) {
        console.log(`Error processing game ${game.id}:`, err);
      }
    })
  );

  res.json({ checked: games.length });
});
/* ============================================================
   START SERVER
============================================================ */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
