// src/index.js
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env));
});

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 主頁面
  if (path === '/' || path === '/index.html') {
    return new Response(getHTML(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }

  // YouTube 搜尋 API
  if (path === '/api/search') {
    return handleYouTubeSearch(url);
  }

  // Spotify 元資料 API
  if (path === '/api/spotify') {
    return handleSpotify(url, env);
  }

  return new Response('Not Found', { status: 404 });
}

// ─── HTML 前端 ────────────────────────────────────────────────
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
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen p-6 font-sans">
  <div class="max-w-5xl mx-auto">
    <h1 class="text-4xl font-bold mb-2">Spotify → YouTube 播放器</h1>
    <p class="text-gray-400 mb-8">貼上 Spotify 單曲連結 → 自動搜尋 YouTube 播放</p>

    <div class="flex flex-col sm:flex-row gap-3 mb-8">
      <input id="spotifyUrl" type="text" placeholder="https://open.spotify.com/track/..." 
             class="flex-1 p-4 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-600">
      <button onclick="loadTrack()" 
              class="bg-green-600 hover:bg-green-700 px-8 py-4 rounded-lg font-medium transition">
        載入並播放
      </button>
    </div>

    <div id="track-info" class="mb-8 hidden">
      <div class="flex items-center gap-6 bg-gray-800 p-6 rounded-xl">
        <img id="albumArt" class="w-32 h-32 object-cover rounded-lg" alt="專輯封面">
        <div>
          <h2 id="trackName" class="text-2xl font-bold"></h2>
          <p id="artists" class="text-lg text-gray-300"></p>
          <p id="albumName" class="text-gray-400"></p>
        </div>
      </div>
    </div>

    <div id="player" class="aspect-video w-full rounded-xl overflow-hidden bg-black mb-8"></div>

    <div id="status" class="text-center text-gray-400"></div>
  </div>

  <script>
    async function loadTrack() {
      const input = document.getElementById('spotifyUrl').value.trim();
      if (!input) return alert('請輸入 Spotify 連結');

      const status = document.getElementById('status');
      status.textContent = '載入中...';

      try {
        const trackIdMatch = input.match(/track\\/([a-zA-Z0-9]{22})/);
        if (!trackIdMatch) throw new Error('無法解析 Spotify track ID');

        const id = trackIdMatch[1];
        const res = await fetch(\`/api/spotify?type=track&id=\${id}\`);
        if (!res.ok) throw new Error(await res.text());

        const track = await res.json();

        // 顯示資訊
        document.getElementById('trackName').textContent = track.name;
        document.getElementById('artists').textContent = track.artists;
        document.getElementById('albumName').textContent = track.album;
        if (track.albumArt) {
          document.getElementById('albumArt').src = track.albumArt;
        }
        document.getElementById('track-info').classList.remove('hidden');

        // 搜尋 YouTube 並播放
        const q = encodeURIComponent(\`\${track.name} \${track.artists} audio\`);
        const searchRes = await fetch(\`/api/search?q=\${q}\`);
        const results = await searchRes.json();

        if (results.length === 0) throw new Error('找不到對應的 YouTube 影片');

        const videoId = results[0].url.split('v=')[1] || results[0].url;
        playYouTube(videoId);

        status.textContent = '正在播放：' + track.name;
      } catch (err) {
        status.textContent = '錯誤：' + err.message;
        console.error(err);
      }
    }

    function playYouTube(videoId) {
      const player = document.getElementById('player');
      player.innerHTML = \`
        <iframe width="100%" height="100%" 
                src="https://www.youtube-nocookie.com/embed/\${videoId}?autoplay=1&rel=0&modestbranding=1" 
                frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen></iframe>
      \`;
    }
  </script>
</body>
</html>`;
}

// ─── YouTube 搜尋 (使用公開 Piped instance) ────────────────────
async function handleYouTubeSearch(url) {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: '缺少搜尋關鍵字' }, 400);

  try {
    // 你可以換成其他 Piped / Invidious 公開實例
    const pipedUrl = `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=music_songs`;
    const res = await fetch(pipedUrl);
    if (!res.ok) throw new Error('Piped API 請求失敗');

    const data = await res.json();
    const results = data.slice(0, 3).map(item => ({
      title: item.title,
      uploader: item.uploaderName,
      url: item.url,              // 通常是 /watch?v=xxxx
      duration: item.duration
    }));

    return json(results.length > 0 ? results : []);
  } catch (e) {
    return json({ error: 'YouTube 搜尋失敗：' + e.message }, 503);
  }
}

// ─── Spotify 單曲查詢 ────────────────────────────────────────────
async function handleSpotify(url, env) {
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');

  if (type !== 'track' || !id) {
    return json({ error: '需要 ?type=track&id=xxxx' }, 400);
  }

  try {
    const token = await getSpotifyToken(env);

    const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      if (res.status === 429) return json({ error: 'Spotify rate limit' }, 429);
      return json({ error: 'Spotify API 錯誤' }, res.status);
    }

    const track = await res.json();

    return json({
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images?.[0]?.url || null,
      duration_ms: track.duration_ms,
      preview_url: track.preview_url,
      spotify_url: track.external_urls?.spotify
    });
  } catch (err) {
    return json({ error: err.message || '伺服器錯誤' }, 500);
  }
}

async function getSpotifyToken(env) {
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('缺少 SPOTIFY_CLIENT_ID 或 SPOTIFY_CLIENT_SECRET，請用 wrangler secret 設定');
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

  if (!res.ok) throw new Error('無法取得 Spotify token');

  const data = await res.json();
  return data.access_token;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
}
