// src/index.js

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 主頁面
  if (path === '/' || path === '/index.html') {
    return new Response(getHTML(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }

  // YouTube 搜尋代理
  if (path === '/api/search') {
    return handleYouTubeSearch(url);
  }

  // Spotify 元資料
  if (path === '/api/spotify') {
    return handleSpotify(url, env);
  }

  return new Response('Not Found', { status: 404 });
}

// ──────────────────────────────────────────────────────────────
//  前端 HTML + Tailwind + JavaScript 控制
// ──────────────────────────────────────────────────────────────
function getHTML() {
  return `<!DOCTYPE html>
<html lang="zh-TW" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Spotify → YouTube Player</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { darkMode: 'class' }</script>
  <style>
    .dark { color-scheme: dark; }
    iframe { border-radius: 12px; overflow: hidden; }
  </style>
</head>
<body class="bg-gradient-to-br from-gray-950 via-black to-gray-950 text-gray-100 min-h-screen p-6 md:p-10 font-sans">
  <div class="max-w-5xl mx-auto">
    <header class="text-center mb-10">
      <h1 class="text-4xl md:text-5xl font-extrabold mb-3 tracking-tight text-green-400">Spotify → YouTube 播放器</h1>
      <p class="text-lg text-gray-400">輸入 Spotify 單曲連結 → 自動搜尋並播放</p>
    </header>

    <div class="flex flex-col sm:flex-row gap-4 mb-10 max-w-2xl mx-auto">
      <input 
        id="spotifyUrl" 
        type="text" 
        placeholder="https://open.spotify.com/track/11dFghVXANMlKmJXsNCidbNl" 
        class="flex-1 p-4 bg-gray-900 border border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent transition"
      />
      <button 
        onclick="loadTrack()" 
        class="bg-green-600 hover:bg-green-700 px-8 py-4 rounded-xl font-semibold transition shadow-lg whitespace-nowrap"
      >
        載入並播放
      </button>
    </div>

    <div id="track-info" class="hidden mb-10 bg-gray-900/60 backdrop-blur-md p-6 rounded-2xl border border-gray-800 max-w-3xl mx-auto">
      <div class="flex flex-col sm:flex-row items-center gap-6">
        <img id="albumArt" class="w-40 h-40 sm:w-48 sm:h-48 object-cover rounded-xl shadow-2xl" alt="專輯封面">
        <div class="text-center sm:text-left">
          <h2 id="trackName" class="text-3xl font-bold mb-2"></h2>
          <p id="artists" class="text-xl text-green-400 mb-1"></p>
          <p id="albumName" class="text-gray-400"></p>
        </div>
      </div>
    </div>

    <div id="player" class="w-full max-w-4xl mx-auto aspect-video rounded-2xl overflow-hidden shadow-2xl mb-8 bg-black"></div>

    <div id="status" class="text-center text-lg font-medium text-gray-300 min-h-[1.5rem]"></div>
  </div>

  <script>
    async function loadTrack() {
      const input = document.getElementById('spotifyUrl').value.trim();
      if (!input) return showStatus('請輸入 Spotify 單曲連結', 'text-red-400');

      showStatus('載入中...', 'text-yellow-400');

      try {
        const match = input.match(/track[/:]([a-zA-Z0-9]{22})/);
        if (!match) throw new Error('無法解析 Spotify track ID');

        const id = match[1];
        const res = await fetch(\`/api/spotify?type=track&id=\${id}\`);
        if (!res.ok) throw new Error(await res.text() || \`HTTP \${res.status}\`);

        const track = await res.json();

        // 顯示歌曲資訊
        document.getElementById('trackName').textContent = track.name;
        document.getElementById('artists').textContent = track.artists;
        document.getElementById('albumName').textContent = track.album;
        if (track.albumArt) document.getElementById('albumArt').src = track.albumArt;
        document.getElementById('track-info').classList.remove('hidden');

        // 搜尋 YouTube
        const query = \`\${track.name} \${track.artists} official audio\`;
        const searchRes = await fetch(\`/api/search?q=\${encodeURIComponent(query)}\`);
        const results = await searchRes.json();

        if (results.length === 0) throw new Error('找不到對應的 YouTube 影片');

        let videoId = results[0].url;
        if (videoId.includes('v=')) {
          videoId = videoId.split('v=')[1].split('&')[0];
        }

        playYouTube(videoId);
        showStatus(\`正在播放：\${track.name} – \${track.artists}\`, 'text-green-400');

      } catch (err) {
        showStatus('錯誤：' + (err.message || '未知錯誤'), 'text-red-400');
        console.error(err);
      }
    }

    function playYouTube(videoId) {
      document.getElementById('player').innerHTML = \`
        <iframe 
          width="100%" height="100%" 
          src="https://www.youtube-nocookie.com/embed/\${videoId}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3" 
          title="YouTube player" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>
      \`;
    }

    function showStatus(msg, colorClass = 'text-gray-400') {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = \`text-center text-lg font-medium \${colorClass} min-h-[1.5rem]\`;
    }
  </script>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────
//  YouTube 搜尋 (使用公開 Piped API)
// ──────────────────────────────────────────────────────────────
async function handleYouTubeSearch(url) {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: '缺少 ?q= 參數' }, 400);

  try {
    const apiUrl = `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=music_songs`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Cloudflare-Worker/spotify-player' }
    });

    if (!res.ok) throw new Error(`Piped 回應 ${res.status}`);

    const data = await res.json();
    const cleaned = data
      .slice(0, 3)
      .filter(item => item.url && item.url.includes('watch'))
      .map(item => ({
        title: item.title || '未知',
        uploader: item.uploaderName || '未知',
        url: item.url,
        duration: item.duration || '-:-'
      }));

    return json(cleaned);
  } catch (e) {
    return json({ error: 'YouTube 搜尋失敗：' + e.message }, 503);
  }
}

// ──────────────────────────────────────────────────────────────
//  Spotify 單曲元資料查詢
// ──────────────────────────────────────────────────────────────
async function handleSpotify(url, env) {
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');

  if (type !== 'track' || !id) {
    return json({ error: '需要 ?type=track&id=xxxxxxxxxxxxxxxxxxxxxx' }, 400);
  }

  try {
    const token = await getSpotifyToken(env);

    const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      if (res.status === 429) return json({ error: 'Spotify rate limit，請稍後再試' }, 429);
      const errText = await res.text();
      return json({ error: `Spotify API 錯誤: ${errText}` }, res.status);
    }

    const track = await res.json();

    return json({
      id: track.id,
      name: track.name,
      artists: track.artists?.map(a => a.name).join(', ') || '未知歌手',
      album: track.album?.name || '未知專輯',
      albumArt: track.album?.images?.[0]?.url || null,
      duration_ms: track.duration_ms,
      preview_url: track.preview_url,
      spotify_url: track.external_urls?.spotify
    });
  } catch (err) {
    return json({ error: '後端錯誤：' + err.message }, 500);
  }
}

async function getSpotifyToken(env) {
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('缺少 SPOTIFY_CLIENT_ID 或 SPOTIFY_CLIENT_SECRET，請用 wrangler secret put 設定');
  }

  const auth = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) {
    throw new Error(`Spotify token 請求失敗：${res.status}`);
  }

  const data = await res.json();
  return data.access_token;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
}
