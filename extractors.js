const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── 1. r2.dev / Cloudflare CDN ──────────────────────────────────────────────
// Already a direct link — just return it as-is
// Format: https://pub-xxx.r2.dev/path/file.mkv?expired=xxx
// Stream: direct pass to ExoPlayer/VideoView
// Download: direct pass to DownloadManager
function extractR2(url) {
  return {
    server: 'CloudFlare R2',
    stream_url: url,
    download_url: url,
    type: 'direct',
    note: 'Direct CDN — best for streaming & download'
  };
}

// ─── 2. Pixeldrain ───────────────────────────────────────────────────────────
// Input:  https://pixeldrain.com/u/FILEID  or  https://aws_amzdlbuket.iwebp.store/u/FILEID
// Output: https://pixeldrain.com/api/file/FILEID  (direct stream/download)
function extractPixeldrain(url) {
  // Get file ID from URL — works for both pixeldrain.com and mirror domains
  const match = url.match(/\/u\/([a-zA-Z0-9]+)/);
  const fileId = match ? match[1] : null;
  if (!fileId) return null;
  return {
    server: 'Pixeldrain',
    stream_url: `https://pixeldrain.com/api/file/${fileId}`,
    download_url: `https://pixeldrain.com/api/file/${fileId}?download`,
    type: 'direct',
    note: 'Pixeldrain direct API — no redirect needed'
  };
}

// ─── 3. GoFile ───────────────────────────────────────────────────────────────
// Input:  https://gofile.io/d/CONTENTID
// Flow:   gofile.io API → get download token → direct link
async function extractGofile(url) {
  try {
    const contentId = url.split('/d/')[1]?.split('?')[0]?.split('/')[0];
    if (!contentId) return null;

    // Step 1: Get guest token
    const tokenRes = await axios.post('https://api.gofile.io/accounts', {}, {
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    const token = tokenRes.data?.data?.token;
    if (!token) throw new Error('No token');

    // Step 2: Get content info with token
    const contentRes = await axios.get(`https://api.gofile.io/contents/${contentId}`, {
      headers: { ...HEADERS, 'Authorization': `Bearer ${token}` },
      params: { wt: '4fd6sg89d7s6' },
      timeout: 10000
    });

    const files = contentRes.data?.data?.children;
    if (!files) throw new Error('No files in gofile');

    const results = [];
    for (const [id, file] of Object.entries(files)) {
      if (file.type === 'file') {
        results.push({
          server: 'GoFile',
          filename: file.name,
          size: file.size,
          stream_url: file.link,
          download_url: file.link,
          type: 'direct',
          note: 'GoFile resolved link'
        });
      }
    }
    return results.length === 1 ? results[0] : results;
  } catch (e) {
    // Fallback - return page link, user can open in browser
    return {
      server: 'GoFile',
      stream_url: url,
      download_url: url,
      type: 'page',
      note: 'GoFile page — open in browser'
    };
  }
}

// ─── 4. BuzzHeavier ──────────────────────────────────────────────────────────
// Input:  https://buzzheavier.com/FILEID
// Flow:   scrape page → find direct download button → extract link
async function extractBuzzheavier(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    const $ = cheerio.load(res.data);

    // BuzzHeavier has a download button with direct link
    const directLink =
      $('a[href*=".mkv"], a[href*=".mp4"]').first().attr('href') ||
      $('a[id="download"], a:contains("Download")').first().attr('href') ||
      $('[data-url]').first().attr('data-url') || '';

    if (directLink && directLink.startsWith('http')) {
      return {
        server: 'BuzzHeavier',
        stream_url: directLink,
        download_url: directLink,
        type: 'direct'
      };
    }

    // Sometimes BuzzHeavier redirects to another host
    const finalUrl = res.request?.res?.responseUrl || url;
    return {
      server: 'BuzzHeavier',
      stream_url: finalUrl,
      download_url: finalUrl,
      type: finalUrl !== url ? 'direct' : 'page'
    };
  } catch (e) {
    return { server: 'BuzzHeavier', stream_url: url, download_url: url, type: 'page' };
  }
}

// ─── 5. filesdl Fast Download (fdownload.php) ────────────────────────────────
// Input:  https://bbbdownload.filesdl.in/fdownload.php?id=BASE64&token=xxx
// This is base64 encoded Google Photos URL → decode → direct
function extractFdownload(url) {
  try {
    const urlObj = new URL(url);
    const b64 = urlObj.searchParams.get('id');
    if (!b64) return null;
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    return {
      server: 'Fast Download',
      stream_url: decoded,
      download_url: decoded,
      type: decoded.includes('google') ? 'googlephotos' : 'direct',
      note: decoded.includes('google') ? 'Google Photos — needs browser' : 'Direct link'
    };
  } catch (e) {
    return { server: 'Fast Download', stream_url: url, download_url: url, type: 'page' };
  }
}

// ─── 6. MediaFire (mf-dl.php) ────────────────────────────────────────────────
// Input:  https://bbbdownload.filesdl.in/dl/mf-dl.php/?fid=BASE64&token=xxx
// Decode fid → MediaFire ID → get direct link via MediaFire API
async function extractMediafire(url) {
  try {
    const urlObj = new URL(url);
    const fidB64 = urlObj.searchParams.get('fid');
    const decoded = fidB64 ? Buffer.from(fidB64, 'base64').toString('utf8') : '';

    // If decoded is a MediaFire key
    if (decoded) {
      const mfRes = await axios.get(`https://www.mediafire.com/api/1.5/file/get_links.php`, {
        params: { quick_key: decoded, response_format: 'json', link_type: 'normal_download' },
        headers: HEADERS,
        timeout: 10000
      });
      const link = mfRes.data?.response?.links?.[0]?.normal_download;
      if (link) return { server: 'MediaFire', stream_url: link, download_url: link, type: 'direct' };
    }

    // Fallback: follow redirect
    const res = await axios.get(url, { headers: HEADERS, timeout: 10000, maxRedirects: 5 });
    return { server: 'MediaFire', stream_url: url, download_url: url, type: 'page' };
  } catch(e) {
    return { server: 'MediaFire', stream_url: url, download_url: url, type: 'page' };
  }
}

// ─── MASTER EXTRACTOR ────────────────────────────────────────────────────────
// Pass any link from filesdl page → get direct stream/download link
async function extractLink(url) {
  if (!url) return null;

  // r2.dev or cloudflare CDN
  if (url.includes('r2.dev') || url.includes('cloudflare') ||
      url.includes('.mkv?') || url.includes('.mp4?')) {
    return extractR2(url);
  }

  // Pixeldrain (including mirror domains like aws_amzdlbuket.iwebp.store)
  if (url.includes('pixeldrain') || url.includes('/u/')) {
    return extractPixeldrain(url);
  }

  // GoFile
  if (url.includes('gofile.io')) {
    return await extractGofile(url);
  }

  // BuzzHeavier
  if (url.includes('buzzheavier')) {
    return await extractBuzzheavier(url);
  }

  // filesdl fast download (base64 encoded)
  if (url.includes('fdownload.php')) {
    return extractFdownload(url);
  }

  // filesdl mediafire
  if (url.includes('mf-dl.php')) {
    return await extractMediafire(url);
  }

  // Unknown — return as-is
  return { server: 'Unknown', stream_url: url, download_url: url, type: 'unknown' };
}

// ─── SCRAPE FILESDL PAGE + EXTRACT ALL LINKS ─────────────────────────────────
async function scrapeAndExtract(filesdlUrl) {
  const res = await axios.get(filesdlUrl, {
    headers: { ...HEADERS, Referer: 'https://linkmake.in/' },
    timeout: 15000
  });
  const $ = cheerio.load(res.data);

  const filename = $('h2, h3').first().text().trim() || $('title').text().trim();
  const size = $('p').filter((i, el) => $(el).text().includes('Size:')).first().text().replace('Size:', '').trim();

  // Collect all raw links from page
  const rawLinks = [];
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && href.startsWith('http') && !href.includes('telegram') && !href.includes('javascript')) {
      rawLinks.push({ label: text || href, url: href });
    }
  });

  // Extract each link
  const extractedLinks = await Promise.allSettled(
    rawLinks.map(async (raw) => {
      const extracted = await extractLink(raw.url);
      return extracted ? { label: raw.label, ...extracted } : null;
    })
  );

  const links = extractedLinks
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .filter(l => l.type !== 'unknown'); // filter out junk links

  return { filename, size, links };
}

module.exports = { extractLink, extractPixeldrain, extractR2, extractGofile, extractBuzzheavier, scrapeAndExtract };
