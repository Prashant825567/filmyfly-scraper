// src/scraper.js
// BollyCric / BollyFlix scraper - homepage, search, movie details + download links

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://bollycric.com';

// Axios instance with browser-like headers to avoid blocks
const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: BASE_URL,
    Connection: 'keep-alive',
  },
});

// ─── Helper: fetch page HTML ─────────────────────────────────────────────────
async function fetchHTML(url) {
  try {
    const res = await http.get(url);
    return res.data;
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status}: ${url}`
      : `Network error: ${err.message}`;
    throw new Error(msg);
  }
}

// ─── Helper: parse movie cards from a listing page ───────────────────────────
function parseMovieCards($) {
  const movies = [];

  // Each movie card: article or div with a link + image + title
  $('article, .short-title, .story').each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find('a').first();
    const imgEl = $el.find('img').first();
    const titleEl = $el.find('h3, h2, .short-title').first();

    const link = linkEl.attr('href') || '';
    const title =
      titleEl.text().trim() ||
      linkEl.attr('title') ||
      imgEl.attr('alt') ||
      '';
    const poster =
      imgEl.attr('src') || imgEl.attr('data-src') || '';
    const date = $el.find('.date, time').first().text().trim() || '';

    if (link && title) {
      movies.push({
        title: title.replace(/\s+/g, ' ').trim(),
        url: link.startsWith('http') ? link : BASE_URL + link,
        poster: poster.startsWith('http') ? poster : BASE_URL + poster,
        date,
      });
    }
  });

  // Fallback: generic <h3> inside anchor wrappers (BollyFlix structure)
  if (movies.length === 0) {
    $('h3 a, h2 a').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const title = $el.text().trim() || $el.attr('title') || '';
      const $parent = $el.closest('div, article, li');
      const imgEl = $parent.find('img').first();
      const poster = imgEl.attr('src') || imgEl.attr('data-src') || '';
      const date = $parent.find('.date, time').first().text().trim() || '';

      if (href && title) {
        movies.push({
          title: title.replace(/\s+/g, ' ').trim(),
          url: href.startsWith('http') ? href : BASE_URL + href,
          poster: poster.startsWith('http') ? poster : BASE_URL + poster,
          date,
        });
      }
    });
  }

  return movies;
}

// ─── 1. Get latest movies (homepage, with pagination) ────────────────────────
async function getLatestMovies(page = 1) {
  const url = page === 1 ? BASE_URL + '/' : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const movies = parseMovieCards($);

  // Find total pages from pagination
  let totalPages = 1;
  $('a[href*="/page/"]').each((_, el) => {
    const match = ($(el).attr('href') || '').match(/\/page\/(\d+)\//);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > totalPages) totalPages = n;
    }
  });

  return { page, totalPages, count: movies.length, movies };
}

// ─── 2. Search movies ─────────────────────────────────────────────────────────
async function searchMovies(query, page = 1) {
  // BollyFlix uses ?do=search&subaction=search&search_start=0&full_search=0&story=QUERY
  const encoded = encodeURIComponent(query);
  const url =
    `${BASE_URL}/index.php?do=search&subaction=search&search_start=${(page - 1) * 10}` +
    `&full_search=0&result_from=${(page - 1) * 10 + 1}&story=${encoded}`;

  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const movies = parseMovieCards($);
  return { query, page, count: movies.length, results: movies };
}

// ─── 3. Get full movie details + download links from a movie page ─────────────
async function getMovieDetails(movieUrl) {
  const html = await fetchHTML(movieUrl);
  const $ = cheerio.load(html);

  // Title
  const title = $('h1').first().text().trim();

  // Poster / thumbnail
  const poster =
    $('img[src*="/covers/"]').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    '';

  // Movie info block (Language, Year, Format, Size, Runtime, Quality, Genres)
  const info = {};
  const infoText = $('strong, b')
    .map((_, el) => $(el).text())
    .get();

  // Extract meta from og tags
  info.title = $('meta[property="og:title"]').attr('content') || title;
  info.description =
    $('meta[name="description"]').attr('content') || '';
  info.poster = poster.startsWith('http')
    ? poster
    : BASE_URL + poster;
  info.url = $('link[rel="canonical"]').attr('href') || movieUrl;

  // Parse structured info table (Language, Size, Quality, etc.)
  const bodyText = $('p, div').text();
  const patterns = {
    language: /Language[:\s]+([^\n|]+)/i,
    year: /Release Year[:\s]+(\d{4})/i,
    format: /Format[:\s]+([^\n|]+)/i,
    size: /Size[:\s]+([^\n|]+)/i,
    runtime: /Runtime[:\s]+([^\n|]+)/i,
    quality: /Quality[:\s]+([^\n|]+)/i,
    genres: /Genres[:\s]+([^\n|]+)/i,
  };

  for (const [key, regex] of Object.entries(patterns)) {
    const match = bodyText.match(regex);
    if (match) info[key] = match[1].trim();
  }

  // Synopsis / Plot
  const synopsisEl = $('h3:contains("SYNOPSIS"), h3:contains("PLOT")')
    .next('p')
    .first();
  info.synopsis = synopsisEl.text().trim() || '';

  // Screenshots
  const screenshots = [];
  $('img[src*="screenshot"], img[src*="Screenshot"]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src) screenshots.push(src.startsWith('http') ? src : BASE_URL + src);
  });
  info.screenshots = screenshots;

  // ── Download Links ──────────────────────────────────────────────────────────
  // Links appear as: <a href="https://nexdrive.help/...">Click Here To Download [SIZE]</a>
  // We collect ALL hrefs that are download buttons
  const downloadLinks = [];

  // Pattern 1: nexdrive.help or any external download host
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();

    const isDownloadLink =
      href.includes('nexdrive') ||
      href.includes('gdrive') ||
      href.includes('drive.google') ||
      href.includes('mega.nz') ||
      href.includes('pixeldrain') ||
      href.includes('gofile') ||
      (text.toLowerCase().includes('download') && href.startsWith('http') && !href.includes('bollycric'));

    if (isDownloadLink) {
      // Try to get quality label from surrounding heading
      let quality = '';
      const $el = $(el);
      const prevH3 = $el.prevAll('h3, h4').first().text().trim();
      const prevH4 = $el.closest('p').prevAll('h3, h4').first().text().trim();
      quality = prevH3 || prevH4 || text;

      // Extract file size from button text or label
      const sizeMatch = text.match(/\[([^\]]+)\]/);
      const size = sizeMatch ? sizeMatch[1] : '';

      downloadLinks.push({
        quality: quality.replace(/[⚡🔥]/g, '').trim(),
        label: text.replace(/[⚡🔥]/g, '').trim(),
        size,
        url: href,        // ← exact direct URL — browser mein daalte hi kaam karega
      });
    }
  });

  return {
    title,
    ...info,
    downloadLinks,
    scrapedAt: new Date().toISOString(),
  };
}

// ─── 4. Get movies by category ───────────────────────────────────────────────
async function getByCategory(categoryPath, page = 1) {
  const base = categoryPath.startsWith('http')
    ? categoryPath
    : BASE_URL + '/' + categoryPath.replace(/^\//, '');

  const url = page === 1 ? base : `${base}page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const movies = parseMovieCards($);
  const categoryName =
    $('h1, .category-title, title').first().text().trim() || categoryPath;

  return { category: categoryName, page, count: movies.length, movies };
}

// ─── 5. Get movies by year ────────────────────────────────────────────────────
async function getByYear(year, page = 1) {
  return getByCategory(`/xfsearch/year/${year}/`, page);
}

// ─── 6. Get movies by genre ───────────────────────────────────────────────────
async function getByGenre(genre, page = 1) {
  return getByCategory(`/${genre.toLowerCase()}/`, page);
}

module.exports = {
  getLatestMovies,
  searchMovies,
  getMovieDetails,
  getByCategory,
  getByYear,
  getByGenre,
};
