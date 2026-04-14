import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { Redis } from "@upstash/redis";
import { sendEmail } from "./sendEmail.js";
import cors from "cors";

dotenv.config();

/* ============================================================
   TYPES
============================================================ */
export type EmailGame = {
  id: string;
  name: string;
  type: "app" | "sub";
  targetPrice: number;

  currentPrice: number;
  discount: number;
  previousPrice?: number; // 👈 FIXED
  reasons: AlertReason[];
};

interface Game {
  id: string;
  name: string;
  type: "app" | "sub";
  targetPrice: number;
}

interface PriceData {
  price: number;
  discount: number;
}

interface PriceHistoryEntry extends PriceData {
  time: number;
}

interface AlertItem {
  game: Game;
  currentPrice: number;
  discount: number;
  previousPrice: number | null;
  reasons: AlertReason[];
}

type AlertReason = "target_reached" | "price_dropped";

/* ============================================================
   SETUP
============================================================ */

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: "https://steam-frontend-pearl.vercel.app",
    // origin: "http://localhost:5173",
    methods: ["GET", "POST", "OPTIONS", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

const PORT = process.env.PORT || 10000;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const ALERT_EMAIL = process.env.ALERT_EMAIL!;

const EMAIL_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/* ============================================================
   FETCH CURRENT PRICE FROM STEAM
============================================================ */

async function fetchCurrentPrice(game: Game): Promise<PriceData | null> {
  try {
    const url =
      game.type === "sub"
        ? `https://store.steampowered.com/api/packagedetails?packageids=${game.id}&cc=IN`
        : `https://store.steampowered.com/api/appdetails?appids=${game.id}&cc=IN`;

    const res = await fetch(url, {
      headers: { "Cache-Control": "no-cache" },
    });

    const data = await res.json();
    // console.log(data);
    const item = data[game.id];

    if (!item?.success) return null;

    const priceInfo =
      game.type === "sub" ? item.data.price : item.data.price_overview;

    if (!priceInfo) return null;
    console.log(priceInfo.final / 100,
      priceInfo.discount_percent ?? 0,)

    return {
      price: priceInfo.final / 100,
      discount: priceInfo.discount_percent ?? 0,
    };
  } catch (err) {
    console.error("Steam fetch error:", err);
    return null;
  }
}

/* ============================================================
   STORE PRICE IN HISTORY — always stores, even if unchanged
   Returns the previous price (last stored entry) if any
============================================================ */

async function storePriceHistory(
  game: Game,
  price: number,
  discount: number
): Promise<{ previousPrice: number | null }> {
  const key = `price_history:${game.id}`;
  const now = Date.now();

  // Get last stored entry to compare
  const lastEntries = await redis.zrange<string[]>(key, -1, -1, {
    withScores: true,
  });

  let previousPrice: number | null = null;

  if (lastEntries.length > 0) {
    const raw = (lastEntries[0] as any).member ?? lastEntries[0];
    const parsed: PriceData =
      typeof raw === "string" ? JSON.parse(raw) : raw;
    previousPrice = parsed.price;
  }

  // Always store — timestamp is unique so no dedup issues
  await redis.zadd(key, {
    score: now,
    member: JSON.stringify({ price, discount, t: now }),
  });

  // Trim entries older than 2 years
  await redis.zremrangebyscore(key, 0, now - TWO_YEARS_MS);

  return { previousPrice };
}

/* ============================================================
   ADD GAME
============================================================ */

app.post("/games", async (req: Request, res: Response) => {
  const { url, targetPrice } = req.body as {
    url?: string;
    targetPrice?: number;
  };

  if (!url || !targetPrice)
    return res.status(400).json({ error: "URL and targetPrice required" });

  const match = url.match(/store\.steampowered\.com\/(app|sub)\/(\d+)/);
  if (!match) return res.status(400).json({ error: "Invalid Steam URL" });

  const type = match[1] as "app" | "sub";
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

  const name: string = item.data.name;

  const game: Game = { name, type, id, targetPrice: Number(targetPrice) };
  await redis.set(`game:${id}`, game);

  res.json({ message: "Game added", name, id, type, targetPrice });
});

/* ============================================================
   LIST GAMES
============================================================ */

app.get("/games", async (_req: Request, res: Response) => {
  const keys = await redis.keys("game:*");
  const games = await Promise.all(keys.map((k) => redis.get<Game>(k)));
  res.json(games.filter(Boolean));
});

/* ============================================================
   GET SINGLE GAME WITH CURRENT PRICE + LOWEST
============================================================ */

app.get("/games/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  const game = await redis.get<Game>(`game:${id}`);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const priceData = await fetchCurrentPrice(game);
  if (!priceData) return res.status(400).json({ error: "Price fetch failed" });

  const raw = await redis.zrange<string[]>(`price_history:${id}`, 0, -1, {
    withScores: true,
  });

  const parsed: PriceData[] = raw.map((entry) => {
    const member = (entry as any).member ?? entry;
    return typeof member === "string" ? JSON.parse(member) : member;
  });

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

app.get("/games/:id/history", async (req: Request, res: Response) => {
  const { id } = req.params;

  const raw = await redis.zrange<string[]>(`price_history:${id}`, 0, -1, {
    withScores: true,
  });

  const formatted: PriceHistoryEntry[] = raw.map((entry) => {
    const member = (entry as any).member ?? entry;
    const { t, ...rest }: PriceData & { t?: number } =
      typeof member === "string" ? JSON.parse(member) : member;
    return {
      ...rest,
      time: Number((entry as any).score ?? t),
    };
  });

  res.json(formatted);
});

/* ============================================================
   DELETE GAME
============================================================ */

app.delete("/games", async (req: Request, res: Response) => {
  const { url, id } = req.body as { url?: string; id?: string };

  let gameId = id;

  if (url) {
    const match = url.match(/store\.steampowered\.com\/(app|sub)\/(\d+)/);
    if (!match) return res.status(400).json({ error: "Invalid Steam URL" });
    gameId = match[2];
  }

  if (!gameId) return res.status(400).json({ error: "Provide url or id" });

  await redis.del(`game:${gameId}`);
  await redis.del(`price_history:${gameId}`);
  await redis.del(`last_email_sent:${gameId}`);

  res.json({ message: "Game removed", id: gameId });
});

/* ============================================================
   DAILY CHECK — pinged once by GitHub Actions
   - Always stores current price in history
   - Alerts if: price <= targetPrice OR price < previousPrice
   - One batched email, 5-day cooldown per game
============================================================ */

app.get("/check", async (_req: Request, res: Response) => {
  const keys = await redis.keys("game:*");
  const games = (
    await Promise.all(keys.map((k) => redis.get<Game>(k)))
  ).filter(Boolean) as Game[];

  if (games.length === 0) {
    return res.json({ checked: 0, alerts: [] });
  }

  const now = Date.now();

  const alertsRaw = await Promise.all(
    games.map(async (game): Promise<AlertItem | null> => {
      try {
        const priceData = await fetchCurrentPrice(game);
        if (!priceData) return null;

        // Always store price — no conditions
        const { previousPrice } = await storePriceHistory(
          game,
          priceData.price,
          priceData.discount
        );

        const hitTarget = priceData.price <= game.targetPrice;
        const priceDrop =
          previousPrice !== null && priceData.price < previousPrice;

        if (!hitTarget && !priceDrop) return null;

        // Respect per-game email cooldown
        const lastSent = await redis.get<number>(`last_email_sent:${game.id}`);
        if (lastSent && now - lastSent <= EMAIL_COOLDOWN_MS) return null;

        const reasons: AlertReason[] = [];
        if (hitTarget) reasons.push("target_reached");
        if (priceDrop) reasons.push("price_dropped");

        return {
          game,
          currentPrice: priceData.price,
          discount: priceData.discount,
          previousPrice,
          reasons,
        };
      } catch (err) {
        console.error(`Error processing game ${game.id}:`, err);
        return null;
      }
    })
  );

  const alerts = alertsRaw.filter(Boolean) as AlertItem[];

  if (alerts.length > 0) {
    const emailPayload: EmailGame[] = alerts.map((a) => ({
    ...a.game,
    currentPrice: a.currentPrice,
    discount: a.discount,
    previousPrice: a.previousPrice ?? undefined, // ✅ FIX
    reasons: a.reasons,
    }));

    const sent = await sendEmail(emailPayload, RESEND_API_KEY, ALERT_EMAIL);

    if (sent) {
      await Promise.all(
        alerts.map((a) => redis.set(`last_email_sent:${a.game.id}`, now))
      );
    }
  }

  res.json({
    checked: games.length,
    alerts: alerts.map((a) => ({
      id: a.game.id,
      name: a.game.name,
      currentPrice: a.currentPrice,
      previousPrice: a.previousPrice,
      reasons: a.reasons,
    })),
  });
});

/* ============================================================
   START SERVER
============================================================ */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});