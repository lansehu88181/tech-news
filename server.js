// 科技新闻聚合站（无 npm 依赖，只用 Node 内置模块，Node 24 自带 fetch）
// 来源：IT之家、爱范儿、雷峰网、极客公园、少数派的公开 RSS
// 缓存：内存 + data/cache.json（去重、按时间倒序，最多 300 篇）
// 刷新：启动拉一次，之后每 30 分钟拉一次；文章超过 3 小时未更新时，下次请求触发后台刷新。

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const MAX_ARTICLES = 300;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
const STALE_MS = 3 * 60 * 60 * 1000; // 3 小时
const CACHE_FILE = path.join(__dirname, 'data', 'cache.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const FEEDS = [
  { source: 'IT之家', url: 'https://www.ithome.com/rss/' },
  { source: '爱范儿', url: 'https://www.ifanr.com/feed' },
  { source: '雷峰网', url: 'https://www.leiphone.com/feed' },
  { source: '极客公园', url: 'https://www.geekpark.net/rss' },
  { source: '少数派', url: 'https://sspai.com/feed' },
];

// ---------- 分类：按标题 + 摘要关键词 ----------
const CATEGORY_RULES = [
  { name: 'AI', keywords: ['人工智能', 'AI', 'ChatGPT', 'GPT', '大模型', 'LLM', 'DeepSeek', '通义', '豆包', 'Kimi', 'Gemini', 'Claude', 'OpenAI', 'Anthropic', '算力', '英伟达', 'NVIDIA', '大语言模型', '智能体', 'Agent'] },
  { name: '汽车', keywords: ['汽车', '新能源车', '电车', '特斯拉', '比亚迪', '蔚来', '理想汽车', '小鹏', '问界', '智驾', '自动驾驶', '车企', '小米汽车', 'SU7', '智界'] },
  { name: '手机数码', keywords: ['手机', 'iPhone', '华为', '小米', '苹果', '安卓', 'Android', 'iOS', '电脑', '平板', '耳机', '手表', '数码', '折叠屏', '芯片', '骁龙', '天玑', 'MacBook', '笔记本'] },
  { name: '互联网', keywords: ['互联网', '腾讯', '阿里', '百度', '京东', '美团', '字节', '电商', '直播', '游戏', '社交', '微信', '抖音', '快手', '拼多多', '网购', '外卖'] },
];

function categorize(title, summary) {
  const text = `${title} ${summary}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.name;
  }
  return '其他';
}

// ---------- 轻量 RSS 解析 ----------
function stripCdata(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(stripCdata(m[1])).trim() : '';
}

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstImage(xml) {
  let m = xml.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i)
    || xml.match(/<media:content[^>]*url=["']([^"']+\.(?:jpe?g|png|webp|gif))["']/i)
    || xml.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp|gif))["'][^>]*type=["']image/i);
  if (m) return m[1];
  const desc = tagText(xml, 'description') || tagText(xml, 'content:encoded');
  m = desc.match(/<img[^>]*src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function parseFeed(xml, source) {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  const out = [];
  for (const item of items) {
    const title = stripHtml(tagText(item, 'title'));
    const link = tagText(item, 'link');
    if (!title || !link) continue;
    const rawDesc = tagText(item, 'description') || tagText(item, 'content:encoded');
    const summary = stripHtml(decodeEntities(rawDesc)).slice(0, 200);
    const pubRaw = tagText(item, 'pubDate') || tagText(item, 'dc:date');
    const pubDate = pubRaw && !isNaN(Date.parse(pubRaw)) ? new Date(pubRaw).toISOString() : new Date().toISOString();
    out.push({
      title,
      link,
      source,
      pubDate,
      summary,
      image: firstImage(item),
      category: categorize(title, summary),
    });
  }
  return out;
}

// ---------- 缓存 ----------
let articles = [];
let lastUpdatedAt = null;
let refreshing = false;

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(data.articles)) {
        articles = data.articles;
        lastUpdatedAt = data.updatedAt || null;
        console.log(`[cache] 从磁盘加载 ${articles.length} 篇`);
      }
    }
  } catch (e) {
    console.error('[cache] 加载失败:', e.message);
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ updatedAt: lastUpdatedAt, articles }, null, 0));
  } catch (e) {
    console.error('[cache] 保存失败:', e.message);
  }
}

// ---------- 拉取 ----------
async function fetchOne(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml, feed.source);
    console.log(`[fetch] ${feed.source}: ${items.length} 篇`);
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    const results = await Promise.allSettled(FEEDS.map(fetchOne));
    let fresh = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') fresh = fresh.concat(r.value);
      else console.error(`[fetch] ${FEEDS[i].source} 失败:`, r.reason && r.reason.message);
    });
    if (fresh.length > 0) {
      const seen = new Set();
      const merged = [...fresh, ...articles].filter((a) => {
        if (seen.has(a.link)) return false;
        seen.add(a.link);
        return true;
      });
      merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      articles = merged.slice(0, MAX_ARTICLES);
      lastUpdatedAt = new Date().toISOString();
      saveCache();
      console.log(`[refresh] 完成，共 ${articles.length} 篇，上次更新 ${lastUpdatedAt}`);
    } else {
      console.log('[refresh] 本次没有拉到新文章，保留旧缓存');
    }
  } finally {
    refreshing = false;
  }
}

function maybeStaleRefresh() {
  if (!lastUpdatedAt) return;
  if (Date.now() - new Date(lastUpdatedAt).getTime() > STALE_MS) {
    console.log('[refresh] 文章超过 3 小时未更新，后台刷新');
    refreshAll().catch((e) => console.error(e));
  }
}

// ---------- HTTP 服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function filterArticles(url) {
  const category = url.searchParams.get('category') || '';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  let list = articles;
  if (category && category !== '全部') list = list.filter((a) => a.category === category);
  if (q) {
    list = list.filter((a) =>
      a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q));
  }
  return list;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/health') {
    return sendJson(res, { status: 'ok', updatedAt: lastUpdatedAt, count: articles.length });
  }

  if (pathname === '/api/news') {
    maybeStaleRefresh();
    const list = filterArticles(url);
    return sendJson(res, { updatedAt: lastUpdatedAt, count: list.length, articles: list });
  }

  if (pathname === '/api/refresh' && req.method === 'POST') {
    refreshAll().catch((e) => console.error(e));
    return sendJson(res, { status: 'refreshing' });
  }

  // 静态文件：只提供首页 index.html，其他路径一律 404（不暴露源码与缓存）
  if (pathname !== '/' && pathname !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- 启动 ----------
loadCache();
server.listen(PORT, HOST, () => {
  console.log(`[server] 监听 http://${HOST}:${PORT}`);
  refreshAll().catch((e) => console.error(e));
});
setInterval(() => refreshAll().catch((e) => console.error(e)), REFRESH_INTERVAL_MS);
