// src/resolver.js
// Playwright se download chain resolve karta hai:
// bollycric.com → nexdrive.help → fast-dl.one / vgmlinks → actual .mkv/.mp4 URL

const { chromium } = require('playwright');

// Railway par chromium path — nixpacks Dockerfile mein install hoga
// Local ya custom path env se override kar sakte ho
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || null; // null = playwright apna dhundega

// Browser pool — ek hi browser instance reuse karo performance ke liye
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--single-process',           // Railway jaise containers ke liye
      '--no-zygote',
    ],
  };

  if (CHROMIUM_PATH) {
    launchOptions.executablePath = CHROMIUM_PATH;
  }

  browserInstance = await chromium.launch(launchOptions);

  // Crash hone par reset karo
  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });

  return browserInstance;
}

// ─── Step 1: nexdrive.help → fast-dl.one + vgmlinks links nikalo ─────────────
async function resolveNexdrive(nexdriveUrl) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    acceptDownloads: true,
  });

  const page = await context.newPage();

  try {
    await page.goto(nexdriveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // JS render hone do

    // Saare links nikalo
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map((el) => ({
        text: el.textContent.trim(),
        href: el.href,
      }));
    });

    // fast-dl.one aur vgmlinks dhundho
    const fastDlLink = links.find((l) => l.href.includes('fast-dl'));
    const vgmLink = links.find((l) => l.href.includes('vgmlinks'));
    const gdrive = links.find(
      (l) => l.href.includes('drive.google') || l.href.includes('gdrive')
    );

    return {
      fastDl: fastDlLink ? fastDlLink.href : null,
      vgmLinks: vgmLink ? vgmLink.href : null,
      gdrive: gdrive ? gdrive.href : null,
      allLinks: links,
    };
  } finally {
    await page.close();
    await context.close();
  }
}

// ─── Step 2: fast-dl.one → "Click to verify" click karke actual URL nikalo ───
async function resolveFastDl(fastDlUrl) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    acceptDownloads: true,
  });

  const page = await context.newPage();

  // Download URL track karne ke liye
  let finalDownloadUrl = null;

  // Network requests monitor karo — actual file URL yahan milega
  page.on('request', (req) => {
    const url = req.url();
    // .mkv, .mp4, ya large file download detect karo
    if (
      url.match(/\.(mkv|mp4|avi|mov|zip|rar)(\?|$)/i) ||
      url.includes('googlevideo.com') ||
      url.includes('storage.googleapis.com') ||
      (url.includes('download') && url.startsWith('https'))
    ) {
      finalDownloadUrl = url;
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    const cd = res.headers()['content-disposition'] || '';
    if (
      ct.includes('video/') ||
      ct.includes('application/octet-stream') ||
      cd.includes('attachment') ||
      url.match(/\.(mkv|mp4|avi)(\?|$)/i)
    ) {
      finalDownloadUrl = url;
    }
  });

  try {
    // fast-dl.one open karo
    await page.goto(fastDlUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // "Click to verify" ya "Download Now" button dhundho aur click karo
    const buttonSelectors = [
      'button:has-text("verify")',
      'button:has-text("Verify")',
      'button:has-text("Download")',
      'button:has-text("download")',
      'a:has-text("Download Now")',
      'a:has-text("Click to verify")',
      '.btn-download',
      '#download-btn',
      '[onclick*="download"]',
      '[onclick*="verify"]',
    ];

    let clicked = false;
    for (const sel of buttonSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          // Download event ka wait karo
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
            btn.click(),
          ]);

          if (download) {
            finalDownloadUrl = download.url();
          }
          clicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    // Click ke baad URL change check karo
    await page.waitForTimeout(5000);

    if (!clicked) {
      // Koi button nahi mila — page content dump karo debug ke liye
      const content = await page.content();
      console.warn('[WARN] No click button found on fast-dl, content:', content.slice(0, 500));
    }

    // Final page URL check
    const currentUrl = page.url();
    if (
      currentUrl.match(/\.(mkv|mp4|avi)(\?|$)/i) ||
      currentUrl.includes('googlevideo') ||
      currentUrl.includes('storage.googleapis')
    ) {
      finalDownloadUrl = currentUrl;
    }

    // Page ke saare links scan karo — koi actual file link hai?
    const pageLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map((el) => ({
        text: el.textContent.trim(),
        href: el.href,
      }));
    });

    const directLink = pageLinks.find(
      (l) =>
        l.href.match(/\.(mkv|mp4|avi)(\?|$)/i) ||
        l.href.includes('googlevideo') ||
        l.href.includes('storage.googleapis') ||
        (l.href.includes('download') && l.href.startsWith('https'))
    );

    if (directLink && !finalDownloadUrl) {
      finalDownloadUrl = directLink.href;
    }

    return {
      directUrl: finalDownloadUrl,
      currentPage: currentUrl,
      pageLinks: pageLinks.slice(0, 20),
    };
  } finally {
    await page.close();
    await context.close();
  }
}

// ─── Step 3: vgmlinks fallback ────────────────────────────────────────────────
async function resolveVgmLinks(vgmUrl) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    acceptDownloads: true,
  });

  const page = await context.newPage();
  let finalUrl = null;

  page.on('request', (req) => {
    const url = req.url();
    if (
      url.match(/\.(mkv|mp4|avi)(\?|$)/i) ||
      url.includes('storage.googleapis') ||
      url.includes('googlevideo')
    ) {
      finalUrl = url;
    }
  });

  try {
    await page.goto(vgmUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Click any download button
    const btns = ['button', 'a.btn', '.download-btn', 'a[href*="download"]'];
    for (const sel of btns) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await page.waitForTimeout(3000);
          break;
        }
      } catch {}
    }

    // Get all links
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map((el) => ({
        text: el.textContent.trim(),
        href: el.href,
      }));
    });

    const dl = links.find(
      (l) =>
        l.href.match(/\.(mkv|mp4|avi)(\?|$)/i) ||
        l.href.includes('storage.googleapis') ||
        l.href.includes('gdrive')
    );

    return { directUrl: finalUrl || (dl ? dl.href : null), pageLinks: links };
  } finally {
    await page.close();
    await context.close();
  }
}

// ─── MAIN: Full chain — nexdrive → fast-dl / vgmlinks → actual URL ───────────
async function resolveDownloadChain(nexdriveUrl) {
  console.log(`[RESOLVER] Starting chain for: ${nexdriveUrl}`);

  // Step 1: nexdrive se fast-dl/vgm links lo
  const nexResult = await resolveNexdrive(nexdriveUrl);
  console.log('[RESOLVER] nexdrive result:', JSON.stringify(nexResult, null, 2));

  let directUrl = null;

  // Step 2a: fast-dl try karo pehle
  if (nexResult.fastDl) {
    console.log('[RESOLVER] Trying fast-dl:', nexResult.fastDl);
    try {
      const fdResult = await resolveFastDl(nexResult.fastDl);
      console.log('[RESOLVER] fast-dl result:', fdResult);
      if (fdResult.directUrl) {
        directUrl = fdResult.directUrl;
      }
    } catch (e) {
      console.warn('[RESOLVER] fast-dl failed:', e.message);
    }
  }

  // Step 2b: vgmlinks fallback
  if (!directUrl && nexResult.vgmLinks) {
    console.log('[RESOLVER] Trying vgmlinks:', nexResult.vgmLinks);
    try {
      const vgmResult = await resolveVgmLinks(nexResult.vgmLinks);
      console.log('[RESOLVER] vgmlinks result:', vgmResult);
      if (vgmResult.directUrl) {
        directUrl = vgmResult.directUrl;
      }
    } catch (e) {
      console.warn('[RESOLVER] vgmlinks failed:', e.message);
    }
  }

  return {
    nexdriveUrl,
    fastDlUrl: nexResult.fastDl,
    vgmLinksUrl: nexResult.vgmLinks,
    gdriveUrl: nexResult.gdrive,
    directUrl, // ← YEH hai final .mkv/.mp4 URL
    resolved: !!directUrl,
  };
}

// Browser cleanup
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

process.on('exit', closeBrowser);
process.on('SIGINT', closeBrowser);
process.on('SIGTERM', closeBrowser);

module.exports = { resolveDownloadChain, closeBrowser };
