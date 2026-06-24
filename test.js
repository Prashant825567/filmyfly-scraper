// Run: node test.js
// Tests all API endpoints locally

const BASE = 'http://localhost:3000';
const axios = require('axios');

async function test(name, url) {
  try {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🧪 TEST: ${name}`);
    console.log(`   URL: ${url}`);
    const r = await axios.get(url, { timeout: 20000 });
    const d = r.data;
    if (d.success === false) {
      console.log(`   ❌ FAILED: ${d.error}`);
      return null;
    }
    console.log(`   ✅ SUCCESS`);
    return d;
  } catch(e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    return null;
  }
}

async function run() {
  console.log('🎬 FilmyFly API Tester');
  console.log('Make sure server is running: node index.js');

  // Test 1: Posts
  const posts = await test('Home Posts', `${BASE}/api/posts`);
  if (posts) {
    console.log(`   Posts found: ${posts.count}`);
    if (posts.posts[0]) {
      console.log(`   First: "${posts.posts[0].title}"`);
      console.log(`   Link: ${posts.posts[0].link}`);
      console.log(`   Image: ${posts.posts[0].image}`);
    }
  }

  // Test 2: Search
  const search = await test('Search "avengers"', `${BASE}/api/search?q=avengers`);
  if (search) {
    console.log(`   Results: ${search.count}`);
    search.posts?.slice(0,3).forEach((p,i) => console.log(`   [${i+1}] ${p.title}`));
  }

  // Test 3: Catalogs
  const cats = await test('Catalogs', `${BASE}/api/catalogs`);
  if (cats) console.log(`   Catalogs: ${cats.catalogs.length}`);

  // Test 4: Category
  const cat = await test('South Hindi Category', `${BASE}/api/category?id=21&name=South-Hindi-Dubbed-Movie`);
  if (cat) console.log(`   Movies: ${cat.count}`);

  // Test 5: Movie Detail
  const movieUrl = posts?.posts?.[0]?.link;
  if (!movieUrl) { console.log('\n⚠️  No movie URL to test detail'); return; }

  const detail = await test('Movie Detail', `${BASE}/api/detail?url=${encodeURIComponent(movieUrl)}`);
  if (detail?.detail) {
    const d = detail.detail;
    console.log(`   Title: ${d.title}`);
    console.log(`   Genre: ${d.genre}`);
    console.log(`   Language: ${d.language}`);
    console.log(`   Size: ${d.size}`);
    console.log(`   LinkmakeURL: ${d.linkmake_url}`);
  }

  // Test 6: Full (all-in-one)
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🧪 TEST: Full Chain (detail + links + streams)`);
  console.log(`   This might take 10-20 seconds...`);
  const full = await test('Full Chain', `${BASE}/api/full?url=${encodeURIComponent(movieUrl)}`);
  if (full) {
    console.log(`   Quality groups: ${full.quality_groups?.length}`);
    console.log(`   Total servers: ${full.total_servers}`);
    full.quality_groups?.forEach((g, i) => {
      console.log(`\n   [Group ${i+1}] ${g.quality_label || g.filename}`);
      console.log(`   Size: ${g.size}`);
      g.links?.forEach(l => {
        console.log(`     → [${l.server}] ${l.label}`);
        console.log(`       ${l.url?.substring(0, 70)}...`);
      });
    });
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('✅ All tests done!');
}

run().catch(console.error);
