import express from "express";
import dotenv from "dotenv";
import { Redis } from "@upstash/redis";

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

const COOLDOWN_SECONDS = 5 * 24 * 60 * 60; // 5 days

// ================= EMAIL =================

async function sendEmail(discountedGames) {
  const gameCards = discountedGames
    .map(
      (game) => `
      <tr>
        <td style="padding:20px;border-bottom:1px solid #eee;">
          <h3 style="margin:0 0 8px 0;color:#1b2838;">${game.name}</h3>
          <p style="margin:4px 0;">
            <span style="font-weight:bold;">Current:</span> ₹${game.currentPrice}
          </p>
          <p style="margin:4px 0;">
            <span style="font-weight:bold;">Your Target:</span> ₹${game.targetPrice}
          </p>
          <a href="https://store.steampowered.com/${game.type}/${game.id}"
             style="display:inline-block;margin-top:10px;
             padding:8px 16px;
             background:#171a21;
             color:white;
             text-decoration:none;
             border-radius:6px;
             font-size:14px;">
             View on Steam
          </a>
        </td>
      </tr>
    `
    )
    .join("");

  const html = `
  <div style="font-family:Arial,sans-serif;background:#f4f6f8;padding:30px;">
    <table width="100%" style="max-width:600px;margin:auto;background:white;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="background:#171a21;color:white;padding:20px;text-align:center;">
          <h2 style="margin:0;"> Steam Price Alerts</h2>
          <p style="margin:6px 0 0 0;font-size:14px;">
            ${discountedGames.length} game(s) matched your target
          </p>
        </td>
      </tr>
      ${gameCards}
      <tr>
        <td style="padding:15px;text-align:center;font-size:12px;color:#888;">
          Cooldown active for 5 days per game.
        </td>
      </tr>
    </table>
  </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "noreply@codeheroes.store",
      to: [ALERT_EMAIL],
      subject: ` ${discountedGames.length} Steam Game(s) On Sale!`,
      html,
    }),
  });

  return response.ok;
}

// ================= PRICE CHECK =================

async function checkPrice(game) {
  try {
    const url =
      game.type === "sub"
        ? `https://store.steampowered.com/api/packagedetails?packageids=${game.id}&cc=IN`
        : `https://store.steampowered.com/api/appdetails?appids=${game.id}&cc=IN`;

    const res = await fetch(url);
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
    if (currentPrice > game.targetPrice) return null;

    const cooldown = await redis.get(`cooldown:${game.id}`);
    if (cooldown) return null;

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
    targetPrice,
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
  await redis.del(`cooldown:${gameId}`);

  res.json({ message: "Game removed", id: gameId });
});

// Trigger price check (parallel + single email)
app.get("/check", async (req, res) => {
  const keys = await redis.keys("game:*");
  const games = await Promise.all(keys.map((k) => redis.get(k)));

  const results = await Promise.all(games.map(checkPrice));
  const discountedGames = results.filter(Boolean);

  if (discountedGames.length > 0) {
    const sent = await sendEmail(discountedGames);

    if (sent) {
      await Promise.all(
        discountedGames.map((game) =>
          redis.set(`cooldown:${game.id}`, game.currentPrice, {
            ex: COOLDOWN_SECONDS,
          })
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
