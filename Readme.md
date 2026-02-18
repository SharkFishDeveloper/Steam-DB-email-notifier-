# Steam Price Alert API – Endpoints

## 1. Add Game

**POST** `/games`

Add a Steam game using its store URL.

### Request Body

```json
{
  "url": "https://store.steampowered.com/app/1196590/",
  "targetPrice": 700
}
```
```json
{
  "message": "Game added",
  "name": "Resident Evil Village",
  "id": "1196590",
  "type": "app",
  "targetPrice": 700
}
```

## 2. List all Games

**GET** `/games`

Returns all tracked games.

### Request Body

```json
[
  {
    "name": "Resident Evil Village",
    "type": "app",
    "id": "1196590",
    "targetPrice": 700
  }
]
```

## 3. Delete Game

**DELETE** `/games`
```json
Delete a game by ID or Steam URL.

Option A – Delete by ID
{
  "id": "1196590"
}
```
```json
Option B – Delete by URL
{
  "url": "https://store.steampowered.com/app/1196590/"
}
```
Response 
```json
{
  "message": "Game removed",
  "id": "1196590"
}
```

## 4. Trigger Price Check

**GET** `/check`

Triggers price check for all stored games.

Response
```json
{
  "checked": 2,
  "discounted": 1
}
```
