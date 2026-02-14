// ========================================
// INDY MUSIC PLAYER - DEBUGGED & ENHANCED
// ========================================

// ────────────────────────────────────────
// CONFIGURATION & CONSTANTS
// ────────────────────────────────────────
const GROQ_API_KEY = "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";
const YOUTUBE_API_KEY = "AIzaSyDNd7dwB1rZEpJzpyRrVZQwSKHvnt3Q7vQ";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const UPDATE_KEY = "tunes_datasaving_update_v1";

// ────────────────────────────────────────
// STATE MANAGEMENT
// ────────────────────────────────────────
let recent = [];
let playlists = {};
let liked = [];
let currentPlaylist = null;
let currentSongs = [];
let currentIndex = -1;
let ytPlayer = null;
let searchTimeout = null;
let lastPlayedVideoId = null;
let playerReady = false;
let pendingVideo = null;
let currentPlayingSong = null;
let isFullscreenLyrics = false;

// NEW: Enhanced state for v2.0 features
let queue = [];
let queueIndex = 0;
let savedAlbums = {};
let listeningStats = {};
let shuffleMode = false;
let repeatMode = 'off'; // 'off', 'all', 'one'
let currentFilter = 'all';
let contextMenuTarget = null;

const titleCleanCache = new Map();

// ────────────────────────────────────────
// UTILITY FUNCTIONS
// ────────────────────────────────────────

function getNextKey() {
    return YOUTUBE_API_KEY;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function save(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error("Storage error:", e);
    }
}

function load(key, def) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : def;
    } catch (e) {
        return def;
    }
}

function showNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; top: 24px; right: 24px;
        background: rgba(0,0,0,.95); backdrop-filter: blur(10px);
        color: white; padding: 16px 24px; border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,.5); z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 2000);
}

// ────────────────────────────────────────
// CACHING & API HELPERS
// ────────────────────────────────────────


// Add these missing functions
function getCachedMetadata(videoId) {
    const cached = load(`metadata_${videoId}`, null);
    return cached;
}

function saveMetadataToCache(videoId, title, artist) {
    save(`metadata_${videoId}`, { title, artist, timestamp: Date.now() });
}

function applyMetadata(videoId, song, title, artist) {
    if (song) {
        song.title = title;
        song.artist = artist;
    }
    // Update UI if this song is currently displayed
    updateSongTitlesInUI(videoId, title, artist);
}

function updateSongTitlesInUI(videoId, title, artist) {
    // Find all elements displaying this song and update them
    document.querySelectorAll(`[data-song-id="${videoId}"] .song-title`).forEach(el => {
        el.textContent = title;
        el.classList.remove('loading');
    });
}

function cachedFetch(url, cacheKey, maxAge = CACHE_TTL) {
    const cached = load(cacheKey, null);
    if (cached && Date.now() - cached.timestamp < maxAge) {
        console.log(`Cache hit: ${cacheKey}`);
        return Promise.resolve(cached.data);
    }

    return fetch(url)
        .then(r => {
            if (!r.ok) throw new Error(r.status);
            return r.json();
        })
        .then(data => {
            save(cacheKey, { timestamp: Date.now(), data });
            return data;
        })
        .catch(err => {
            console.warn("Fetch failed, using stale cache if available", err);
            return cached ? cached.data : null;
        });
}

function shortenSongTitle(youtubeTitle) {
    // First, remove parentheses, brackets, and their contents (non-greedy)
    let cleaned = youtubeTitle
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s*\[[^\]]*\]/g, '')
        .trim();

    // Remove common suffixes (case insensitive, more comprehensive list)
    cleaned = cleaned
        .replace(/\s*(official|audio|video|lyric|lyrics|music\s*video|mv|full|hd|4k|remastered|remaster|explicit|clean|version|album|single|\d{4}).*$/gi, '')
        .trim();

    // Handle potential artist-title separators: assume artist first, title after
    // Supported separators: " - ", " – ", " — ", "-", "|"
    const separatorRegex = / (?:-|–|—) | -| –| —|-|\|/;
    const parts = cleaned.split(separatorRegex);

    if (parts.length >= 2) {
        // Take everything after the first separator as the title (handles titles with internal separators)
        let title = parts.slice(1).join(' - ').trim();
        
        // If the title seems too short or empty, fallback to first part (rare case)
        if (title.length < 3) {
            title = parts[0].trim();
        }
        
        // Shorten to max 8 words if too long
        const words = title.split(/\s+/);
        if (words.length > 8) {
            title = words.slice(0, 8).join(' ');
        }
        
        return title;
    }

    // If no separator found, use the cleaned version and shorten if needed
    const words = cleaned.split(/\s+/);
    if (words.length > 8) {
        cleaned = words.slice(0, 8).join(' ');
    }

    // Final checks: min length, no URLs
    if (cleaned.length < 3 || cleaned.includes("http")) {
        return youtubeTitle.split(/[-(|[]/)[0].trim(); // Ultimate fallback to original simple split
    }

    return cleaned;
}

async function getCleanSongTitle(videoId, rawTitle) {
    if (!rawTitle) return "Unknown Title";
    
    if (titleCleanCache.has(videoId)) {
        return titleCleanCache.get(videoId);
    }

    const cleaned = shortenSongTitle(rawTitle);
    if (cleaned && cleaned.length >= 3 && cleaned.length < 60 && !cleaned.includes("http")) {
        titleCleanCache.set(videoId, cleaned);
        return cleaned;
    }

    // If primary cleaning doesn't meet criteria, use a simple fallback
    const fallback = rawTitle
        .replace(/\s*(official|audio|video|lyric|lyrics|music video|mv|full|hd|4k|remastered|\d{4}).*$/gi, '')
        .replace(/\s*[\(\[].*[\)\]]/g, '')
        .trim();

    titleCleanCache.set(videoId, fallback);
    return fallback;
}
// ────────────────────────────────────────
// YOUTUBE URL EXTRACTION
// ────────────────────────────────────────

function extractYouTubeVideoId(input) {
    if (!input) return null;
    input = input.trim();

    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

    const patterns = [
        /(?:youtube(?:-nocookie)?\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=))([a-zA-Z0-9_-]{11})/i,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/i,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
        /(?:v|embed)\/([a-zA-Z0-9_-]{11})/i,
        /[?&]v=([a-zA-Z0-9_-]{11})/i
    ];

    for (const regex of patterns) {
        const match = input.match(regex);
        if (match && match[1]) return match[1];
    }

    return null;
}


async function fetchVideoDetails(videoId, song) {
    if (!videoId) return;

    // 1. Try cache first → instant!
    const cached = getCachedMetadata(videoId);
    if (cached) {
        console.log(`Cache hit for ${videoId}: "${cached.title}"`);
        applyMetadata(videoId, song, cached.title, cached.artist);
        return;
    }

    // 2. Fetch from API
    try {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${getNextKey()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API ${res.status}`);

        const data = await res.json();
        const item = data.items?.[0];

        if (item?.snippet) {
            const realTitle = item.snippet.title;
            const realArtist = item.snippet.channelTitle;

            // Save to persistent cache
            saveMetadataToCache(videoId, realTitle, realArtist);

            // Apply to UI and song object
            applyMetadata(videoId, song, realTitle, realArtist);
        }
    } catch (err) {
        console.warn("Metadata fetch failed:", err);
        // Fallback: use regex guess from original title if available
        if (song?.title && song.title !== "[couldn't fetch title]") {
            const guessed = shortenSongTitle(song.title);
            applyMetadata(videoId, song, guessed, "YouTube");
        }
    }
}

// ────────────────────────────────────────
// INITIALIZATION
// ────────────────────────────────────────

function showHome() {
    const mainContent = document.getElementById('mainContent');
    const searchView = document.getElementById('searchView');
    const homeBtn = document.getElementById('homeBtn');
    const searchBtn = document.getElementById('searchBtn');
    
    if (!mainContent) return;

    // Show home view, hide search view
    const homeView = document.getElementById('homeView');
    if (homeView) {
        homeView.style.display = 'block';
    }
    
    if (searchView) {
        searchView.classList.remove('active');
        searchView.style.display = 'none';
    }
    
    if (homeBtn) homeBtn.classList.add('active');
    if (searchBtn) searchBtn.classList.remove('active');
    
    // Render all content
    renderRecent();
    renderAlbums();
    renderMixes();
    renderPopular();
    renderArtists();
    renderLibrary();
    
    // Update filter counts
    updateFilterCounts();
    
    // Setup filter buttons
    setupFilterButtons();
    
    // Setup search input
    setTimeout(setupSearchInput, 100);
    window.location.reload();
}

function initializeApp() {
    // Load saved data
    recent = load("recent", []);
    playlists = load("playlists", {});
    liked = load("liked", []);
    queue = load('queue', []);
    savedAlbums = load('indy_saved_albums', {});
    listeningStats = load('listening_stats', {
        songsPlayed: 0,
        totalMinutes: 0,
        lastUpdated: Date.now()
    });

    // Initialize Liked Songs playlist
    if (!playlists["Liked Songs"]) {
        playlists["Liked Songs"] = {
            emoji: "❤️",
            songs: [],
            isSpecial: true,
            locked: true
        };
        save("playlists", playlists);
    }

    // Render initial content
    renderRecent();
    renderPlaylists();
    renderAlbums();
    renderMixes();
    renderPopular();
    renderArtists();
    renderLibrary();
    updateLikedCount();
    updateFilterCounts();
    updateStats();

    // Setup YouTube API
    loadYouTubeAPI();

    // Setup animations CSS
    injectAnimationStyles();

    // Auto-minimize right sidebar initially
    const rightSidebar = document.getElementById('rightSidebar');
    if (rightSidebar) {
        rightSidebar.classList.add('minimized');
    }

    // Show update popup if needed
    showUpdatePopupIfNeeded();

    // Setup fullscreen lyrics
    setupFullscreenLyrics();
    
    // Setup filter buttons
    setupFilterButtons();
    
    console.log('🎵 INDY Music initialized successfully');
}

function toggleQueue() {
    const panel = document.getElementById('queuePanel');
    if (panel) {
        panel.classList.toggle('open');
        renderQueue();
    }
}

function showUpdatePopupIfNeeded() {
    if (localStorage.getItem(UPDATE_KEY) === "true") return;

    const modal = document.createElement("div");
    modal.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px);
        z-index:9999; display:flex; align-items:center; justify-content:center; opacity:0;
        transition:opacity 0.4s ease;
    `;

    const content = document.createElement("div");
    content.style.cssText = `
        background:rgba(30,30,40,0.95); border:1px solid rgba(255,255,255,0.12);
        border-radius:16px; max-width:420px; width:90%; padding:28px 24px; text-align:center;
        box-shadow:0 20px 60px rgba(0,0,0,0.7); transform:scale(0.92);
        transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);
    `;

    content.innerHTML = `
        <div style="font-size:48px; margin-bottom:12px;">✦</div>
        <h2 style="font-family:'Syne',sans-serif; font-weight:800; font-size:26px; margin-bottom:16px; letter-spacing:-1px;">
            Data-Saving Update
        </h2>
        <p style="font-size:15px; color:#ddd; line-height:1.6; margin-bottom:20px;">
            INDY MUSIC now lasts way longer each day — less quota burn, more music.
        </p>
        <ul style="text-align:left; max-width:360px; margin:0 auto 24px; padding-left:20px; font-size:14px; color:#ccc; line-height:1.7; list-style-type:'→ ';">
            <li>Cached album/mix recommendations (0 quota after first load)</li>
            <li>Smarter search (min 3 chars + longer debounce)</li>
            <li>Paste YouTube URLs → instant play (0 quota to start)</li>
            <li>Pasted video metadata fetch = only 1 unit</li>
            <li>Used all of the daily quota? Don't worry, it'll reset in a few hours!</li>
        </ul>
        <button id="acceptUpdateBtn" style="
            background:linear-gradient(135deg,#ffffff,#e0e0e0); color:#000; border:none;
            padding:12px 44px; font-size:16px; font-weight:700; border-radius:50px;
            cursor:pointer; box-shadow:0 6px 20px rgba(255,255,255,0.15);
            transition:all 0.3s ease;
        ">
            Cool!
        </button>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    setTimeout(() => {
        modal.style.opacity = "1";
        content.style.transform = "scale(1)";
    }, 50);

    const acceptBtn = document.getElementById("acceptUpdateBtn");
    if (acceptBtn) {
        acceptBtn.onclick = () => {
            localStorage.setItem(UPDATE_KEY, "true");
            modal.style.opacity = "0";
            content.style.transform = "scale(0.92)";
            setTimeout(() => modal.remove(), 400);
        };
    }

    modal.onclick = (e) => {
        if (e.target === modal) {
            localStorage.setItem(UPDATE_KEY, "true");
            modal.style.opacity = "0";
            content.style.transform = "scale(0.92)";
            setTimeout(() => modal.remove(), 400);
        }
    };
}

function setupFilterButtons() {
    // Get all filter chips
    const filterChips = document.querySelectorAll('.filter-chip');
    
    filterChips.forEach(chip => {
        // Remove any existing click handlers
        chip.onclick = null;
        
        // Add new click handler
        chip.onclick = function() {
            const filterType = this.getAttribute('data-filter');
            filterContent(filterType);
        };
    });
}

function injectAnimationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(400px); opacity: 0; }
        }
        .song-title.loading::after {
            content: '...';
            animation: blink 1.4s infinite;
        }
        @keyframes blink {
            0%, 100% { opacity: 0; }
            50% { opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

// ────────────────────────────────────────
// YOUTUBE PLAYER SETUP
// ────────────────────────────────────────

function loadYouTubeAPI() {
    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const first = document.getElementsByTagName('script')[0];
        if (first && first.parentNode) {
            first.parentNode.insertBefore(tag, first);
        }
    }
}

window.onYouTubeIframeAPIReady = function() {
    console.log('YouTube IFrame API fully ready');
    playerReady = true;
    
    ytPlayer = new YT.Player('player', {
        events: {
            'onReady': () => {
                console.log('Player ready');
                if (pendingVideo) {
                    ytPlayer.loadVideoById(pendingVideo);
                    pendingVideo = null;
                }
            },
            'onStateChange': onPlayerStateChange,
            'onError': (e) => {
                console.error('YT Player error:', e.data);
                showVideoError();
            }
        }
    });
};

function onPlayerStateChange(event) {
    if (event.data === window.YT.PlayerState.ENDED) {
        // Song ended, check repeat mode and queue
        if (repeatMode === 'one') {
            // Replay current song
            playSong(currentPlayingSong);
        } else {
            // Try to play next
            skipToNext();
        }
    }
}

// ────────────────────────────────────────
// LRCLIB LYRICS API - KEYLESS & FREE
// ────────────────────────────────────────

const LRCLIB_API_BASE = 'https://lrclib.net/api';

// Cache for lyrics to reduce API calls
const lyricsCache = {};

async function fetchLyrics(song) {
    if (!song || !song.title || !song.artist) return null;
    
    // Clean the title for better matching
    const cleanTitle = await getCleanSongTitle(song.id, song.title);
    
    // Create cache key
    const cacheKey = `${song.id}_${cleanTitle}`;
    
    // Check cache first
    if (lyricsCache[cacheKey]) {
        console.log(`Lyrics cache hit for: ${cleanTitle}`);
        return lyricsCache[cacheKey];
    }
    
    try {
        // Method 1: Try direct lookup first (more accurate)
        const directParams = new URLSearchParams({
            track_name: cleanTitle,
            artist_name: song.artist || '',
        });
        
        const directUrl = `${LRCLIB_API_BASE}/get?${directParams.toString()}`;
        console.log(`Trying direct lyrics lookup: ${directUrl}`);
        
        let response = await fetch(directUrl);
        
        // If direct lookup succeeds (200), we're done
        if (response.ok) {
            const lyricsData = await response.json();
            lyricsCache[cacheKey] = lyricsData;
            return lyricsData;
        }
        
        // If direct lookup returns 404, try search method
        if (response.status === 404) {
            console.log(`Direct lookup failed, trying search...`);
            
            const searchParams = new URLSearchParams({
                track_name: cleanTitle,
                artist_name: song.artist || ''
            });
            
            const searchUrl = `${LRCLIB_API_BASE}/search?${searchParams.toString()}`;
            const searchResponse = await fetch(searchUrl);
            
            // Check if response is OK and is JSON
            if (!searchResponse.ok) {
                console.log(`Search returned status: ${searchResponse.status}`);
                lyricsCache[cacheKey] = null;
                return null;
            }
            
            // Check content type to ensure it's JSON
            const contentType = searchResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.log(`Search returned non-JSON response: ${contentType}`);
                lyricsCache[cacheKey] = null;
                return null;
            }
            
            const results = await searchResponse.json();
            
            if (!results || results.length === 0) {
                lyricsCache[cacheKey] = null;
                return null;
            }
            
            // Get the best match (usually first result)
            const bestMatch = results[0];
            
            // Fetch full lyrics data
            const lyricsResponse = await fetch(`${LRCLIB_API_BASE}/get?id=${bestMatch.id}`);
            
            if (!lyricsResponse.ok) {
                lyricsCache[cacheKey] = null;
                return null;
            }
            
            const lyricsData = await lyricsResponse.json();
            lyricsCache[cacheKey] = lyricsData;
            return lyricsData;
        }
        
        lyricsCache[cacheKey] = null;
        return null;
        
    } catch (error) {
        console.error("Lyrics fetch error:", error);
        lyricsCache[cacheKey] = null;
        return null;
    }
}

// Format lyrics for display
function formatLyricsForDisplay(lyricsData) {
    if (!lyricsData) return "No lyrics found";
    
    // Prefer synced lyrics if available
    if (lyricsData.syncedLyrics) {
        return formatSyncedLyrics(lyricsData.syncedLyrics);
    } else if (lyricsData.plainLyrics) {
        return formatPlainLyrics(lyricsData.plainLyrics);
    } else if (lyricsData.instrumental) {
        return "♪ Instrumental ♪";
    }
    
    return "No lyrics available";
}

function formatPlainLyrics(text) {
    return text.split('\n').map(line => 
        `<p>${escapeHtml(line)}</p>`
    ).join('');
}

function formatSyncedLyrics(lrcText) {
    // Parse LRC format: [mm:ss.xx] Lyric text
    const lines = lrcText.split('\n');
    let html = '<div class="synced-lyrics">';
    
    lines.forEach(line => {
        const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2})\](.*)/);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const totalSeconds = minutes * 60 + seconds;
            const text = match[4].trim();
            
            if (text) {
                html += `<p data-time="${totalSeconds}" class="lyric-line">${escapeHtml(text)}</p>`;
            }
        } else if (line.trim()) {
            // Handle lines without timestamps
            html += `<p class="lyric-line">${escapeHtml(line.trim())}</p>`;
        }
    });
    
    html += '</div>';
    return html;
}

// Update lyrics in the UI
async function updateLyrics(song) {
    const lyricsContainer = document.getElementById('lyrics');
    if (!lyricsContainer) return;
    
    // Show loading state
    lyricsContainer.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';
    
    const lyricsData = await fetchLyrics(song);
    
    if (lyricsData) {
        const formatted = formatLyricsForDisplay(lyricsData);
        lyricsContainer.innerHTML = formatted;
        
        // Update fullscreen lyrics if open
        if (isFullscreenLyrics) {
            const fullscreenText = document.getElementById('fullscreenLyricsText');
            if (fullscreenText) fullscreenText.innerHTML = formatted;
        }
    } else {
        lyricsContainer.innerHTML = '<div class="lyrics-placeholder">No lyrics found</div>';
    }
}

// Highlight current line during playback (for synced lyrics)
function highlightLyricLine(currentTimeSeconds) {
    const lines = document.querySelectorAll('.lyric-line[data-time]');
    let activeLine = null;
    
    lines.forEach(line => {
        const time = parseFloat(line.dataset.time);
        if (time <= currentTimeSeconds) {
            activeLine = line;
        }
    });
    
    lines.forEach(line => line.classList.remove('active'));
    if (activeLine) {
        activeLine.classList.add('active');
        activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Set up lyrics sync interval
function setupLyricsSync() {
    if (window.lyricsInterval) clearInterval(window.lyricsInterval);
    
    window.lyricsInterval = setInterval(() => {
        if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function' && 
            document.querySelector('.synced-lyrics')) {
            const currentTime = ytPlayer.getCurrentTime();
            highlightLyricLine(currentTime);
        }
    }, 500);
}


// ────────────────────────────────────────
// PLAYBACK FUNCTIONS
// ────────────────────────────────────────

async function playSong(song, fromPlaylist = null) {
    if (!song || !song.id) {
        console.error("Invalid song object", song);
        return;
    }
    
    if (lastPlayedVideoId === song.id) {
        console.log("Already playing this exact video — skipping duplicate call");
        return;
    }
    
    lastPlayedVideoId = song.id;
    currentPlayingSong = { ...song };

    // Update playback context - IMPORTANT: Check if we're playing from queue
    if (fromPlaylist && fromPlaylist !== 'queue') {
        currentPlaylist = fromPlaylist;
        currentSongs = playlists[fromPlaylist]?.songs || [];
        currentIndex = currentSongs.findIndex(s => s.id === song.id);
        if (currentIndex === -1) currentIndex = 0;
    } else if (fromPlaylist === 'queue') {
        // Playing from queue, keep current queue state
        currentPlaylist = null;
        currentSongs = [...queue];
    } else {
        // Not from playlist, check if we're in queue mode
        const queueIdx = queue.findIndex(s => s.id === song.id);
        if (queueIdx !== -1) {
            // This song is in queue, set queue as current source
            queueIndex = queueIdx;
            currentSongs = [...queue];
            currentIndex = queueIdx;
            currentPlaylist = null;
        } else {
            // Just playing a single song
            const idx = currentSongs.findIndex(s => s.id === song.id);
            if (idx !== -1) currentIndex = idx;
        }
    }

    // Hide video error overlay if showing
    hideVideoError();
    
    // Increment play stats
    incrementSongPlay();

    // Clean title for display
    const cleanTitle = await getCleanSongTitle(song.id, song.title);

    const npTitle = document.getElementById('npTitle');
    const npArtist = document.getElementById('npArtist');
    
    if (npTitle) npTitle.textContent = cleanTitle || "Unknown Title";
    if (npArtist) npArtist.textContent = song.artist || "Unknown Artist";

    addToRecent(song);
    if (song.art) updateGradient(song.art);
    showToast({ ...song, title: cleanTitle });

    // Update mini player
    updateMiniPlayer({ ...song, title: cleanTitle });

    // Show add to playlist button
    const addBtn = document.getElementById('addToPlaylistBtn');
    if (addBtn) addBtn.style.display = 'flex';

    // Auto-open right sidebar
    const rightSidebar = document.getElementById('rightSidebar');
    if (rightSidebar && rightSidebar.classList.contains('minimized')) {
        rightSidebar.classList.remove('minimized');
    }

    // Update queue display
    renderQueue();

    // Load video
    const params = new URLSearchParams({
        autoplay: 1,
        enablejsapi: 1,
        origin: window.location.origin,
        rel: 0,
        modestbranding: 1,
        showinfo: 0,
        iv_load_policy: 3,
        playsinline: 1,
        fs: 1
    });

    if (window.ytPlayer && typeof window.ytPlayer.loadVideoById === 'function') {
        try {
            window.ytPlayer.loadVideoById({ videoId: song.id, startSeconds: 0 });
            console.log(`Playing "${cleanTitle}" via ytPlayer.loadVideoById`);
        } catch (err) {
            console.error("loadVideoById failed:", err);
            const embedUrl = `https://www.youtube.com/embed/${song.id}?${params.toString()}`;
            const playerIframe = document.getElementById('player');
            if (playerIframe) playerIframe.src = embedUrl;
        }
    } else {
        const embedUrl = `https://www.youtube.com/embed/${song.id}?${params.toString()}`;
        const playerIframe = document.getElementById('player');
        if (playerIframe) {
            playerIframe.src = embedUrl;
            console.log(`Playing "${cleanTitle}" via direct iframe src`);
        }
    }

    // Fetch lyrics for the new song
    setTimeout(() => {
        if (song && song.id) {
            updateLyrics(song);
            
            // Set up lyrics sync if we have the player
            if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                if (window.lyricsInterval) clearInterval(window.lyricsInterval);
                
                window.lyricsInterval = setInterval(() => {
                    if (ytPlayer && ytPlayer.getCurrentTime && document.querySelector('.synced-lyrics')) {
                        const currentTime = ytPlayer.getCurrentTime();
                        highlightLyricLine(currentTime);
                    }
                }, 500);
            }
        }
    }, 1000);
}

function skipToNext() {
    if (repeatMode === 'one' && currentPlayingSong) {
        // Replay current song
        playSong(currentPlayingSong);
        return;
    }
    
    // Check if we're playing from queue
    if (queue.length > 0 && currentPlayingSong && queue.some(s => s.id === currentPlayingSong.id)) {
        // We're in queue mode
        if (moveToNextInQueue()) {
            return;
        } else if (repeatMode === 'all' && queue.length > 0) {
            // Loop back to start of queue
            queueIndex = 0;
            playFromQueue(0);
            return;
        }
    }
    
    // Not in queue mode, handle playlist or single song
    if (shuffleMode && currentSongs.length > 1) {
        // Pick random song (not current)
        let newIndex;
        do {
            newIndex = Math.floor(Math.random() * currentSongs.length);
        } while (newIndex === currentIndex && currentSongs.length > 1);
        
        currentIndex = newIndex;
        playSong(currentSongs[currentIndex]);
        return;
    }
    
    if (currentIndex < currentSongs.length - 1) {
        currentIndex++;
        playSong(currentSongs[currentIndex]);
    } else if (repeatMode === 'all' && currentSongs.length > 0) {
        currentIndex = 0;
        playSong(currentSongs[currentIndex]);
    }
}

function skipToPrevious() {
    // Check if we're playing from queue
    if (queue.length > 0 && currentPlayingSong && queue.some(s => s.id === currentPlayingSong.id)) {
        moveToPreviousInQueue();
        return;
    }
    
    // Not in queue mode
    if (currentIndex > 0) {
        currentIndex--;
        playSong(currentSongs[currentIndex]);
    }
}

function showToast(song) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    const toastImg = document.getElementById('toastImg');
    const toastTitle = document.getElementById('toastTitle');
    
    if (toastImg) toastImg.src = song.art || '';
    if (toastTitle) toastTitle.textContent = song.title || 'Unknown';
    
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 5000);
}

// ────────────────────────────────────────
// NAVIGATION FUNCTIONS
// ────────────────────────────────────────

async function renderPopular() {
    const container = document.getElementById('popularScroll');
    if (!container) return;
    
    container.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading popular songs...</div>';
    
    // Use a mix of recent songs and some popular queries
    const popularQueries = [
        'pop hits 2024',
        'chill lofi beats',
        'hip hop 2024',
        'indie rock 2024',
        'electronic dance music',
        'r&b soul 2024'
    ];
    
    const randomQuery = popularQueries[Math.floor(Math.random() * popularQueries.length)];
    
    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=6&q=${encodeURIComponent(randomQuery)}&key=${getNextKey()}`
        );
        
        if (!response.ok) throw new Error('API error');
        
        const data = await response.json();
        
        container.innerHTML = '';
        
        if (data.items && data.items.length > 0) {
            data.items.forEach(item => {
                const song = {
                    id: item.id.videoId,
                    title: item.snippet.title,
                    artist: item.snippet.channelTitle,
                    art: item.snippet.thumbnails.medium.url
                };
                
                const div = document.createElement('div');
                div.className = 'album-card';
                div.innerHTML = `
                    <img src="${song.art}" alt="">
                    <div class="album-title loading">${escapeHtml(song.title)}</div>
                    <div class="album-artist">${escapeHtml(song.artist)}</div>
                `;
                div.onclick = () => playSong(song);
                container.appendChild(div);
                
                getCleanSongTitle(song.id, song.title).then(clean => {
                    const titleEl = div.querySelector('.album-title');
                    if (titleEl) {
                        titleEl.textContent = clean;
                        titleEl.classList.remove('loading');
                    }
                });
            });
        } else {
            container.innerHTML = '<div style="padding:20px;color:var(--muted);">No popular songs found</div>';
        }
    } catch (error) {
        console.error("Popular songs error:", error);
        container.innerHTML = '<div style="padding:20px;color:var(--muted);">Could not load popular songs</div>';
    }
}

async function renderArtists() {
    const container = document.getElementById('artistsScroll');
    if (!container) return;
    
    container.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading artists...</div>';
    
    // Get unique artists from recent plays
    const uniqueArtists = [...new Set(recent.map(s => s.artist).filter(Boolean))].slice(0, 4);
    
    // Add some popular artists if we don't have enough
    const popularArtists = ['Drake', 'Taylor Swift', 'The Weeknd', 'Beyoncé', 'Post Malone', 'Billie Eilish'];
    const allArtists = [...uniqueArtists, ...popularArtists.filter(a => !uniqueArtists.includes(a))].slice(0, 6);
    
    container.innerHTML = '';
    
    allArtists.forEach(artistName => {
        const div = document.createElement('div');
        div.className = 'album-card';
        
        // Generate a random color for artist placeholder
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        div.innerHTML = `
            <div style="width:100%;aspect-ratio:1;background:${randomColor};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:48px;margin-bottom:12px;">
                ${artistName.charAt(0).toUpperCase()}
            </div>
            <div class="album-title" style="text-align:center;">${escapeHtml(artistName)}</div>
            <div class="album-artist" style="text-align:center;color:var(--accent);">Artist</div>
        `;
        
        div.onclick = () => {
            // Search for this artist when clicked
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = artistName;
                showSearch();
                setTimeout(() => {
                    searchInput.focus();
                    searchInput.dispatchEvent(new Event('input'));
                }, 100);
            }
        };
        
        container.appendChild(div);
    });
}

function showSearch() {
    const homeView = document.getElementById('homeView');
    const searchView = document.getElementById('searchView');
    const homeBtn = document.getElementById('homeBtn');
    const searchBtn = document.getElementById('searchBtn');

    if (homeView) homeView.style.display = 'none';
    if (searchView) {
        searchView.classList.add('active');
        searchView.style.display = 'block';
    }
    if (homeBtn) homeBtn.classList.remove('active');
    if (searchBtn) searchBtn.classList.add('active');
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.focus();
        setTimeout(setupSearchInput, 100);
    }
}

function setupSearchInput() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput || searchInput.dataset.enhanced) return;

    searchInput.dataset.enhanced = 'true';

    searchInput.oninput = (e) => {
        clearTimeout(searchTimeout);
        const value = e.target.value.trim();

        if (!value) {
            const resultsContainer = document.getElementById('searchResults');
            if (resultsContainer) resultsContainer.innerHTML = '';
            return;
        }

        searchTimeout = setTimeout(async () => {
            const videoId = extractYouTubeVideoId(value);

            if (videoId) {
                e.target.value = '';
                const song = {
                    id: videoId,
                    title: "[Couldn't fetch title]",
                    artist: "N/A",
                    art: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
                };
                playSong(song);
                showNotification("Playing pasted YouTube video...");
                fetchVideoDetails(videoId, song);
            } else if (value.length >= 3) {
                try {
                    const [videos, playlists] = await Promise.all([
                        fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(value)}&key=${getNextKey()}`).then(r => r.json()),
                        fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=playlist&maxResults=4&q=${encodeURIComponent(value + ' album')}&key=${getNextKey()}`).then(r => r.json())
                    ]);
                    renderSearchResults(videos, playlists);
                } catch (error) {
                    console.error("Search error:", error);
                    showNotification("Search failed");
                }
            }
        }, 500);
    };

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(searchTimeout);
            const value = searchInput.value.trim();
            const videoId = extractYouTubeVideoId(value);

            if (videoId) {
                const song = {
                    id: videoId,
                    title: "Loading title...",
                    artist: "YouTube",
                    art: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
                };
                playSong(song);
                searchInput.value = '';
                showNotification("Playing pasted video!");
                fetchVideoDetails(videoId, song);
            }
        }
    });
}

// ────────────────────────────────────────
// RENDER FUNCTIONS
// ────────────────────────────────────────

function addToRecent(song) {
    if (!song || !song.id) return;
    
    recent = recent.filter(s => s.id !== song.id);
    recent.unshift(song);
    recent = recent.slice(0, 8);
    save("recent", recent);
    renderRecent();
}

function renderRecent() {
    const recentDiv = document.getElementById('recentGrid');
    if (!recentDiv) return;
    recentDiv.innerHTML = '';

    if (recent.length === 0) {
        recentDiv.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);grid-column:1/-1">No recent songs yet</div>';
        return;
    }

    recent.forEach(song => {
        const div = document.createElement('div');
        div.className = 'song-card';
        div.innerHTML = `
            <img src="${song.art || ''}" alt="">
            <div class="song-info">
                <div class="song-title loading">${escapeHtml(song.title)}</div>
                <div class="song-artist">${escapeHtml(song.artist)}</div>
            </div>
        `;
        div.onclick = () => playSong(song);
        
        // Add context menu
        div.addEventListener('contextmenu', (e) => {
            showContextMenu(e, song);
        });
        
        recentDiv.appendChild(div);

        getCleanSongTitle(song.id, song.title).then(clean => {
            const titleEl = div.querySelector('.song-title');
            if (titleEl) {
                titleEl.textContent = clean;
                titleEl.classList.remove('loading');
            }
        });
    });
}

async function renderAlbums() {
    const container = document.getElementById('albumsScroll');
    if (!container) return;
    
    container.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading albums...</div>';
    
    const uniqueArtists = [...new Set(recent.map(s => s.artist).filter(Boolean))].slice(0, 3);
    
    if (uniqueArtists.length === 0) {
        container.innerHTML = '<div style="padding:20px;color:var(--muted);">Play some songs to see album recommendations</div>';
        return;
    }
    
    try {
        const albumPromises = uniqueArtists.map(artist =>
            cachedFetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&type=playlist&maxResults=2&q=${encodeURIComponent(artist + ' album')}&key=${getNextKey()}`,
                `album-cache-${artist.replace(/\W/g,'_')}`
            )
        );
        
        const results = await Promise.all(albumPromises);
        const albums = results.flatMap(data => data?.items || []).slice(0, 6);
        
        container.innerHTML = '';
        
        if (albums.length === 0) {
            container.innerHTML = '<div style="padding:20px;color:var(--muted);">No albums found</div>';
            return;
        }
        
        albums.forEach(item => {
            const div = document.createElement('div');
            div.className = 'album-card';
            div.innerHTML = `
                <img src="${item.snippet.thumbnails.medium.url}" alt="">
                <div class="album-title">${escapeHtml(item.snippet.title)}</div>
                <div class="album-artist">${escapeHtml(item.snippet.channelTitle)}</div>
            `;
            div.onclick = () => playPlaylist(item.id.playlistId, true);
            container.appendChild(div);
        });
    } catch (error) {
        console.error("Album fetch error:", error);
        container.innerHTML = '<div style="padding:20px;color:var(--muted);">Could not load albums</div>';
    }
}

function renderMixes() {
    const container = document.getElementById('mixesScroll');
    if (!container) return;

    container.innerHTML = '';

    const seeds = recent.slice(0, 6);

    if (seeds.length === 0) {
        container.innerHTML = '<div style="padding:20px;color:var(--muted);">Play some music to get mixes</div>';
        return;
    }

    seeds.forEach(song => {
        const div = document.createElement('div');
        div.className = 'album-card';
        div.innerHTML = `
            <img src="${song.art || ''}" alt="">
            <div class="album-title loading">${escapeHtml(song.title)} Mix</div>
            <div class="album-artist">Based on ${escapeHtml(song.artist)}</div>
        `;
        div.onclick = () => openMix(song);
        container.appendChild(div);
        
        getCleanSongTitle(song.id, song.title).then(clean => {
            const titleEl = div.querySelector('.album-title');
            if (titleEl) {
                titleEl.textContent = `${clean} Mix`;
                titleEl.classList.remove('loading');
            }
        });
    });
}

function renderSearchResults(videos, playlists) {
    const container = document.getElementById('searchResults');
    if (!container) return;
    container.innerHTML = '';
    
    if (playlists.items && playlists.items.length > 0) {
        const albumSection = document.createElement('div');
        albumSection.className = 'section';
        albumSection.innerHTML = `
            <div class="section-header"><h2>Albums</h2></div>
            <div class="scroll-container"></div>
        `;
        
        const scrollContainer = albumSection.querySelector('.scroll-container');
        playlists.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'album-card';
            div.innerHTML = `
                <img src="${item.snippet.thumbnails.medium.url}" alt="">
                <div class="album-title">${escapeHtml(item.snippet.title)}</div>
                <div class="album-artist">${escapeHtml(item.snippet.channelTitle)}</div>
            `;
            div.onclick = () => playPlaylist(item.id.playlistId, true);
            if (scrollContainer) scrollContainer.appendChild(div);
        });
        
        container.appendChild(albumSection);
    }
    
    if (videos.items && videos.items.length > 0) {
        const songSection = document.createElement('div');
        songSection.className = 'section';
        songSection.innerHTML = `
            <div class="section-header"><h2>Songs</h2></div>
            <div class="recent-grid"></div>
        `;
        const grid = songSection.querySelector('.recent-grid');

        videos.items.forEach(item => {
            const song = {
                id: item.id.videoId,
                title: item.snippet.title,
                artist: item.snippet.channelTitle,
                art: item.snippet.thumbnails.medium.url
            };

            const div = document.createElement('div');
            div.className = 'song-card';
            div.setAttribute('data-song', JSON.stringify(song));
            div.innerHTML = `
                <img src="${song.art}" alt="">
                <div class="song-info">
                    <div class="song-title loading">${escapeHtml(song.title)}</div>
                    <div class="song-artist">${escapeHtml(song.artist)}</div>
                </div>
                <button onclick="event.stopPropagation(); showAddToPlaylistMenu(${JSON.stringify(song).replace(/"/g, '&quot;')})" style="background:var(--accent);color:#000;border:none;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;flex-shrink:0;">+</button>
                <button onclick="event.stopPropagation(); toggleLike(${JSON.stringify(song).replace(/"/g, '&quot;')})" style="background:transparent;border:none;color:${isLiked(song.id) ? 'var(--accent)' : 'var(--muted)'};font-size:20px;cursor:pointer;margin-left:8px;">❤️</button>
            `;
            div.onclick = () => playSong(song);
            
            // Add context menu
            div.addEventListener('contextmenu', (e) => {
                showContextMenu(e, song);
            });
            
            if (grid) grid.appendChild(div);

            getCleanSongTitle(song.id, song.title).then(clean => {
                const titleEl = div.querySelector('.song-title');
                if (titleEl) {
                    titleEl.textContent = clean;
                    titleEl.classList.remove('loading');
                }
            });
        });

        container.appendChild(songSection);
    }
}

function renderPlaylists() {
    const container = document.getElementById('playlistsList');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(playlists).forEach(name => {
        if (name === "Liked Songs") return;

        const playlist = playlists[name];
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.innerHTML = `
            <span class="playlist-icon">${playlist.emoji || '🎵'}</span>
            <div class="playlist-info">
                <div class="playlist-name">${escapeHtml(name)}</div>
                <div class="playlist-count">${playlist.songs?.length || 0} songs</div>
            </div>
        `;
        div.onclick = () => viewPlaylist(name);
        container.appendChild(div);
    });
}

// ────────────────────────────────────────
// PLAYLIST FUNCTIONS
// ────────────────────────────────────────

async function playPlaylist(playlistId, isAlbum = false) {
    try {
        const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${getNextKey()}`);
        
        if (!response.ok) throw new Error('API error');
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            currentSongs = data.items
                .map(item => ({
                    id: item.snippet.resourceId?.videoId,
                    title: item.snippet.title,
                    artist: item.snippet.channelTitle,
                    art: item.snippet.thumbnails?.medium?.url || ''
                }))
                .filter(song => song.id && song.title !== 'Private video' && song.title !== 'Deleted video');
            
            currentIndex = 0;
            currentPlaylist = null;
            
            if (isAlbum) {
                try {
                    const playlistResponse = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${getNextKey()}`);
                    const playlistData = await playlistResponse.json();
                    const albumName = playlistData.items?.[0]?.snippet?.title || data.items[0].snippet.channelTitle;
                    
                    showAlbumView(currentSongs, albumName, playlistId);
                } catch (err) {
                    console.error("Error fetching playlist details:", err);
                    showAlbumView(currentSongs, data.items[0].snippet.channelTitle, playlistId);
                }
            } else {
                if (currentSongs.length > 0) {
                    playSong(currentSongs[0]);
                }
            }
        }
    } catch (error) {
        console.error("Playlist error:", error);
        showNotification("Failed to load playlist");
    }
}

function showAlbumView(songs, albumName, playlistId = null) {
    const mainContent = document.getElementById('mainContent');
    if (!mainContent || !songs || songs.length === 0) return;

    mainContent.innerHTML = `
        <div class="album-view">
            <button class="back-btn" onclick="showHome()">← Back</button>
            <div class="album-header">
                <img src="${songs[0].art}" class="album-cover" alt="">
                <div class="album-info">
                    <h1>${escapeHtml(albumName)}</h1>
                    <p>${songs.length} songs</p>
                    <div style="display:flex;gap:12px;margin-top:16px;">
                        <button class="play-all-btn" onclick="currentIndex=0; playSong(currentSongs[0])">▶ Play All</button>
                        <button class="add-album-to-lib-btn" id="addAlbumBtn"><span>+</span> Add to Library</button>
                    </div>
                </div>
            </div>
            <div class="album-songs" id="albumSongsList"></div>
        </div>
    `;
    
    const songsList = document.getElementById('albumSongsList');
    songs.forEach((song, i) => {
        const div = document.createElement('div');
        div.className = 'album-song-item';
        div.innerHTML = `
            <span class="song-number">${i + 1}</span>
            <img src="${song.art}" alt="">
            <div class="song-info">
                <div class="song-title loading">${escapeHtml(song.title)}</div>
                <div class="song-artist">${escapeHtml(song.artist)}</div>
            </div>
        `;
        div.onclick = () => {
            currentIndex = i;
            playSong(song);
        };
        if (songsList) songsList.appendChild(div);
        
        getCleanSongTitle(song.id, song.title).then(clean => {
            const titleEl = div.querySelector('.song-title');
            if (titleEl) {
                titleEl.textContent = clean;
                titleEl.classList.remove('loading');
            }
        });
    });
    
    // Setup add to library button
    const addAlbumBtn = document.getElementById('addAlbumBtn');
    const albumId = playlistId || albumName.replace(/\W/g, '_');
    
    if (addAlbumBtn) {
        if (savedAlbums[albumId]) {
            addAlbumBtn.classList.add('added');
            addAlbumBtn.innerHTML = '<span>✓</span> In Library';
        }
        
        addAlbumBtn.onclick = () => {
            if (savedAlbums[albumId]) {
                showNotification("Album already in library");
                return;
            }
            
            const albumData = {
                name: albumName,
                artist: songs[0]?.artist || "Various Artists",
                cover: songs[0]?.art || "",
                songs: songs,
                playlistId: playlistId
            };
            
            if (saveAlbumToLibrary(albumData)) {
                addAlbumBtn.classList.add('added');
                addAlbumBtn.innerHTML = '<span>✓</span> In Library';
            }
        };
    }
}

async function openMix(seedSong) {
    const songs = await generateMix(seedSong);

    if (songs.length === 0) {
        showNotification("Couldn't generate mix");
        return;
    }

    currentSongs = songs;
    currentIndex = 0;
    currentPlaylist = null;

    const cleanSeedTitle = await getCleanSongTitle(seedSong.id, seedSong.title);
    const mixName = `${cleanSeedTitle} Mix`;

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = `
        <div class="playlist-view">
            <button class="back-btn" onclick="showHome()">← Back</button>
            <div class="playlist-header">
                <div class="playlist-icon-large">✦</div>
                <div class="playlist-info-large">
                    <h1>${escapeHtml(mixName)}</h1>
                    <p>${songs.length} songs · Recommended</p>
                    <button class="play-all-btn" onclick="currentIndex=0; playSong(currentSongs[0])">▶ Play</button>
                </div>
            </div>
            <div class="playlist-songs" id="mixSongsList"></div>
        </div>
    `;

    const list = document.getElementById('mixSongsList');
    songs.forEach((song, i) => {
        const div = document.createElement('div');
        div.className = 'album-song-item';
        div.innerHTML = `
            <span class="song-number">${i + 1}</span>
            <img src="${song.art}" alt="">
            <div class="song-info">
                <div class="song-title loading">${escapeHtml(song.title)}</div>
                <div class="song-artist">${escapeHtml(song.artist)}</div>
            </div>
        `;
        div.onclick = () => {
            currentIndex = i;
            playSong(song);
        };
        if (list) list.appendChild(div);
        
        getCleanSongTitle(song.id, song.title).then(clean => {
            const titleEl = div.querySelector('.song-title');
            if (titleEl) {
                titleEl.textContent = clean;
                titleEl.classList.remove('loading');
            }
        });
    });
}

async function generateMix(seedSong) {
    const query = `${seedSong.artist} official audio`;
    
    try {
        const res = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=15&q=${encodeURIComponent(query)}&key=${getNextKey()}`
        );
        
        if (!res.ok) throw new Error('API error');
        
        const data = await res.json();

        return (data.items || [])
            .map(item => ({
                id: item.id.videoId,
                title: item.snippet.title,
                artist: item.snippet.channelTitle,
                art: item.snippet.thumbnails.medium.url
            }))
            .filter(song => song.id);
    } catch (err) {
        console.error("Mix generation error:", err);
        return [];
    }
}

function viewPlaylist(name) {
    if (!playlists[name]) {
        console.error("Playlist not found:", name);
        return;
    }
    
    currentPlaylist = name;
    currentSongs = playlists[name].songs || [];

    const isLiked = name === "Liked Songs";
    const isLocked = playlists[name].locked || isLiked;

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = `
        <div class="playlist-view">
            <button class="back-btn" onclick="showHome()">← Back</button>
            <div class="playlist-header">
                <div class="playlist-icon-large">${playlists[name].emoji || '🎵'}</div>
                <div class="playlist-info-large">
                    <h1>${escapeHtml(name)}</h1>
                    <p>${currentSongs.length} songs</p>
                    <div style="display:flex;gap:12px;margin-top:16px;">
                        ${currentSongs.length > 0 ? `<button class="play-all-btn" onclick="currentIndex=0; playSong(currentSongs[0])">▶ Play All</button>` : ''}
                        ${!isLocked ? `
                            <button onclick="editPlaylist('${escapeHtml(name)}')" style="background:var(--soft);color:var(--text);border:none;padding:14px 24px;border-radius:30px;font-size:14px;font-weight:600;cursor:pointer;">✏️ Edit</button>
                            <button onclick="deletePlaylist('${escapeHtml(name)}')" style="background:rgba(255,0,0,.2);color:var(--text);border:none;padding:14px 24px;border-radius:30px;font-size:14px;font-weight:600;cursor:pointer;">🗑️ Delete</button>
                        ` : ''}
                    </div>
                </div>
            </div>
            <div class="playlist-songs" id="playlistSongsList"></div>
        </div>
    `;

    const songsList = document.getElementById('playlistSongsList');
    if (currentSongs.length === 0) {
        if (songsList) {
            songsList.innerHTML = `<p style="text-align:center; color:var(--muted); padding:40px;">${isLiked ? 'No liked songs yet' : 'No songs yet. Search and add some!'}</p>`;
        }
    } else {
        currentSongs.forEach((song, i) => {
            const div = document.createElement('div');
            div.className = 'album-song-item';
            div.innerHTML = `
                <span class="song-number">${i + 1}</span>
                <img src="${song.art || ''}" alt="">
                <div class="song-info">
                    <div class="song-title loading">${escapeHtml(song.title)}</div>
                    <div class="song-artist">${escapeHtml(song.artist)}</div>
                </div>
                ${!isLocked ? `
                    <button onclick="event.stopPropagation(); removeSongFromPlaylist('${escapeHtml(name)}', '${song.id}')" style="background:rgba(255,0,0,.2);color:var(--text);border:none;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;margin-left:auto;">×</button>
                ` : ''}
            `;
            div.onclick = () => {
                currentIndex = i;
                playSong(song);
            };
            if (songsList) songsList.appendChild(div);
            
            getCleanSongTitle(song.id, song.title).then(clean => {
                const titleEl = div.querySelector('.song-title');
                if (titleEl) {
                    titleEl.textContent = clean;
                    titleEl.classList.remove('loading');
                }
            });
        });
    }
}

function viewLikedSongs() {
    viewPlaylist("Liked Songs");
}

function updateLikedCount() {
    const countEl = document.getElementById('likedCount');
    if (countEl) {
        const count = playlists["Liked Songs"]?.songs?.length || 0;
        countEl.textContent = `${count} songs`;
    }
}

function isLiked(songId) {
    return playlists["Liked Songs"]?.songs?.some(s => s.id === songId) || false;
}

function toggleLike(song) {
    if (!song || !song.id) return;
    
    const alreadyLiked = playlists["Liked Songs"].songs.some(s => s.id === song.id);

    if (alreadyLiked) {
        playlists["Liked Songs"].songs = playlists["Liked Songs"].songs.filter(s => s.id !== song.id);
        showNotification("Removed from Liked Songs");
    } else {
        playlists["Liked Songs"].songs.push(song);
        showNotification("Added to Liked Songs ❤️");
    }

    save("playlists", playlists);
    updateLikedCount();
    
    if (currentPlaylist === "Liked Songs") {
        viewPlaylist("Liked Songs");
    }
}

function addToPlaylist(song, playlistName) {
    if (!playlists[playlistName]) return;
    
    const exists = playlists[playlistName].songs.some(s => s.id === song.id);
    if (exists) {
        showNotification('Song already in playlist');
        return;
    }
    
    playlists[playlistName].songs.push(song);
    save('playlists', playlists);
    renderPlaylists();
    showNotification(`Added to ${playlistName}`);
    closeAddMenu();
}

function showAddToPlaylistMenu(song) {
    const playlistNames = ["Liked Songs", ...Object.keys(playlists).filter(n => n !== "Liked Songs")];

    if (playlistNames.length === 0) {
        showNotification('No playlists yet — create one!');
        return;
    }

    const menu = document.createElement('div');
    menu.className = 'modal active';
    menu.innerHTML = `
        <div class="modal-content">
            <h3>Add to Playlist</h3>
            <div style="max-height: 300px; overflow-y: auto; margin-bottom: 16px;">
                ${playlistNames.map(name => `
                    <div class="playlist-item" onclick="addToPlaylist(${JSON.stringify(song).replace(/"/g, '&quot;')}, '${escapeHtml(name)}')" style="margin-bottom: 8px; cursor: pointer;">
                        <span class="playlist-icon">${playlists[name]?.emoji || (name === "Liked Songs" ? "❤️" : "🎵")}</span>
                        <div class="playlist-info">
                            <div class="playlist-name">${escapeHtml(name)}</div>
                            <div class="playlist-count">${(playlists[name]?.songs?.length || 0)} songs</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="modal-buttons">
                <button class="secondary" onclick="closeAddMenu()">Cancel</button>
            </div>
        </div>
    `;
    menu.id = 'addMenu';
    document.body.appendChild(menu);
}

function closeAddMenu() {
    const menu = document.getElementById('addMenu');
    if (menu) menu.remove();
}

function removeSongFromPlaylist(playlistName, songId) {
    if (!playlists[playlistName]) return;
    
    playlists[playlistName].songs = playlists[playlistName].songs.filter(s => s.id !== songId);
    save('playlists', playlists);
    renderPlaylists();
    viewPlaylist(playlistName);
    showNotification('Song removed');
}

// ────────────────────────────────────────
// MODAL FUNCTIONS
// ────────────────────────────────────────

function openCreateModal() {
    const modal = document.getElementById('createModal');
    if (modal) {
        modal.classList.add('active');
        const nameInput = document.getElementById('playlistNameInput');
        if (nameInput) nameInput.focus();
    }
}

function closeCreateModal() {
    const modal = document.getElementById('createModal');
    if (modal) {
        modal.classList.remove('active');
        const nameInput = document.getElementById('playlistNameInput');
        const emojiInput = document.getElementById('playlistEmojiInput');
        if (nameInput) nameInput.value = '';
        if (emojiInput) emojiInput.value = '';
    }
}

function createPlaylist() {
    const nameInput = document.getElementById('playlistNameInput');
    const emojiInput = document.getElementById('playlistEmojiInput');
    
    const name = nameInput?.value.trim() || '';
    const emoji = emojiInput?.value.trim() || '🎵';
    
    if (!name) return;
    
    if (playlists[name]) {
        alert('Playlist already exists!');
        return;
    }
    
    playlists[name] = { emoji, songs: [] };
    save('playlists', playlists);
    renderPlaylists();
    closeCreateModal();
    showNotification('Playlist created!');
}

function deletePlaylist(name) {
    if (confirm(`Delete playlist "${name}"?`)) {
        delete playlists[name];
        save('playlists', playlists);
        renderPlaylists();
        showHome();
        showNotification('Playlist deleted');
    }
}

function editPlaylist(name) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'editModal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Edit Playlist</h3>
            <input type="text" id="editPlaylistNameInput" placeholder="Playlist name" value="${escapeHtml(name)}">
            <input type="text" id="editPlaylistEmojiInput" placeholder="Emoji (e.g. 🎵)" maxlength="2" value="${playlists[name]?.emoji || '🎵'}">
            <div class="modal-buttons">
                <button class="secondary" onclick="closeEditModal()">Cancel</button>
                <button class="primary" onclick="savePlaylistEdit('${escapeHtml(name)}')">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.remove();
}

function savePlaylistEdit(oldName) {
    const nameInput = document.getElementById('editPlaylistNameInput');
    const emojiInput = document.getElementById('editPlaylistEmojiInput');
    
    const newName = nameInput?.value.trim() || '';
    const newEmoji = emojiInput?.value.trim() || '🎵';
    
    if (!newName) {
        showNotification('Playlist name cannot be empty');
        return;
    }
    
    if (newName !== oldName && playlists[newName]) {
        showNotification('Playlist name already exists');
        return;
    }
    
    const songs = playlists[oldName].songs;
    delete playlists[oldName];
    playlists[newName] = { emoji: newEmoji, songs: songs };
    
    save('playlists', playlists);
    renderPlaylists();
    closeEditModal();
    showNotification('Playlist updated');
    
    if (currentPlaylist === oldName) {
        viewPlaylist(newName);
    } else {
        showHome();
    }
}

// ────────────────────────────────────────
// UI HELPER FUNCTIONS
// ────────────────────────────────────────

function toggleLeftSidebar() {
    const sidebar = document.getElementById('leftSidebar');
    if (sidebar) sidebar.classList.toggle('minimized');
}

function toggleRightSidebar() {
    const sidebar = document.getElementById('rightSidebar');
    if (sidebar) sidebar.classList.toggle('minimized');
}

function updateGradient(imageUrl) {
    if (!imageUrl) return;
    
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;
    
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        canvas.width = 1;
        canvas.height = 1;
        ctx.drawImage(img, 0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        const color = `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
        document.documentElement.style.setProperty('--gradient-color', color);
    };
}

// ════════════════════════════════════════════════════════════
// LINK BUTTON - Share & Connect Features
// Paste this at the BOTTOM of your script.js file
// ════════════════════════════════════════════════════════════

window.linkIndy = function() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'linkModal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 520px;">
            <h3 style="margin-bottom: 20px;">🔗 Share & Connect</h3>
            <p style="color: var(--muted); margin-bottom: 28px; line-height: 1.5;">
                Share songs, export data, or transfer everything to another device.
            </p>

            <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 32px;">
                <button class="link-option-btn" onclick="shareCurrentSong()">
                    <span style="font-size: 28px;">🎵</span>
                    <div>
                        <div>Share Current Song</div>
                        <div style="font-size: 13px; color: var(--muted); margin-top: 3px;">
                            Copy YouTube link
                        </div>
                    </div>
                </button>

                <button class="link-option-btn" onclick="exportPlaylists()">
                    <span style="font-size: 28px;">💾</span>
                    <div>
                        <div>Export All Data</div>
                        <div style="font-size: 13px; color: var(--muted); margin-top: 3px;">
                            Download as JSON file
                        </div>
                    </div>
                </button>

                <button class="link-option-btn" onclick="document.getElementById('importFileInput').click()">
                    <span style="font-size: 28px;">📥</span>
                    <div>
                        <div>Import from File</div>
                        <div style="font-size: 13px; color: var(--muted); margin-top: 3px;">
                            Restore from backup
                        </div>
                    </div>
                </button>

                <!-- ── NEW TRANSFER BUTTON ─────────────────────────────── -->
                <button class="link-option-btn" onclick="transferDataViaClipboard(); closeLinkModal()" style="
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                ">
                    <span style="font-size: 28px;">📲</span>
                    <div>
                        <div>Transfer to Another Device</div>
                        <div style="font-size: 13px; opacity: 0.9; margin-top: 3px;">
                            Copy / Paste JSON (merge)
                        </div>
                    </div>
                </button>

                <button class="link-option-btn" onclick="shareLibraryLink()">
                    <span style="font-size: 28px;">📊</span>
                    <div>
                        <div>Share My Stats</div>
                        <div style="font-size: 13px; color: var(--muted); margin-top: 3px;">
                            Copy summary text
                        </div>
                    </div>
                </button>

                <button class="link-option-btn" onclick="clearAllData()" style="color: #ff6b6b;">
                    <span style="font-size: 28px;">🗑️</span>
                    <div>
                        <div>Reset Everything</div>
                        <div style="font-size: 13px; opacity: 0.7; margin-top: 3px;">
                            Clear all data
                        </div>
                    </div>
                </button>
            </div>

            <input type="file" id="importFileInput" accept=".json" style="display: none;">
            <div class="modal-buttons">
                <button class="secondary" onclick="closeLinkModal()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Re-attach import file handler (if needed)
    const importInput = document.getElementById('importFileInput');
    if (importInput) {
        importInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        importData(data);
                    } catch (err) {
                        showNotification('❌ Invalid file format');
                    }
                };
                reader.readAsText(file);
            }
        };
    }
};

// Close link modal
window.closeLinkModal = function() {
    const modal = document.getElementById('linkModal');
    if (modal) modal.remove();
};

// Share current song
window.shareCurrentSong = function() {
    if (!currentPlayingSong) {
        showNotification('No song currently playing');
        return;
    }
    
    const url = `https://youtube.com/watch?v=${currentPlayingSong.id}`;
    navigator.clipboard.writeText(url).then(() => {
        showNotification('🔗 Link copied to clipboard!');
        closeLinkModal();
    }).catch(() => {
        showNotification('Failed to copy link');
    });
};

// Export all data
window.exportPlaylists = function() {
    const exportData = {
        version: '2.0',
        exportDate: new Date().toISOString(),
        playlists: playlists,
        recent: recent,
        savedAlbums: savedAlbums,
        listeningStats: listeningStats,
        queue: queue
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `indy-music-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showNotification('💾 Data exported successfully!');
    closeLinkModal();
};

// Import data
window.importData = function(data) {
    if (!data || !data.version) {
        showNotification('❌ Invalid backup file');
        return;
    }
    
    if (confirm('This will replace all current data. Continue?')) {
        if (data.playlists) {
            playlists = data.playlists;
            save('playlists', playlists);
        }
        if (data.recent) {
            recent = data.recent;
            save('recent', recent);
        }
        if (data.savedAlbums) {
            savedAlbums = data.savedAlbums;
            save('indy_saved_albums', savedAlbums);
        }
        if (data.listeningStats) {
            listeningStats = data.listeningStats;
            save('listening_stats', listeningStats);
        }
        if (data.queue) {
            queue = data.queue;
            save('queue', queue);
        }
        
        showNotification('✅ Data imported successfully!');
        closeLinkModal();
        
        // Refresh the page to show imported data
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
};

// Share library stats
window.shareLibraryLink = function() {
    const stats = `🎵 My INDY Music Stats 🎵

📊 Songs Played: ${listeningStats.songsPlayed || 0}
💿 Albums Saved: ${Object.keys(savedAlbums).length}
📝 Playlists: ${Object.keys(playlists).filter(n => n !== 'Liked Songs').length}
⏱️ Listening Time: ${Math.floor((listeningStats.totalMinutes || 0) / 60)}h

❤️ Liked Songs: ${playlists['Liked Songs']?.songs?.length || 0}

Built with INDY Music Player`;

    navigator.clipboard.writeText(stats).then(() => {
        showNotification('📋 Stats copied to clipboard!');
        closeLinkModal();
    }).catch(() => {
        showNotification('Failed to copy stats');
    });
};

// Clear all data
window.clearAllData = function() {
    const confirmText = prompt(
        'This will DELETE everything!\n\nType "DELETE ALL" to confirm:'
    );
    
    if (confirmText === 'DELETE ALL') {
        // Clear all storage
        localStorage.clear();
        
        showNotification('🗑️ All data cleared');
        closeLinkModal();
        
        // Reload page
        setTimeout(() => {
            location.reload();
        }, 1000);
    } else if (confirmText !== null) {
        showNotification('❌ Cancelled - incorrect confirmation');
    }
};

console.log('✓ Link button features enabled');

// ────────────────────────────────────────
// FULLSCREEN LYRICS
// ────────────────────────────────────────

function setupFullscreenLyrics() {
    const lyricsSection = document.querySelector('.lyrics-section');
    if (!lyricsSection) return;

    lyricsSection.style.position = 'relative';
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.innerHTML = '↔';
    fullscreenBtn.style.cssText = `
        position: absolute; top: 16px; right: 16px; width: 40px; height: 40px;
        background: rgba(255,255,255,0.15); backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.2); border-radius: 50%;
        color: white; font-size: 18px; cursor: pointer; z-index: 10;
        transition: all 0.3s ease;
    `;
    fullscreenBtn.onmouseover = () => fullscreenBtn.style.background = 'rgba(255,255,255,0.3)';
    fullscreenBtn.onmouseout = () => fullscreenBtn.style.background = 'rgba(255,255,255,0.15)';
    lyricsSection.appendChild(fullscreenBtn);

    const fullscreenLyricsOverlay = document.createElement('div');
    fullscreenLyricsOverlay.id = 'fullscreenLyricsOverlay';
    fullscreenLyricsOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: var(--gradient-color); z-index: 9999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 60px; opacity: 0; pointer-events: none;
        transition: opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        font-size: 28px; line-height: 2; text-align: center;
    `;
    fullscreenLyricsOverlay.innerHTML = `
        <button id="exitFullscreenLyrics" style="
            position: absolute; top: 30px; right: 30px;
            background: rgba(0,0,0,0.4); border: none; color: white;
            width: 50px; height: 50px; border-radius: 50%; font-size: 24px;
            cursor: pointer; backdrop-filter: blur(10px);
        ">×</button>
        <div id="fullscreenLyricsText" style="
            max-width: 90%; max-height: 90vh; overflow-y: auto;
            padding: 20px; color: white; text-shadow: 0 4px 20px rgba(0,0,0,0.6);
        "></div>
    `;
    document.body.appendChild(fullscreenLyricsOverlay);

    function toggleFullscreenLyrics() {
        isFullscreenLyrics = !isFullscreenLyrics;
        
        if (isFullscreenLyrics) {
            fullscreenLyricsOverlay.style.opacity = '1';
            fullscreenLyricsOverlay.style.pointerEvents = 'all';
            const lyricsContainer = document.getElementById('lyrics');
            const fullscreenText = document.getElementById('fullscreenLyricsText');
            if (fullscreenText) {
                fullscreenText.innerHTML = lyricsContainer ? lyricsContainer.innerHTML : '';
            }
            
            const rgb = getComputedStyle(document.documentElement).getPropertyValue('--gradient-color').trim();
            const match = rgb.match(/\d+/g);
            if (match && match.length >= 3) {
                const r = parseInt(match[0]), g = parseInt(match[1]), b = parseInt(match[2]);
                const brightness = (r*299 + g*587 + b*114) / 1000;
                const fullscreenTextEl = document.getElementById('fullscreenLyricsText');
                if (fullscreenTextEl) {
                    fullscreenTextEl.style.color = brightness > 128 ? '#000' : '#fff';
                }
            }
            
            lyricsSection.style.opacity = '0';
        } else {
            fullscreenLyricsOverlay.style.opacity = '0';
            setTimeout(() => { fullscreenLyricsOverlay.style.pointerEvents = 'none'; }, 500);
            lyricsSection.style.opacity = '1';
        }
    }

    fullscreenBtn.onclick = toggleFullscreenLyrics;
    const exitBtn = document.getElementById('exitFullscreenLyrics');
    if (exitBtn) exitBtn.onclick = toggleFullscreenLyrics;
}

// ═══════════════════════════════════════
// IMPROVED QUEUE SYSTEM
// ═══════════════════════════════════════

function addToQueue(song) {
    if (!song || !song.id) return;
    
    // Don't add if already in queue
    if (queue.some(s => s.id === song.id)) {
        showNotification("Already in queue");
        return;
    }
    
    queue.push(song);
    save('queue', queue);
    showNotification(`Added "${song.title}" to queue`);
    renderQueue();
    
    // If nothing is playing, start playing from queue
    if (!currentPlayingSong && queue.length === 1) {
        playFromQueue(0);
    }
}

function removeFromQueue(index) {
    // Check if we're removing the currently playing song from queue
    const wasPlayingCurrent = (index === queueIndex && currentPlayingSong);
    
    queue.splice(index, 1);
    
    // Adjust queueIndex if needed
    if (index < queueIndex) {
        queueIndex--;
    } else if (index === queueIndex) {
        // If we removed the current song, move to next or stop
        if (queue.length > 0) {
            if (queueIndex >= queue.length) queueIndex = queue.length - 1;
        } else {
            queueIndex = 0;
        }
    }
    
    save('queue', queue);
    renderQueue();
    
    // If we removed the currently playing song, play the next one
    if (wasPlayingCurrent && queue.length > 0) {
        playFromQueue(queueIndex);
    } else if (queue.length === 0) {
        // Queue empty, but keep playing current song if any
        showNotification("Queue cleared");
    }
}

function clearQueue() {
    if (queue.length === 0) return;
    
    if (confirm(`Clear all ${queue.length} songs from queue?`)) {
        queue = [];
        queueIndex = 0;
        save('queue', queue);
        renderQueue();
        showNotification("Queue cleared");
        // Keep playing current song
    }
}

function shuffleQueue() {
    if (queue.length < 2) return;
    
    // Save current playing song
    const currentSong = queue[queueIndex];
    
    // Fisher-Yates shuffle
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    
    // Find new index of current song
    if (currentSong) {
        queueIndex = queue.findIndex(s => s.id === currentSong.id);
    } else {
        queueIndex = 0;
    }
    
    save('queue', queue);
    renderQueue();
    showNotification("Queue shuffled 🔀");
}

function playFromQueue(index) {
    if (index < 0 || index >= queue.length) return;
    
    queueIndex = index;
    currentSongs = [...queue]; // Set current songs to queue
    currentIndex = index;
    currentPlaylist = null; // Clear playlist context
    
    playSong(queue[index]);
}

function moveToNextInQueue() {
    if (queue.length === 0) return false;
    
    // Check if we have more songs in queue
    if (queueIndex < queue.length - 1) {
        // Play next song in queue
        queueIndex++;
        playFromQueue(queueIndex);
        return true;
    } else {
        // End of queue reached
        showNotification("End of queue");
        return false;
    }
}

function moveToPreviousInQueue() {
    if (queue.length === 0) return false;
    
    if (queueIndex > 0) {
        queueIndex--;
        playFromQueue(queueIndex);
        return true;
    }
    return false;
}

function renderQueue() {
    const container = document.getElementById('queueList');
    if (!container) return;
    
    if (queue.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎵</div>
                <div class="empty-state-text">Queue is empty</div>
                <div class="empty-state-subtext">Add songs to build your queue</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    queue.forEach((song, i) => {
        const div = document.createElement('div');
        div.className = 'queue-item' + (i === queueIndex && currentPlayingSong ? ' playing' : '');
        div.innerHTML = `
            <img src="${song.art || ''}" alt="" loading="lazy">
            <div class="queue-item-info">
                <div class="queue-item-title">${escapeHtml(song.title)}</div>
                <div class="queue-item-artist">${escapeHtml(song.artist)}</div>
            </div>
            <button class="queue-remove" onclick="event.stopPropagation(); removeFromQueue(${i})">×</button>
        `;
        div.onclick = () => playFromQueue(i);
        container.appendChild(div);
    });
}

// ═══════════════════════════════════════
// ALBUM LIBRARY SYSTEM
// ═══════════════════════════════════════

function saveAlbumToLibrary(albumData) {
    const albumId = albumData.playlistId || albumData.name.replace(/\W/g, '_');
    
    if (savedAlbums[albumId]) {
        showNotification("Album already in library!");
        return false;
    }
    
    savedAlbums[albumId] = {
        id: albumId,
        name: albumData.name,
        artist: albumData.artist || "Various Artists",
        cover: albumData.cover,
        songs: albumData.songs,
        dateAdded: Date.now(),
        playlistId: albumData.playlistId
    };
    
    save('indy_saved_albums', savedAlbums);
    showNotification(`Added "${albumData.name}" to library! 🎵`);
    renderLibrary();
    updateFilterCounts();
    return true;
}

function removeAlbumFromLibrary(albumId) {
    if (!savedAlbums[albumId]) return;
    
    const albumName = savedAlbums[albumId].name;
    if (confirm(`Remove "${albumName}" from your library?`)) {
        delete savedAlbums[albumId];
        save('indy_saved_albums', savedAlbums);
        showNotification(`Removed "${albumName}" from library`);
        renderLibrary();
        updateFilterCounts();
    }
}

function renderLibrary() {
    const container = document.getElementById('libraryGrid');
    const section = document.getElementById('librarySection');
    
    if (!container || !section) return;
    
    const albums = Object.values(savedAlbums);
    
    if (albums.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    container.innerHTML = '';
    
    // Sort by date added (newest first)
    albums.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    
    albums.slice(0, 6).forEach(album => {
        const div = document.createElement('div');
        div.className = 'library-album-card';
        
        // Add "new" badge if added in last 7 days
        const isNew = Date.now() - (album.dateAdded || 0) < 7 * 24 * 60 * 60 * 1000;
        
        div.innerHTML = `
            ${isNew ? '<div class="recently-added-badge">New</div>' : ''}
            <img src="${album.cover}" alt="${escapeHtml(album.name)}">
            <div class="album-title">${escapeHtml(album.name)}</div>
            <div class="album-artist">${escapeHtml(album.artist)}</div>
            <button class="remove-album-btn" onclick="event.stopPropagation(); removeAlbumFromLibrary('${album.id}')">×</button>
        `;
        
        div.onclick = () => playAlbumFromLibrary(album);
        container.appendChild(div);
    });
}

async function playAlbumFromLibrary(album) {
    currentSongs = album.songs;
    currentIndex = 0;
    currentPlaylist = null;
    
    showAlbumView(album.songs, album.name, album.playlistId);
}

// ═══════════════════════════════════════
// FILTER SYSTEM
// ═══════════════════════════════════════

function filterContent(type) {
    currentFilter = type;
    
    console.log("Filtering by:", type);
    
    // Update active chip
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.remove('active');
        if (chip.getAttribute('data-filter') === type) {
            chip.classList.add('active');
        }
    });
    
    // Get all section elements
    const sections = {
        recent: document.getElementById('recentSection'),
        albums: document.getElementById('albumsSection'),
        mixes: document.getElementById('mixesSection'),
        popular: document.getElementById('popularSection'),
        artists: document.getElementById('artistsSection'),
        library: document.getElementById('librarySection'),
        stats: document.getElementById('statsCard')
    };
    
    // Hide all sections first
    Object.values(sections).forEach(section => {
        if (section) {
            section.style.display = 'none';
        }
    });
    
    // Show sections based on filter
    switch(type) {
        case 'all':
            if (sections.recent) sections.recent.style.display = 'block';
            if (sections.albums) sections.albums.style.display = 'block';
            if (sections.mixes) sections.mixes.style.display = 'block';
            if (sections.popular) sections.popular.style.display = 'block';
            if (sections.artists) sections.artists.style.display = 'block';
            if (Object.keys(savedAlbums).length > 0 && sections.library) {
                sections.library.style.display = 'block';
            }
            break;
            
        case 'songs':
            if (sections.recent) sections.recent.style.display = 'block';
            if (sections.popular) sections.popular.style.display = 'block';
            break;
            
        case 'albums':
            if (sections.albums) sections.albums.style.display = 'block';
            if (Object.keys(savedAlbums).length > 0 && sections.library) {
                sections.library.style.display = 'block';
            }
            break;
            
        case 'mixes':
            if (sections.mixes) sections.mixes.style.display = 'block';
            break;
            
        case 'library':
            if (sections.library) sections.library.style.display = 'block';
            if (sections.stats) {
                sections.stats.style.display = 'block';
                updateStats();
            }
            break;
    }
    
    console.log("Filter applied successfully");
}

function updateFilterCounts() {
    const filterAllCount = document.getElementById('filterAllCount');
    const filterSongsCount = document.getElementById('filterSongsCount');
    const filterAlbumsCount = document.getElementById('filterAlbumsCount');
    const filterMixesCount = document.getElementById('filterMixesCount');
    const filterLibraryCount = document.getElementById('filterLibraryCount');
    
    if (filterAllCount) {
        filterAllCount.textContent = `(${recent.length + Object.keys(savedAlbums).length})`;
    }
    if (filterSongsCount) {
        filterSongsCount.textContent = `(${recent.length})`;
    }
    if (filterAlbumsCount) {
        filterAlbumsCount.textContent = `(0)`;
    }
    if (filterMixesCount) {
        filterMixesCount.textContent = `(${recent.length > 0 ? 6 : 0})`;
    }
    if (filterLibraryCount) {
        filterLibraryCount.textContent = `(${Object.keys(savedAlbums).length})`;
    }
}

// ═══════════════════════════════════════
// STATISTICS SYSTEM
// ═══════════════════════════════════════

function updateStats() {
    const statSongsPlayed = document.getElementById('statSongsPlayed');
    const statAlbumsSaved = document.getElementById('statAlbumsSaved');
    const statPlaylists = document.getElementById('statPlaylists');
    const statListeningTime = document.getElementById('statListeningTime');
    
    if (statSongsPlayed) {
        statSongsPlayed.textContent = listeningStats.songsPlayed || 0;
    }
    if (statAlbumsSaved) {
        statAlbumsSaved.textContent = Object.keys(savedAlbums).length;
    }
    if (statPlaylists) {
        statPlaylists.textContent = Object.keys(playlists).filter(name => name !== "Liked Songs").length;
    }
    if (statListeningTime) {
        const hours = Math.floor((listeningStats.totalMinutes || 0) / 60);
        statListeningTime.textContent = `${hours}h`;
    }
}

function incrementSongPlay() {
    listeningStats.songsPlayed = (listeningStats.songsPlayed || 0) + 1;
    listeningStats.totalMinutes = (listeningStats.totalMinutes || 0) + 3; // Estimate 3 min per song
    listeningStats.lastUpdated = Date.now();
    save('listening_stats', listeningStats);
}

// ═══════════════════════════════════════
// SHUFFLE & REPEAT
// ═══════════════════════════════════════

function toggleShuffle() {
    shuffleMode = !shuffleMode;
    const btn = document.getElementById('shuffleBtn');
    
    if (btn) {
        if (shuffleMode) {
            btn.classList.add('active');
            showNotification("Shuffle ON 🔀");
        } else {
            btn.classList.remove('active');
            showNotification("Shuffle OFF");
        }
    }
}

function toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const currentIndex = modes.indexOf(repeatMode);
    repeatMode = modes[(currentIndex + 1) % modes.length];
    
    const btn = document.getElementById('repeatBtn');
    
    if (btn) {
        if (repeatMode === 'off') {
            btn.classList.remove('active');
            btn.innerHTML = '<span>🔁</span> Repeat';
            showNotification("Repeat OFF");
        } else if (repeatMode === 'all') {
            btn.classList.add('active');
            btn.innerHTML = '<span>🔁</span> Repeat All';
            showNotification("Repeat All 🔁");
        } else {
            btn.classList.add('active');
            btn.innerHTML = '<span>🔂</span> Repeat One';
            showNotification("Repeat One 🔂");
        }
    }
}

// ═══════════════════════════════════════
// VIDEO ERROR HANDLING
// ═══════════════════════════════════════

function showVideoError() {
    const overlay = document.getElementById('videoError');
    if (overlay) {
        overlay.classList.add('show');
    }
}

function hideVideoError() {
    const overlay = document.getElementById('videoError');
    if (overlay) {
        overlay.classList.remove('show');
    }
}

function retryVideo() {
    hideVideoError();
    if (currentPlayingSong) {
        showNotification("Retrying video...");
        // Try to reload
        setTimeout(() => {
            playSong(currentPlayingSong);
        }, 500);
    }
}

// ═══════════════════════════════════════
// MINI PLAYER
// ═══════════════════════════════════════

function updateMiniPlayer(song) {
    const miniPlayer = document.getElementById('miniPlayer');
    if (!miniPlayer) return;
    
    const miniPlayerImg = document.getElementById('miniPlayerImg');
    const miniPlayerTitle = document.getElementById('miniPlayerTitle');
    const miniPlayerArtist = document.getElementById('miniPlayerArtist');
    
    if (miniPlayerImg) miniPlayerImg.src = song.art || '';
    if (miniPlayerTitle) miniPlayerTitle.textContent = song.title || 'Unknown';
    if (miniPlayerArtist) miniPlayerArtist.textContent = song.artist || 'Unknown';
}

function scrollToPlayer() {
    const rightSidebar = document.getElementById('rightSidebar');
    if (rightSidebar) {
        rightSidebar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Show mini player when scrolling in main content
let scrollTimeout;
const mainContent = document.getElementById('mainContent');
if (mainContent) {
    mainContent.addEventListener('scroll', (e) => {
        const miniPlayer = document.getElementById('miniPlayer');
        if (!miniPlayer) return;
        
        clearTimeout(scrollTimeout);
        
        if (e.target.scrollTop > 300 && currentPlayingSong) {
            miniPlayer.classList.add('show');
            
            scrollTimeout = setTimeout(() => {
                miniPlayer.classList.remove('show');
            }, 3000);
        } else {
            miniPlayer.classList.remove('show');
        }
    });
}

// ═══════════════════════════════════════
// CONTEXT MENU (Right-click)
// ═══════════════════════════════════════

function showContextMenu(e, song) {
    e.preventDefault();
    e.stopPropagation();
    
    contextMenuTarget = song;
    
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.classList.add('show');
}

function contextMenuAction(action) {
    const menu = document.getElementById('contextMenu');
    if (menu) menu.classList.remove('show');
    
    if (!contextMenuTarget) return;
    
    switch(action) {
        case 'play':
            playSong(contextMenuTarget);
            break;
        case 'queue':
            addToQueue(contextMenuTarget);
            break;
        case 'playlist':
            showAddToPlaylistMenu(contextMenuTarget);
            break;
        case 'like':
            toggleLike(contextMenuTarget);
            break;
        case 'share':
            const url = `https://youtube.com/watch?v=${contextMenuTarget.id}`;
            navigator.clipboard.writeText(url).then(() => {
                showNotification("Link copied! 🔗");
            }).catch(() => {
                showNotification("Could not copy link");
            });
            break;
    }
    
    contextMenuTarget = null;
}

// Close context menu when clicking elsewhere
document.addEventListener('click', () => {
    const menu = document.getElementById('contextMenu');
    if (menu) menu.classList.remove('show');
});

// ═══════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════

document.addEventListener('keydown', (e) => {
    // Don't trigger if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch(e.key) {
        case ' ':
            e.preventDefault();
            // Toggle play/pause (would need YouTube API implementation)
            break;
        case 'ArrowRight':
            e.preventDefault();
            skipToNext();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            skipToPrevious();
            break;
        case 'q':
        case 'Q':
            toggleQueue();
            break;
        case 's':
        case 'S':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                // Save current song
                if (currentPlayingSong) {
                    toggleLike(currentPlayingSong);
                }
            } else {
                toggleShuffle();
            }
            break;
        case 'r':
        case 'R':
            toggleRepeat();
            break;
    }
});

// ────────────────────────────────────────
// GLOBAL EVENT HANDLERS
// ────────────────────────────────────────

document.addEventListener('click', (e) => {
    if (e.target.id === 'addToPlaylistBtn' || e.target.closest('#addToPlaylistBtn')) {
        if (!currentPlayingSong) {
            showNotification("Nothing playing right now");
            return;
        }
        showAddToPlaylistMenu(currentPlayingSong);
    }
});

// ────────────────────────────────────────
// START APPLICATION
// ────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// ────────────────────────────────────────
// EXPORT FUNCTIONS TO GLOBAL SCOPE
// ────────────────────────────────────────

window.showHome = showHome;
window.showSearch = showSearch;
window.playSong = playSong;
window.skipToNext = skipToNext;
window.skipToPrevious = skipToPrevious;
window.toggleLeftSidebar = toggleLeftSidebar;
window.toggleRightSidebar = toggleRightSidebar;
window.viewLikedSongs = viewLikedSongs;
window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.createPlaylist = createPlaylist;
window.deletePlaylist = deletePlaylist;
window.editPlaylist = editPlaylist;
window.closeEditModal = closeEditModal;
window.savePlaylistEdit = savePlaylistEdit;
window.removeSongFromPlaylist = removeSongFromPlaylist;
window.showAddToPlaylistMenu = showAddToPlaylistMenu;
window.addToPlaylist = addToPlaylist;
window.closeAddMenu = closeAddMenu;
window.toggleLike = toggleLike;
window.linkIndy = linkIndy;
window.filterContent = filterContent;
window.toggleQueue = toggleQueue;
window.renderPopular = renderPopular;
window.renderArtists = renderArtists;
window.setupFilterButtons = setupFilterButtons;
window.addToQueue = addToQueue;
window.removeFromQueue = removeFromQueue;
window.clearQueue = clearQueue;
window.shuffleQueue = shuffleQueue;
window.playFromQueue = playFromQueue;
window.saveAlbumToLibrary = saveAlbumToLibrary;
window.removeAlbumFromLibrary = removeAlbumFromLibrary;
window.playAlbumFromLibrary = playAlbumFromLibrary;
window.toggleShuffle = toggleShuffle;
window.toggleRepeat = toggleRepeat;
window.showVideoError = showVideoError;
window.hideVideoError = hideVideoError;
window.retryVideo = retryVideo;
window.scrollToPlayer = scrollToPlayer;
window.showContextMenu = showContextMenu;
window.contextMenuAction = contextMenuAction;
window.currentSongs = currentSongs;


console.log('🎵 INDY Music v2.0 - Fully debugged and enhanced!');

// ════════════════════════════════════════════════════════════
// IMPROVED FIX: Back Button - Properly Restore Home View
// Paste this at the BOTTOM of your script.js file
// (Replace the previous fix if you already pasted it)
// ════════════════════════════════════════════════════════════

// Override the showHome function to properly restore home view
window.showHome = function() {
    const mainContent = document.getElementById('mainContent');
    const searchView = document.getElementById('searchView');
    const homeBtn = document.getElementById('homeBtn');
    const searchBtn = document.getElementById('searchBtn');
    
    if (!mainContent) return;

    // Get or create the home view
    let homeView = document.getElementById('homeView');
    
    // If homeView doesn't exist, we need to recreate the structure
    if (!homeView) {
        // Clear main content completely
        mainContent.innerHTML = '';
        
        // Recreate home view structure
        homeView = document.createElement('div');
        homeView.id = 'homeView';
        homeView.innerHTML = `
            <!-- Filter Chips -->
            <div class="filter-chips" id="filterChips">
                <button class="filter-chip active" onclick="filterContent('all')" data-filter="all">
                    <span></span> All <span class="count" id="filterAllCount"></span>
                </button>
                <button class="filter-chip" onclick="filterContent('songs')" data-filter="songs">
                    <span></span> Songs <span class="count" id="filterSongsCount"></span>
                </button>
                <button class="filter-chip" onclick="filterContent('albums')" data-filter="albums">
                    <span></span> Albums <span class="count" id="filterAlbumsCount"></span>
                </button>
                <button class="filter-chip" onclick="filterContent('mixes')" data-filter="mixes">
                    <span>✦</span> Mixes <span class="count" id="filterMixesCount"></span>
                </button>
                <button class="filter-chip" onclick="filterContent('library')" data-filter="library">
                    <span></span> My Library <span class="count" id="filterLibraryCount"></span>
                </button>
            </div>

            <!-- Stats Card -->
            <div class="stats-card" id="statsCard" style="display:none;">
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value" id="statSongsPlayed">0</div>
                        <div class="stat-label">Songs Played</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="statAlbumsSaved">0</div>
                        <div class="stat-label">Albums Saved</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="statPlaylists">0</div>
                        <div class="stat-label">Playlists</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="statListeningTime">0h</div>
                        <div class="stat-label">Listening Time</div>
                    </div>
                </div>
            </div>
        
            <div class="section" id="recentSection">
                <div class="section-header">
                    <h2>Recently Played</h2>
                </div>
                <div class="recent-grid" id="recentGrid"></div>
            </div>

            <div class="section" id="albumsSection">
                <div class="section-header">
                    <h2>Recommended Albums</h2>
                </div>
                <div class="scroll-container" id="albumsScroll"></div>
            </div>

            <div class="section" id="mixesSection">
                <div class="section-header">
                    <h2>✦ Recommended Mixes</h2>
                </div>
                <div class="scroll-container" id="mixesScroll"></div>
            </div>
            
            <div class="section" id="popularSection">
                <div class="section-header">
                    <h2>🔥 Popular Right Now</h2>
                </div>
                <div class="scroll-container" id="popularScroll"></div>
            </div>
            
            <div class="section" id="artistsSection">
                <div class="section-header">
                    <h2>🎤 Discover Artists</h2>
                </div>
                <div class="scroll-container" id="artistsScroll"></div>
            </div>

            <div class="section library-section" id="librarySection" style="display:none;">
                <div class="section-header">
                    <h2>📚 My Album Library</h2>
                </div>
                <div class="library-grid" id="libraryGrid"></div>
            </div>
        `;
        
        mainContent.appendChild(homeView);
    } else {
        // Home view exists, just make sure it's visible
        homeView.style.display = 'block';
    }
    
    // Remove any playlist or album views
    const playlistView = mainContent.querySelector('.playlist-view');
    const albumView = mainContent.querySelector('.album-view');
    
    if (playlistView) playlistView.remove();
    if (albumView) albumView.remove();
    
    // Hide search view
    if (searchView) {
        searchView.classList.remove('active');
        searchView.style.display = 'none';
    }
    
    // Update navigation buttons
    if (homeBtn) homeBtn.classList.add('active');
    if (searchBtn) searchBtn.classList.remove('active');
    
    // Re-render all content
    renderRecent();
    renderAlbums();
    renderMixes();
    renderPopular();
    renderArtists();
    renderLibrary();
    
    // Update filter counts and setup
    updateFilterCounts();
    setupFilterButtons();
    
    // Setup search input
    setTimeout(setupSearchInput, 100);
    
    console.log('✓ Returned to home view');
};

console.log('✓ Improved back button fix applied');

// ────────────────────────────────────────────────
// TRANSFER DATA BETWEEN DEVICES (Copy + Paste JSON)
// Paste this at the VERY END of script.js
// ────────────────────────────────────────────────

window.transferDataViaClipboard = function() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 580px; width: 95%;">
            <h3 style="margin-bottom: 20px;">📲 Transfer Data Between Devices</h3>
            <p style="color: var(--muted); margin-bottom: 24px; line-height: 1.5;">
                Copy your data from one device and paste it here on another.<br>
                <strong>Data will be merged</strong> — existing playlists/albums/stats will be kept and new items added.
            </p>

            <div style="margin: 24px 0;">
                <button class="link-option-btn" onclick="copyAllDataToClipboard()" style="
                    width: 100%; padding: 16px; font-size: 16px; font-weight: 600;
                    background: linear-gradient(135deg, #4facfe, #00f2fe);
                    color: white; border: none; border-radius: 12px;
                    cursor: pointer; margin-bottom: 16px;
                ">
                    📋 Copy ALL my data to clipboard
                </button>

                <textarea id="pasteDataTextarea" placeholder="Paste the copied JSON here..." style="
                    width: 100%; min-height: 140px; padding: 16px;
                    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
                    border-radius: 12px; color: white; font-family: monospace;
                    font-size: 13px; resize: vertical; margin-bottom: 16px;
                "></textarea>

                <button onclick="mergePastedData()" style="
                    width: 100%; padding: 16px; font-size: 16px; font-weight: 700;
                    background: var(--accent); color: #000; border: none;
                    border-radius: 12px; cursor: pointer;
                ">
                    ➤ Merge this data into my library
                </button>
            </div>

            <div class="modal-buttons" style="margin-top: 28px;">
                <button class="secondary" onclick="this.closest('.modal').remove()">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
};

function copyAllDataToClipboard() {
    const exportData = {
        version: '2.0-transfer',
        timestamp: new Date().toISOString(),
        playlists,
        recent,
        savedAlbums,
        listeningStats,
        queue
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    navigator.clipboard.writeText(jsonString).then(() => {
        showNotification("✅ All data copied to clipboard! Paste it on the other device.");
    }).catch(err => {
        showNotification("❌ Could not copy — try manually selecting the text below");
        console.error(err);
    });
}

function mergePastedData() {
    const textarea = document.getElementById('pasteDataTextarea');
    if (!textarea || !textarea.value.trim()) {
        showNotification("Please paste some data first");
        return;
    }

    try {
        const incoming = JSON.parse(textarea.value.trim());

        if (!incoming.version || !incoming.version.startsWith('2.0')) {
            showNotification("❌ Invalid or old format — make sure you're pasting recent data");
            return;
        }

        let mergedCount = 0;

        // ── Playlists ───────────────────────────────────────
        if (incoming.playlists) {
            Object.entries(incoming.playlists).forEach(([name, data]) => {
                if (name === "Liked Songs") {
                    // Merge liked songs (deduplicate by id)
                    const existingIds = new Set(playlists["Liked Songs"]?.songs?.map(s => s.id) || []);
                    const newLikes = (data.songs || []).filter(s => !existingIds.has(s.id));
                    if (newLikes.length > 0) {
                        playlists["Liked Songs"].songs.push(...newLikes);
                        mergedCount += newLikes.length;
                    }
                } else if (!playlists[name]) {
                    // New playlist → add completely
                    playlists[name] = { ...data };
                    mergedCount += (data.songs?.length || 0);
                } else {
                    // Existing playlist → add missing songs
                    const existingIds = new Set(playlists[name].songs.map(s => s.id));
                    const newSongs = (data.songs || []).filter(s => !existingIds.has(s.id));
                    if (newSongs.length > 0) {
                        playlists[name].songs.push(...newSongs);
                        mergedCount += newSongs.length;
                    }
                }
            });
        }

        // ── Recent ──────────────────────────────────────────
        if (incoming.recent && Array.isArray(incoming.recent)) {
            const existingRecentIds = new Set(recent.map(s => s.id));
            const newRecent = incoming.recent.filter(s => !existingRecentIds.has(s.id));
            if (newRecent.length > 0) {
                recent.unshift(...newRecent);
                recent = recent.slice(0, 20); // keep reasonable limit
                mergedCount += newRecent.length;
            }
        }

        // ── Saved Albums ────────────────────────────────────
        if (incoming.savedAlbums) {
            Object.entries(incoming.savedAlbums).forEach(([id, album]) => {
                if (!savedAlbums[id]) {
                    savedAlbums[id] = { ...album };
                    mergedCount += 1;
                }
            });
        }

        // ── Queue ───────────────────────────────────────────
        if (incoming.queue && Array.isArray(incoming.queue)) {
            const existingQueueIds = new Set(queue.map(s => s.id));
            const newQueueItems = incoming.queue.filter(s => !existingQueueIds.has(s.id));
            if (newQueueItems.length > 0) {
                queue.push(...newQueueItems);
                mergedCount += newQueueItems.length;
            }
        }

        // ── Listening Stats ─────────────────────────────────
        if (incoming.listeningStats) {
            listeningStats.songsPlayed = Math.max(
                listeningStats.songsPlayed || 0,
                incoming.listeningStats.songsPlayed || 0
            );
            listeningStats.totalMinutes = Math.max(
                listeningStats.totalMinutes || 0,
                incoming.listeningStats.totalMinutes || 0
            );
        }

        // Save everything
        save('playlists', playlists);
        save('recent', recent);
        save('indy_saved_albums', savedAlbums);
        save('queue', queue);
        save('listening_stats', listeningStats);

        showNotification(`🎉 Merged ${mergedCount} new items! Refreshing...`);
        setTimeout(() => location.reload(), 1400);

    } catch (err) {
        showNotification("❌ Invalid JSON — check formatting");
        console.error(err);
    }
}

// Fallback: Try with just the track name (sometimes artist name causes issues)
async function fetchLyricsFallback(song) {
    if (!song || !song.title) return null;
    
    const cleanTitle = await getCleanSongTitle(song.id, song.title);
    const cacheKey = `fallback_${song.id}`;
    
    if (lyricsCache[cacheKey]) return lyricsCache[cacheKey];
    
    try {
        // Try with just the track name
        const url = `${LRCLIB_API_BASE}/search?track_name=${encodeURIComponent(cleanTitle)}`;
        const response = await fetch(url);
        
        if (!response.ok) return null;
        
        const results = await response.json();
        
        if (!results || results.length === 0) return null;
        
        // Filter results that might match the artist
        const matchingResults = results.filter(r => 
            r.artistName.toLowerCase().includes(song.artist.toLowerCase()) ||
            song.artist.toLowerCase().includes(r.artistName.toLowerCase())
        );
        
        const bestMatch = matchingResults[0] || results[0];
        
        const lyricsResponse = await fetch(`${LRCLIB_API_BASE}/get?id=${bestMatch.id}`);
        const lyricsData = await lyricsResponse.json();
        
        lyricsCache[cacheKey] = lyricsData;
        return lyricsData;
        
    } catch (error) {
        console.error("Fallback lyrics fetch error:", error);
        return null;
    }
}
// Check if current song is from queue
function isPlayingFromQueue() {
    return queue.length > 0 && 
           currentPlayingSong && 
           queue.some(s => s.id === currentPlayingSong.id);
}
