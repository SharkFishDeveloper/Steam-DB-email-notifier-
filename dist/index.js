"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const redis_1 = require("@upstash/redis");
const sendEmail_js_1 = require("./sendEmail.js");
const cors_1 = __importDefault(require("cors"));
dotenv_1.default.config();
/* ============================================================
   SETUP
============================================================ */
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    // origin: "https://steam-frontend-pearl.vercel.app",
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "OPTIONS", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
}));
const PORT = process.env.PORT || 10000;
const redis = new redis_1.Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;
const EMAIL_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
/* ============================================================
   FETCH CURRENT PRICE FROM STEAM
============================================================ */
function fetchCurrentPrice(game) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const url = game.type === "sub"
                ? `https://store.steampowered.com/api/packagedetails?packageids=${game.id}&cc=IN`
                : `https://store.steampowered.com/api/appdetails?appids=${game.id}&cc=IN`;
            const res = yield fetch(url, {
                headers: { "Cache-Control": "no-cache" },
            });
            const data = yield res.json();
            // console.log(data);
            const item = data[game.id];
            if (!(item === null || item === void 0 ? void 0 : item.success))
                return null;
            const priceInfo = game.type === "sub" ? item.data.price : item.data.price_overview;
            if (!priceInfo)
                return null;
            console.log(priceInfo.final / 100, (_a = priceInfo.discount_percent) !== null && _a !== void 0 ? _a : 0);
            return {
                price: priceInfo.final / 100,
                discount: (_b = priceInfo.discount_percent) !== null && _b !== void 0 ? _b : 0,
            };
        }
        catch (err) {
            console.error("Steam fetch error:", err);
            return null;
        }
    });
}
/* ============================================================
   STORE PRICE IN HISTORY — always stores, even if unchanged
   Returns the previous price (last stored entry) if any
============================================================ */
function storePriceHistory(game, price, discount) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const key = `price_history:${game.id}`;
        const now = Date.now();
        // Get last stored entry to compare
        const lastEntries = yield redis.zrange(key, -1, -1, {
            withScores: true,
        });
        let previousPrice = null;
        if (lastEntries.length > 0) {
            const raw = (_a = lastEntries[0].member) !== null && _a !== void 0 ? _a : lastEntries[0];
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            previousPrice = parsed.price;
        }
        // Always store — timestamp is unique so no dedup issues
        yield redis.zadd(key, {
            score: now,
            member: JSON.stringify({ price, discount, t: now }),
        });
        // Trim entries older than 2 years
        yield redis.zremrangebyscore(key, 0, now - TWO_YEARS_MS);
        return { previousPrice };
    });
}
/* ============================================================
   ADD GAME
============================================================ */
app.post("/games", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url, targetPrice } = req.body;
    if (!url || !targetPrice)
        return res.status(400).json({ error: "URL and targetPrice required" });
    const match = url.match(/store\.steampowered\.com\/(app|sub)\/(\d+)/);
    if (!match)
        return res.status(400).json({ error: "Invalid Steam URL" });
    const type = match[1];
    const id = match[2];
    const apiUrl = type === "sub"
        ? `https://store.steampowered.com/api/packagedetails?packageids=${id}&cc=IN`
        : `https://store.steampowered.com/api/appdetails?appids=${id}&cc=IN`;
    const response = yield fetch(apiUrl);
    const data = yield response.json();
    const item = data[id];
    if (!(item === null || item === void 0 ? void 0 : item.success))
        return res.status(400).json({ error: "Steam fetch failed" });
    const name = item.data.name;
    const game = { name, type, id, targetPrice: Number(targetPrice) };
    yield redis.set(`game:${id}`, game);
    res.json({ message: "Game added", name, id, type, targetPrice });
}));
/* ============================================================
   LIST GAMES
============================================================ */
app.get("/games", (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const keys = yield redis.keys("game:*");
    const games = yield Promise.all(keys.map((k) => redis.get(k)));
    res.json(games.filter(Boolean));
}));
/* ============================================================
   GET SINGLE GAME WITH CURRENT PRICE + LOWEST
============================================================ */
app.get("/games/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const game = yield redis.get(`game:${id}`);
    if (!game)
        return res.status(404).json({ error: "Game not found" });
    const priceData = yield fetchCurrentPrice(game);
    if (!priceData)
        return res.status(400).json({ error: "Price fetch failed" });
    const raw = yield redis.zrange(`price_history:${id}`, 0, -1, {
        withScores: true,
    });
    const parsed = raw.map((entry) => {
        var _a;
        const member = (_a = entry.member) !== null && _a !== void 0 ? _a : entry;
        return typeof member === "string" ? JSON.parse(member) : member;
    });
    const lowest = parsed.length > 0
        ? Math.min(...parsed.map((p) => p.price))
        : priceData.price;
    res.json(Object.assign(Object.assign({}, game), { currentPrice: priceData.price, discount: priceData.discount, lowestPrice: lowest }));
}));
/* ============================================================
   GET PRICE HISTORY (GRAPH READY)
============================================================ */
app.get("/games/:id/history", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const raw = yield redis.zrange(`price_history:${id}`, 0, -1, {
        withScores: true,
    });
    const formatted = raw.map((entry) => {
        var _a, _b;
        const member = (_a = entry.member) !== null && _a !== void 0 ? _a : entry;
        const _c = typeof member === "string" ? JSON.parse(member) : member, { t } = _c, rest = __rest(_c, ["t"]);
        return Object.assign(Object.assign({}, rest), { time: Number((_b = entry.score) !== null && _b !== void 0 ? _b : t) });
    });
    res.json(formatted);
}));
/* ============================================================
   DELETE GAME
============================================================ */
app.delete("/games", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
    yield redis.del(`game:${gameId}`);
    yield redis.del(`price_history:${gameId}`);
    yield redis.del(`last_email_sent:${gameId}`);
    res.json({ message: "Game removed", id: gameId });
}));
/* ============================================================
   DAILY CHECK — pinged once by GitHub Actions
   - Always stores current price in history
   - Alerts if: price <= targetPrice OR price < previousPrice
   - One batched email, 5-day cooldown per game
============================================================ */
app.get("/check", (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const keys = yield redis.keys("game:*");
    const games = (yield Promise.all(keys.map((k) => redis.get(k)))).filter(Boolean);
    if (games.length === 0) {
        return res.json({ checked: 0, alerts: [] });
    }
    const now = Date.now();
    const alertsRaw = yield Promise.all(games.map((game) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const priceData = yield fetchCurrentPrice(game);
            if (!priceData)
                return null;
            // Always store price — no conditions
            const { previousPrice } = yield storePriceHistory(game, priceData.price, priceData.discount);
            const hitTarget = priceData.price <= game.targetPrice;
            const priceDrop = previousPrice !== null && priceData.price < previousPrice;
            if (!hitTarget && !priceDrop)
                return null;
            // Respect per-game email cooldown
            const lastSent = yield redis.get(`last_email_sent:${game.id}`);
            if (lastSent && now - lastSent <= EMAIL_COOLDOWN_MS)
                return null;
            const reasons = [];
            if (hitTarget)
                reasons.push("target_reached");
            if (priceDrop)
                reasons.push("price_dropped");
            return {
                game,
                currentPrice: priceData.price,
                discount: priceData.discount,
                previousPrice,
                reasons,
            };
        }
        catch (err) {
            console.error(`Error processing game ${game.id}:`, err);
            return null;
        }
    })));
    const alerts = alertsRaw.filter(Boolean);
    if (alerts.length > 0) {
        const emailPayload = alerts.map((a) => {
            var _a;
            return (Object.assign(Object.assign({}, a.game), { currentPrice: a.currentPrice, discount: a.discount, previousPrice: (_a = a.previousPrice) !== null && _a !== void 0 ? _a : undefined, reasons: a.reasons }));
        });
        const sent = yield (0, sendEmail_js_1.sendEmail)(emailPayload, RESEND_API_KEY, ALERT_EMAIL);
        if (sent) {
            yield Promise.all(alerts.map((a) => redis.set(`last_email_sent:${a.game.id}`, now)));
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
}));
/* ============================================================
   START SERVER
============================================================ */
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
