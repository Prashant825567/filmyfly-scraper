const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { extractLink, scrapeAndExtract } = require('./extractors');

const app = express();
app.use(cors());
app.use(express.json());

const BASE_URL = 'https://filmyfly.luxe';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Cache-Control': 'max-age=0',
};

async function fetchHtml(url, extraHeaders = {}) {
  const res = await axios.get(url, {
    headers: { ...HEADERS, ...extraHeaders, Referer: BASE_URL },
    timeout: 15000,
  });
  return cheerio.load(res.data);
}

// Parse posts from listing page
function parsePosts($) {
  const posts = [];
  $('table').each((i, table) => {
    $(table).find('tr').each((j, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const imgCell = cells.eq(0);
        const infoCell = cells.eq(1);
        const link = imgCell.find('a').attr('href') || infoCell.find('a').attr('href') || '';
        const title = infoCell.find('a').first().text().trim() || imgCell.find('img').attr('alt') || '';
        const image = imgCell.find('img').attr('src') || imgCell.find('img').attr('data-src') || '';
        const category = infoCell.find('a').last().text().trim() || '';
        if (link && title) {
          posts.push({
            title: title.replace(/\s+/g, ' ').trim(),
            link: link.startsWith('http') ? link : BASE_URL + link,
            image: image.startsWith('//') ? 'https:' + image : image,
            category,
          });
        }
      }
    });
  });
  return posts;
}

// Scrape movie detail page
async function scrapeDetail(movieUrl) {
  const $ = await fetchHtml(movieUrl);
  const title = $('h2').first().text().trim() || $('h1').first().text().trim() || '';
  const image = $('img[src*="imagecloud"], img[src*="poster"]').first().attr('src') ||
                $('meta[property="og:image"]').attr('content') || '';
  const description = $('meta[name="description"]').attr('content') || '';
  const info = {};
  $('p, li').each((i, el) => {
    const text = $(el).text();
    const match = text.match(/^(Name|Genre|Duration|Release Date|Language|Starcast|Size|Description):\s*(.+)/s);
    if (match) info[match[1].toLowerCase().replace(' ', '_')] = match[2].trim();
  });
  const linkmakerUrl = $('a[href*="linkmake.in"], a:contains("Download 480p"), a:contains("Download")').first().attr('href') || '';
  return {
    title,
    image: image.startsWith('//') ? 'https:' + image : image,
    genre: info.genre || '',
    duration: info.duration || '',
    release_date: info.release_date || '',
    language: info.language || '',
    cast: info.starcast || '',
    size: info.size || '',
    description,
    linkmake_url: linkmakerUrl,
  };
}

// linkmake → filesdl links
async function resolveLinkmake(linkmakerUrl) {
  const $ = await fetchHtml(linkmakerUrl, { Referer: BASE_URL });
  const links = [];
  $('a[href*="filesdl"]').each((i, el) => {
    const href = $(el).attr('href');
    const label = $(el).text().trim();
    if (href) links.push({ label, url: href });
  });
  return links;
}

// ══════════════════════════════
// ROUTES
// ══════════════════════════════

app.get('/', (req, res) => {
  res.json({
    status: 'ok', name: 'FilmyFly Scraper API', version: '2.0.0',
    endpoints: {
      posts:    'GET /api/posts?page=1',
      search:   'GET /api/search?q=movie+name',
      category: 'GET /api/category?id=21&name=South-Hindi-Dubbed-Movie',
      detail:   'GET /api/detail?url=MOVIE_URL',
      links:    'GET /api/links?url=LINKMAKE_URL  → filesdl quality list',
      stream:   'GET /api/stream?url=FILESDL_URL  → direct stream+download links',
      full:     'GET /api/full?url=MOVIE_URL      → everything in one shot ⭐',
      catalogs: 'GET /api/catalogs',
    }
  });
});

app.get('/api/catalogs', (req, res) => {
  res.json({ success: true, catalogs: [
    { title: 'Latest', type: 'posts' },
    { title: 'Bollywood', type: 'category', id: 1, name: 'Bollywood-Hindi-Movies' },
    { title: 'Hollywood', type: 'category', id: 4, name: 'Hollywood-Hindi-Movies' },
    { title: 'South Hindi', type: 'category', id: 21, name: 'South-Hindi-Dubbed-Movie' },
    { title: 'Web Series', type: 'category', id: 42, name: 'Web-Series' },
    { title: 'HQ Dubbed', type: 'category', id: 58, name: 'HQ-Dubbed-Movies-UnCut' },
    { title: 'Animation', type: 'category', id: 73, name: 'Animation-Movies' },
    { title: 'Marvel', type: 'category', id: 78, name: 'Marvel-Hollywood-Movies' },
    { title: 'Punjabi', type: 'category', id: 15, name: 'Punjabi-Movies' },
  ]});
});

app.get('/api/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = page === 1 ? BASE_URL : `${BASE_URL}/?page=${page}`;
    const $ = await fetchHtml(url);
    const posts = parsePosts($);
    res.json({ success: true, page, count: posts.length, posts });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q, page = 1 } = req.query;
    if (!q) return res.status(400).json({ success: false, error: 'q required' });
    const url = `${BASE_URL}/?s=${encodeURIComponent(q)}&page=${page}`;
    const $ = await fetchHtml(url);
    const posts = parsePosts($);
    res.json({ success: true, query: q, count: posts.length, posts });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/category', async (req, res) => {
  try {
    const { id, name, page = 1 } = req.query;
    if (!id || !name) return res.status(400).json({ success: false, error: 'id and name required' });
    const url = `${BASE_URL}/page-category/${id}/${name}.html?page=${page}`;
    const $ = await fetchHtml(url);
    const posts = parsePosts($);
    res.json({ success: true, category: name, count: posts.length, posts });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/detail', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'url required' });
    const detail = await scrapeDetail(url);
    res.json({ success: true, detail });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/links', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'url required' });
    const links = await resolveLinkmake(url);
    res.json({ success: true, count: links.length, links });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ⭐ KEY ENDPOINT: filesdl URL → direct stream + download links
app.get('/api/stream', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'url required' });
    const result = await scrapeAndExtract(url);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ⭐⭐ FULL CHAIN: movie page → all quality groups → all stream+download links
app.get('/api/full', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'url required' });

    // Step 1: Movie detail
    const detail = await scrapeDetail(url);

    let qualityGroups = [];

    if (detail.linkmake_url) {
      // Step 2: linkmake → filesdl quality links
      const filesdlLinks = await resolveLinkmake(detail.linkmake_url);

      // Step 3: Each filesdl link → extract all direct stream/download links
      const results = await Promise.allSettled(
        filesdlLinks.map(async (f) => {
          const extracted = await scrapeAndExtract(f.url);
          return {
            quality_label: f.label,   // e.g. "Download 520Mb {480p-HEVC}"
            filename: extracted.filename,
            size: extracted.size,
            links: extracted.links,   // [{server, stream_url, download_url, type}]
          };
        })
      );

      qualityGroups = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)
        .filter(g => g.links && g.links.length > 0);
    }

    res.json({
      success: true,
      detail,
      quality_groups: qualityGroups,
      // Best picks for Android app:
      best_stream: qualityGroups[0]?.links?.find(l => l.type === 'direct')?.stream_url || null,
      best_download: qualityGroups[0]?.links?.find(l => l.type === 'direct')?.download_url || null,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎬 FilmyFly API v2 running on port ${PORT}`);
  console.log(`\nTest: http://localhost:${PORT}/api/posts`);
  console.log(`Full: http://localhost:${PORT}/api/full?url=https://filmyfly.luxe/page-download/6773/Junior-2025-Hindi-Telugu-Dual-Audio-UnCut-South-Movie-HD-ESub.html`);
});
