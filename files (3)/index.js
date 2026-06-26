// src/index.js
// BollyCric Scraper API — Railway Deploy Ready
// Routes: /latest, /search, /movie, /resolve, /category, /year, /genre

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const scraper = require('./scraper');
const { resolveDownloadChain } = require('./resolver');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache: listing pages 10 min, movie details 5 min, resolved URLs 30 min
const listCache  = new NodeCache({ stdTTL: 600 });
const movieCache = new NodeCache({ stdTTL: 300 });
const dlCache    = new NodeCache({ stdTTL: 1800 }); // 30 min — URLs expire hote hain

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Rate limit — /resolve heavy hai, uske liye alag limit
const generalLimiter = rateLimit({ windowMs: 60000, max: 60 });
const resolveLimiter = rateLimit({
  windowMs: 60000,
  max: 10, // Playwright calls costly hain
  message: { error: 'Resolve limit: max 10/min. Har call browser open karta hai!' },
});

app.use('/resolve', resolveLimiter);
app.use(generalLimiter);

// ─── Error handler ────────────────────────────────────────────────────────────
function handleError(res, err) {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    error: 'Failed',
    message: err.message,
    tip: 'Site down ho sakti hai ya structure change hua ho. Retry karo.',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET / ── API Info ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: '🎬 BollyCric Scraper API',
    version: '2.0.0',
    endpoints: {
      'GET /latest':   '?page=1  — Homepage se latest movies',
      'GET /search':   '?q=avatar&page=1  — Movie search',
      'GET /movie':    '?url=https://bollycric.com/XXXX.html  — Movie details + nexdrive links',
      'GET /resolve':  '?url=https://nexdrive.help/XXXX/  — Playwright se EXACT .mkv/.mp4 URL nikalo',
      'GET /category': '?path=/bollywood-movies/&page=1  — Category movies',
      'GET /year':     '?y=2024&page=1  — Year wise movies',
      'GET /genre':    '?g=action&page=1  — Genre wise movies',
      'GET /genres':   'Saare genres + categories list',
      'GET /health':   'Server status',
    },
    flow: '1) /latest ya /search se movie URL lo → 2) /movie se nexdrive links lo → 3) /resolve se exact .mkv URL lo',
    note: '/resolve Playwright use karta hai — thoda slow hai (~10-15 sec) but exact direct URL milta hai',
  });
});

// ─── GET /latest ─────────────────────────────────────────────────────────────
app.get('/latest', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const key = `latest_${page}`;
  const cached = listCache.get(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const data = await scraper.getLatestMovies(page);
    listCache.set(key, data);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─── GET /search ──────────────────────────────────────────────────────────────
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '"q" param required. Example: /search?q=avatar' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const key = `search_${q}_${page}`;
  const cached = listCache.get(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const data = await scraper.searchMovies(q, page);
    listCache.set(key, data);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─── GET /movie ── Movie details + nexdrive links ────────────────────────────
app.get('/movie', async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!url) return res.status(400).json({
    error: '"url" param required.',
    example: '/movie?url=https://bollycric.com/218568-welcome-to-the-jungle-2026.html',
  });
  if (!url.includes('bollycric.com')) {
    return res.status(400).json({ error: 'URL bollycric.com ka hona chahiye' });
  }

  const key = `movie_${url}`;
  const cached = movieCache.get(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const data = await scraper.getMovieDetails(url);
    movieCache.set(key, data);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─── GET /resolve ── MAIN ENDPOINT: nexdrive → actual .mkv/.mp4 URL ──────────
// Playwright se pura chain resolve karta hai
// Response mein directUrl = actual file URL jo browser mein daalne par download hoga
app.get('/resolve', async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!url) return res.status(400).json({
    error: '"url" param required.',
    example: '/resolve?url=https://nexdrive.help/genxfm591649078983460/',
    tip: '/movie endpoint se downloadLinks[].url lo, usse yahan pass karo',
  });

  if (!url.includes('nexdrive') && !url.includes('fast-dl') && !url.includes('vgmlinks')) {
    return res.status(400).json({
      error: 'URL nexdrive.help, fast-dl.one, ya vgmlinks.live ka hona chahiye',
    });
  }

  // Cache check
  const key = `dl_${url}`;
  const cached = dlCache.get(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const result = await resolveDownloadChain(url);
    if (result.resolved) {
      dlCache.set(key, result);
    }
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// ─── GET /resolve-all ── Ek movie ke SAARE quality links ek saath resolve karo
app.get('/resolve-all', async (req, res) => {
  const movieUrl = (req.query.url || '').trim();
  if (!movieUrl || !movieUrl.includes('bollycric.com')) {
    return res.status(400).json({
      error: '"url" param chahiye (bollycric.com movie page URL)',
      example: '/resolve-all?url=https://bollycric.com/218568-welcome-to-the-jungle-2026.html',
    });
  }

  try {
    // Step 1: Movie details lo
    const movieData = await scraper.getMovieDetails(movieUrl);
    const nexdriveLinks = movieData.downloadLinks.filter(
      (l) => l.url && (l.url.includes('nexdrive') || l.url.includes('fast-dl') || l.url.includes('vgmlinks'))
    );

    if (nexdriveLinks.length === 0) {
      return res.json({ ...movieData, resolved: [], message: 'Koi nexdrive link nahi mila' });
    }

    // Step 2: Har quality ke liye resolve karo (parallel nahi — browser crash se bachne ke liye sequential)
    const resolved = [];
    for (const link of nexdriveLinks) {
      try {
        const result = await resolveDownloadChain(link.url);
        resolved.push({
          quality: link.quality,
          size: link.size,
          nexdriveUrl: link.url,
          directUrl: result.directUrl,  // ← EXACT .mkv/.mp4 URL
          fastDlUrl: result.fastDlUrl,
          vgmLinksUrl: result.vgmLinksUrl,
          resolved: result.resolved,
        });
      } catch (e) {
        resolved.push({
          quality: link.quality,
          size: link.size,
          nexdriveUrl: link.url,
          directUrl: null,
          error: e.message,
          resolved: false,
        });
      }
    }

    res.json({
      title: movieData.title,
      poster: movieData.poster,
      language: movieData.language,
      year: movieData.year,
      synopsis: movieData.synopsis,
      resolved,
    });
  } catch (err) { handleError(res, err); }
});

// ─── GET /category ────────────────────────────────────────────────────────────
app.get('/category', async (req, res) => {
  const path = (req.query.path || '').trim();
  if (!path) return res.status(400).json({
    error: '"path" param required.',
    example: '/category?path=/bollywood-movies/&page=1',
  });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const key = `cat_${path}_${page}`;
  const cached = listCache.get(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const data = await scraper.getByCategory(path, page);
    listCache.set(key, data);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─── GET /year ────────────────────────────────────────────────────────────────
app.get('/year', async (req, res) => {
  const y = (req.query.y || '').trim();
  if (!y || !/^\d{4}$/.test(y)) {
    return res.status(400).json({ error: 'Valid 4-digit year chahiye. Example: /year?y=2024' });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const key = `year_${y}_${page}`;
  const cached = listCache.get(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const data = await scraper.getByYear(y, page);
    listCache.set(key, data);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─── GET /genre ───────────────────────────────────────────────────────────────
app.get('/genre', async (req, res) => {
  const g = (req.query.g || '').trim();
  if (!g) return res.status(400).json({
    error: '"g" param required. Example: /genre?g=action',
    valid: ['action','adventure','animation','comedy','crime','documentary','drama','family','fantasy','history','horror','mystery','romance','thriller','war','cartoon'],
  });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const key = `genre_${g}_${page}`;
  const cached = listCache.get(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const data = await scraper.getByGenre(g, page);
    listCache.set(key, data);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─── GET /genres ──────────────────────────────────────────────────────────────
app.get('/genres', (req, res) => {
  res.json({
    genres: ['action','adventure','animation','comedy','crime','documentary','drama','family','fantasy','history','horror','mystery','romance','thriller','war','cartoon'],
    categories: [
      { name: 'Bollywood Movies', path: '/bollywood-movies/' },
      { name: 'Hollywood Movies', path: '/hollywood-movies/' },
      { name: 'Dual Audio Movies', path: '/dual-audio-hindi-english-movies/' },
      { name: 'Telugu Movies', path: '/telugu-movies-free-download/' },
      { name: 'Tamil Movies', path: '/tamil-movies/' },
      { name: 'Web Series', path: '/tv-shows/' },
      { name: 'Hindi Web Series', path: '/web-series-hindi/' },
      { name: 'Punjabi Movies', path: '/punjabi-movies/' },
      { name: 'South Indian 300MB', path: '/south-indian-dubbed-movies-300mb/' },
      { name: 'South Indian 720p', path: '/south-indian-dubbed-movies-download/' },
    ],
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    cache: {
      list: listCache.getStats(),
      movie: movieCache.getStats(),
      download: dlCache.getStats(),
    },
  });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', docs: 'GET / dekho' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 BollyCric Scraper API — port ${PORT}`);
  console.log(`🚂 Railway ready!`);
});
