# 🎬 BollyCric Scraper API v2.0

**Railway Deploy Ready** — BollyCric se movies scrape karta hai + Playwright se **exact .mkv/.mp4 download URL** nikalta hai.

---

## 🚀 Railway Deploy Steps

### 1. GitHub par push karo
```bash
git init
git add .
git commit -m "bollycric scraper v2 with playwright"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bollycric-scraper.git
git push -u origin main
```

### 2. Railway par deploy
1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Apna repo select karo
3. Railway **Dockerfile** se build karega — Playwright + Chromium sab auto install
4. ~3-5 minute mein deploy ho jaayega ✅

### 3. Domain milega
```
https://bollycric-scraper-production.up.railway.app
```

> **Note:** Playwright image ki wajah se pehli build ~5 min lagti hai, baad mein fast ho jaata hai.

---

## 📡 API Flow (3 Steps)

```
Step 1: GET /latest  OR  GET /search?q=avatar
           ↓ (movie URL milta hai)
Step 2: GET /movie?url=https://bollycric.com/XXXX.html
           ↓ (nexdrive.help links milte hain)
Step 3: GET /resolve?url=https://nexdrive.help/XXXX/
           ↓
        directUrl: "https://....mkv"  ← EXACT file URL! Browser mein daalo download hoga
```

Ya shortcut: `GET /resolve-all?url=https://bollycric.com/XXXX.html` — teen steps ek mein!

---

## 📋 All Endpoints

### `GET /`
API info

### `GET /latest?page=1`
Homepage latest movies

### `GET /search?q=avatar&page=1`
Search movies

### `GET /movie?url=BOLLYCRIC_URL`
Movie details + nexdrive links
```json
{
  "title": "Welcome to the Jungle 2026",
  "language": "Hindi",
  "year": "2026",
  "quality": "HDTC 720p - 480p - 1080p",
  "synopsis": "...",
  "downloadLinks": [
    { "quality": "480p x264", "size": "519MB", "url": "https://nexdrive.help/genxfm..." },
    { "quality": "720p x264", "size": "1.19GB", "url": "https://nexdrive.help/genxfm..." },
    { "quality": "1080p", "size": "2.5GB", "url": "https://nexdrive.help/genxfm..." }
  ]
}
```

### `GET /resolve?url=NEXDRIVE_URL`  ⭐ MAIN ENDPOINT
Playwright se exact .mkv/.mp4 URL nikalo (10-15 sec lagta hai)
```json
{
  "nexdriveUrl": "https://nexdrive.help/genxfm...",
  "fastDlUrl": "https://fast-dl.one/dl/...",
  "vgmLinksUrl": "https://vgmlinks.live/...",
  "directUrl": "https://storage.googleapis.com/.../movie.mkv",
  "resolved": true
}
```
> `directUrl` ko browser mein daalte hi download shuru ho jaayega! ✅

### `GET /resolve-all?url=BOLLYCRIC_MOVIE_URL`  ⭐ SHORTCUT
Ek movie ke saare quality ke exact URLs ek saath
```json
{
  "title": "Welcome to the Jungle 2026",
  "resolved": [
    { "quality": "480p x264", "size": "519MB", "directUrl": "https://.../movie_480p.mkv" },
    { "quality": "720p x264", "size": "1.19GB", "directUrl": "https://.../movie_720p.mkv" },
    { "quality": "1080p", "size": "2.5GB", "directUrl": "https://.../movie_1080p.mkv" }
  ]
}
```

### `GET /category?path=/bollywood-movies/&page=1`
Category wise movies

### `GET /year?y=2024&page=1`
Year wise movies (2000-2026)

### `GET /genre?g=action&page=1`
Genre wise movies

### `GET /genres`
Saari categories list

### `GET /health`
Server + cache status

---

## ⚙️ Environment Variables

| Var | Default | Use |
|-----|---------|-----|
| `PORT` | `3000` | Railway auto-set karta hai |
| `CHROMIUM_PATH` | auto | Custom chromium path (Railway pe mat set karo) |

---

## 🔧 Local Run

```bash
npm install
npx playwright install chromium  # ← zaruri hai
npm start
```

---

## ⏱️ Performance

| Endpoint | Response Time |
|----------|--------------|
| /latest, /search | ~1-3 sec |
| /movie | ~2-4 sec |
| /resolve (uncached) | ~10-20 sec (Playwright) |
| /resolve (cached) | <100ms |
| /resolve-all | ~30-60 sec (har quality ek ek resolve hoti hai) |

---

## ⚠️ Notes
- `/resolve` rate limit: 10 req/min (Playwright costly hai)
- Download URLs 1-2 ghante ke baad expire ho sakti hain — fresh resolve karo
- Site structure badla toh `scraper.js` ke selectors update karo
