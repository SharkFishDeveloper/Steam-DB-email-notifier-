Steam Price Alert API
Lightweight Express server that tracks Steam game prices and sends email alerts when prices fall below your target price.

Built with:

Express

Upstash Redis

Resend (Email API)

Steam Store API

Designed for Render or any Node.js hosting.

BASE URL

https://your-app.onrender.com

ENVIRONMENT VARIABLES

Set these in your deployment environment:

UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
RESEND_API_KEY=your_resend_api_key
ALERT_EMAIL=your_email_to_receive_alerts
PORT=3000

HOW IT WORKS

Add a Steam game using its URL.

The server stores it in Redis.

Call /check endpoint (manually or via cron).

If any game price is less than or equal to your target:

A single summary email is sent.

Cooldown is applied (default 5 days).

No duplicate alerts unless price changes.

API ENDPOINTS

ADD GAME

POST /games

Request Body:

{
"url": "https://store.steampowered.com/app/1196590/
",
"targetPrice": 700
}

What it does:

Extracts app or sub type

Extracts game ID

Fetches real name from Steam

Stores in Redis

Response Example:

{
"message": "Game added",
"name": "Resident Evil Village",
"id": "1196590",
"type": "app",
"targetPrice": 700
}

LIST ALL GAMES

GET /games

Response Example:

[
{
"name": "Resident Evil Village",
"type": "app",
"id": "1196590",
"targetPrice": 700
}
]

DELETE GAME

DELETE /games

Option A: Delete by ID

{
"id": "1196590"
}

Option B: Delete by URL

{
"url": "https://store.steampowered.com/app/1196590/
"
}

Response:

{
"message": "Game removed",
"id": "1196590"
}

TRIGGER PRICE CHECK

GET /check

What it does:

Fetches all games from Redis

Checks prices in parallel using Promise.all

Sends ONE summary email if at least one game matches

Applies cooldown per game

Skips free games

Response Example:

{
"checked": 2,
"discounted": 1
}

COOLDOWN SYSTEM

Default: 5 days

Prevents duplicate alerts

Only blocks if price hasn't changed

Sends new email if price drops further

Cooldown value in code:

const COOLDOWN_SECONDS = 5 * 24 * 60 * 60;

EMAIL BEHAVIOR

Sends one summary email per check

Only if at least one game qualifies

Includes:

Game name

Current price

Target price

Steam link