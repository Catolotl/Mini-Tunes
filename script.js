// ========================================
// INDY MUSIC PLAYER - SOUNDCLOUD EDITION
// ========================================

// ────────────────────────────────────────
// CONFIGURATION & CONSTANTS
// ────────────────────────────────────────
const GROQ_API_KEY = "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";
const SC_CLIENT_ID = 'iycHGVy3rFNzH4on4nXXEp20PzwDGlZR';
const SC_CLIENT_SECRET = '6HuXB4Z8q0YLoNhm6ZA8gQrtKMkUrO3n';
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
let scWidget = null;        // SoundCloud Widget API instance
let scPlayerReady = false;  // SoundCloud player ready flag
let searchTimeout = null;
let lastPlayedTrackId = null;
let playerReady = false;
let pendingTrack = null;    // Pending SC track URL to play
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
    return SC_CLIENT_ID; // kept for any legacy references
}

// ── SOUNDCLOUD SEARCH ─────────────────────────
async function searchSoundCloud(query, limit = 10) {
    const url = `https://api.soundcloud.com/tracks?q=${encodeURIComponent(query)}&client_id=${SC_CLIENT_ID}&limit=${limit}&linked_partitioning=1`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`SC API ${res.status}`);
        const data = await res.json();
        const tracks = data.collection || data;
        return tracks.map(t => ({
            id: `sc_${t.id}`,
            scId: t.id,
            scStreamUrl: t.stream_url || null,
            scPermalinkUrl: t.permalink_url,
            title: t.title,
            artist: t.user?.username || 'Unknown',
            art: (t.artwork_url || '').replace('-large', '-t500x500') || '',
            album: '',
            duration: Math.round((t.duration || 0) / 1000),
            _isSoundCloud: true
        }));
    } catch (err) {
        console.error('SoundCloud search failed:', err);
        return [];
    }
}

async function searchSoundCloudAlbums(query, limit = 6) {
    // SC doesn't have an albums endpoint; search playlists as proxy
    const url = `https://api.soundcloud.com/playlists?q=${encodeURIComponent(query)}&client_id=${SC_CLIENT_ID}&limit=${limit}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        const playlists = data.collection || data;
        return playlists.map(p => ({
            deezerAlbumId: null,
            scPlaylistId: p.id,
            title: p.title,
            artist: p.user?.username || 'Unknown',
            art: (p.artwork_url || '').replace('-large', '-t500x500') || '',
            _isSCPlaylist: true
        }));
    } catch (err) {
        return [];
    }
}

// ── DEEZER SEARCH (free, no key needed) ──────
async function searchDeezer(query, type = 'track', limit = 10) {
    const endpoint = type === 'album'
        ? `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=${limit}&output=jsonp`
        : `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}&output=jsonp`;

    // Deezer blocks CORS on direct fetch, use a proxy
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(
        type === 'album'
            ? `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=${limit}`
            : `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`
    )}`;

    const res = await fetch(proxyUrl);
    const data = await res.json();

    if (!data.data) return [];

    if (type === 'album') {
        return data.data.map(item => ({
            deezerAlbumId: item.id,
            title: item.title,
            artist: item.artist?.name || 'Unknown',
            art: item.cover_medium || item.cover || '',
            youtubeId: null,
            _isDeezer: true
        }));
    }

    return data.data.map(item => ({
        id: `dz_${item.id}`,           // placeholder until YouTube resolved
        deezerTrackId: item.id,
        title: item.title,
        artist: item.artist?.name || 'Unknown',
        art: item.album?.cover_medium || '',
        album: item.album?.title || '',
        duration: item.duration,
        youtubeId: null,
        _isDeezer: true
    }));
}

const scTrackCache = new Map();

async function resolveSoundCloudTrack(song) {
    // Already resolved
    if (song.scId && song.scPermalinkUrl) return song.scPermalinkUrl;
    if (song._isSoundCloud && song.scPermalinkUrl) return song.scPermalinkUrl;

    const cacheKey = `sc_${song.deezerTrackId || song.title + song.artist}`;
    if (scTrackCache.has(cacheKey)) return scTrackCache.get(cacheKey);

    const query = `${song.title} ${song.artist}`;
    try {
        const tracks = await searchSoundCloud(query, 1);
        if (tracks.length > 0) {
            const track = tracks[0];
            scTrackCache.set(cacheKey, track.scPermalinkUrl);
            // Copy SC data onto song
            song.scId = track.scId;
            song.scPermalinkUrl = track.scPermalinkUrl;
            song.id = track.id;
            if (!song.art && track.art) song.art = track.art;
            return track.scPermalinkUrl;
        }
        return null;
    } catch (err) {
        console.error('SC resolve failed:', err);
        return null;
    }
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
// SOUNDCLOUD URL EXTRACTION
// ────────────────────────────────────────

function extractSoundCloudUrl(input) {
    if (!input) return null;
    input = input.trim();
    // Direct SC URL
    if (/soundcloud\.com\/.+\/.+/.test(input)) return input;
    return null;
}

// Legacy YouTube extractor kept for any stored video IDs
function extractYouTubeVideoId(input) {
    if (!input) return null;
    return null; // YouTube disabled — always return null
}


async function fetchSCTrackDetails(scId, song) {
    if (!scId) return;
    const cached = getCachedMetadata(`sc_${scId}`);
    if (cached) {
        applyMetadata(`sc_${scId}`, song, cached.title, cached.artist);
        return;
    }
    try {
        const res = await fetch(`https://api.soundcloud.com/tracks/${scId}?client_id=${SC_CLIENT_ID}`);
        if (!res.ok) throw new Error(`SC API ${res.status}`);
        const data = await res.json();
        const title = data.title || song.title;
        const artist = data.user?.username || song.artist;
        const art = (data.artwork_url || '').replace('-large', '-t500x500') || song.art;
        saveMetadataToCache(`sc_${scId}`, title, artist);
        applyMetadata(`sc_${scId}`, song, title, artist);
        if (art && song) song.art = art;
    } catch (err) {
        console.warn('SC metadata fetch failed:', err);
    }
}

// Alias for legacy calls
const fetchVideoDetails = fetchSCTrackDetails;

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
    queue = load('queue', []); // Make sure this line exists
    savedAlbums = load('indy_saved_albums', {});
    listeningStats = load('listening_stats', {
        songsPlayed: 0,
        totalMinutes: 0,
        lastUpdated: Date.now()
    });

    // Initialize queue index from saved state
    const savedQueueIndex = load('queue_index', 0);
    queueIndex = savedQueueIndex;

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

    // Setup SoundCloud Widget API
    initSoundCloudWidget();

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
// SOUNDCLOUD WIDGET SETUP
// ────────────────────────────────────────

function initSoundCloudWidget() {
    const iframe = document.getElementById('scWidget');
    if (!iframe || typeof SC === 'undefined') {
        // SC Widget API not loaded yet, retry
        setTimeout(initSoundCloudWidget, 500);
        return;
    }

    scWidget = SC.Widget(iframe);

    scWidget.bind(SC.Widget.Events.READY, () => {
        console.log('SoundCloud Widget ready');
        scPlayerReady = true;
        playerReady = true;
        if (pendingTrack) {
            playScTrack(pendingTrack);
            pendingTrack = null;
        }
    });

    scWidget.bind(SC.Widget.Events.FINISH, () => {
        console.log('SC track finished');
        if (repeatMode === 'one') {
            setTimeout(() => playSong(currentPlayingSong), 100);
        } else {
            setTimeout(() => handleNextSong(), 100);
        }
    });

    scWidget.bind(SC.Widget.Events.ERROR, (e) => {
        console.error('SC Widget error:', e);
        showVideoError();
    });
}

function playScTrack(permalinkUrl) {
    if (!scWidget || !scPlayerReady) {
        pendingTrack = permalinkUrl;
        return;
    }
    try {
        scWidget.load(permalinkUrl, {
            auto_play: true,
            hide_related: true,
            show_comments: false,
            show_user: false,
            show_reposts: false,
            show_teaser: false,
            visual: false
        });
        console.log('SC Widget loading:', permalinkUrl);
    } catch (err) {
        console.error('SC load error:', err);
        showVideoError();
    }
}

// Expose play/pause/seek for any controls that might use ytPlayer API
const ytPlayer = {
    playVideo: () => scWidget?.play(),
    pauseVideo: () => scWidget?.pause(),
    stopVideo: () => scWidget?.pause(),
    loadVideoById: () => {}, // no-op
    getCurrentTime: () => new Promise(res => scWidget?.getPosition(pos => res((pos || 0) / 1000))),
    seekTo: (secs) => scWidget?.seekTo(secs * 1000)
};

// Add this new function
function handleNextSong() {
    // Check if we're playing from queue
    if (queue.length > 0) {
        // Check if current song is in queue
        const currentInQueue = currentPlayingSong && queue.some(s => s.id === currentPlayingSong.id);
        
        if (currentInQueue) {
            // Find current song's position in queue
            const currentQueuePos = queue.findIndex(s => s.id === currentPlayingSong.id);
            
            if (currentQueuePos !== -1 && currentQueuePos < queue.length - 1) {
                // Play next song in queue
                console.log("Playing next song in queue");
                queueIndex = currentQueuePos + 1;
                playSong(queue[queueIndex]);
                return;
            } else if (repeatMode === 'all' && queue.length > 0) {
                // Loop back to start of queue
                console.log("Looping queue back to start");
                queueIndex = 0;
                playSong(queue[0]);
                return;
            } else {
                // End of queue reached
                console.log("End of queue reached");
                if (queue.length > 0) {
                    showNotification("End of queue");
                }
            }
        }
    }
    
    // If not in queue mode or queue ended, handle regular playlist/single mode
    if (shuffleMode && currentSongs.length > 1) {
        // Pick random song (not current)
        let newIndex;
        do {
            newIndex = Math.floor(Math.random() * currentSongs.length);
        } while (newIndex === currentIndex && currentSongs.length > 1);
        
        console.log("Shuffle mode - playing random song");
        currentIndex = newIndex;
        playSong(currentSongs[currentIndex]);
        return;
    }
    
    // Regular sequential playback
    if (currentIndex < currentSongs.length - 1) {
        console.log("Playing next song in playlist");
        currentIndex++;
        playSong(currentSongs[currentIndex]);
    } else if (repeatMode === 'all' && currentSongs.length > 0) {
        console.log("Repeat all - looping to start");
        currentIndex = 0;
        playSong(currentSongs[currentIndex]);
    } else {
        console.log("No more songs to play");
        // No more songs to play
        if (currentPlayingSong) {
            showNotification("End of playlist/queue");
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
        
        // Start synced lyrics if available
        if (lyricsData.syncedLyrics) {
            setupLyricsSync();
        }
    } else {
        lyricsContainer.innerHTML = '<div class="lyrics-placeholder">No lyrics found</div>';
    }
    
    // Reinitialize fullscreen button (IMPORTANT!)
    setupFullscreenLyrics();
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

// Set up lyrics sync interval using SoundCloud position
function setupLyricsSync() {
    if (window.lyricsInterval) clearInterval(window.lyricsInterval);
    
    window.lyricsInterval = setInterval(() => {
        if (scWidget && scPlayerReady && document.querySelector('.synced-lyrics')) {
            scWidget.getPosition(pos => {
                const currentTime = (pos || 0) / 1000;
                highlightLyricLine(currentTime);
            });
        }
    }, 500);
}


// ────────────────────────────────────────
// PLAYBACK FUNCTIONS
// ────────────────────────────────────────

async function playSong(song, fromPlaylist = null) {
    if (!song) {
        console.error("Invalid song object", song);
        return;
    }

    // Resolve SoundCloud track URL for Deezer songs
    if (song._isDeezer && !song.scPermalinkUrl) {
        showNotification("Finding track on SoundCloud...");
        const scUrl = await resolveSoundCloudTrack(song);
        if (!scUrl) {
            showNotification("Couldn't find this track on SoundCloud");
            return;
        }
    }

    // Also resolve if it's just a plain song with no SC data
    if (!song._isSoundCloud && !song.scPermalinkUrl && song.title && song.artist) {
        showNotification("Finding track...");
        await resolveSoundCloudTrack(song);
    }

    if (!song.scPermalinkUrl && !song._isSoundCloud) {
        showNotification("Track not available");
        return;
    }

    const trackKey = song.scId || song.scPermalinkUrl || song.id;
    if (lastPlayedTrackId === trackKey) {
        console.log("Already playing this track — skipping duplicate call");
        return;
    }

    lastPlayedTrackId = trackKey;
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
    // UPDATE THIS SECTION - Fix queue detection logic
    // Check if we're playing from queue
    const queueIdx = queue.findIndex(s => s.id === song.id);
    if (queueIdx !== -1) {
        // This song is in queue, set queue as current source
        queueIndex = queueIdx;
        currentSongs = [...queue];
        currentIndex = queueIdx;
        currentPlaylist = null;
        fromPlaylist = 'queue'; // Mark as queue playback
    } else if (fromPlaylist && fromPlaylist !== 'queue') {
        currentPlaylist = fromPlaylist;
        currentSongs = playlists[fromPlaylist]?.songs || [];
        currentIndex = currentSongs.findIndex(s => s.id === song.id);
        if (currentIndex === -1) currentIndex = 0;
    } else {
        // Not from playlist or queue
        const idx = currentSongs.findIndex(s => s.id === song.id);
        if (idx !== -1) currentIndex = idx;
    }
    }

    // Inside playSong function, after setting queueIndex if playing from queue
if (fromPlaylist === 'queue' || queue.some(s => s.id === song.id)) {
    save('queue_index', queueIndex);
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

    // Update album art display
    const artImg = document.getElementById('nowPlayingArt');
    const artPlaceholder = document.getElementById('npArtPlaceholder');
    if (artImg) {
        if (song.art) {
            artImg.src = song.art;
            artImg.style.opacity = '1';
            if (artPlaceholder) artPlaceholder.style.display = 'none';
        } else {
            artImg.style.opacity = '0';
            if (artPlaceholder) artPlaceholder.style.display = 'flex';
        }
    }

    // Load and play SoundCloud track
    const permalinkUrl = song.scPermalinkUrl;
    if (permalinkUrl) {
        if (scPlayerReady && scWidget) {
            try {
                playScTrack(permalinkUrl);
                console.log(`Playing "${cleanTitle}" via SoundCloud`);
            } catch (err) {
                console.error("SC playback failed:", err);
                pendingTrack = permalinkUrl;
            }
        } else {
            pendingTrack = permalinkUrl;
            console.log(`SC not ready, queued "${cleanTitle}"`);
        }
    } else {
        console.warn('No SoundCloud URL for track:', song.title);
        showVideoError();
    }

    // Fetch lyrics for the new song
    setTimeout(() => {
        if (song && song.title) {
            updateLyrics(song);
        }
    }, 1000);
}

function skipToNext() {
    console.log("Skip to next called");
    
    if (repeatMode === 'one' && currentPlayingSong) {
        // Replay current song
        console.log("Repeat one - replaying current");
        playSong(currentPlayingSong);
        return;
    }
    
    // Check if we're playing from queue
    const currentInQueue = currentPlayingSong && queue.some(s => s.id === currentPlayingSong.id);
    
    if (currentInQueue) {
        // Find current song's position in queue
        const currentQueuePos = queue.findIndex(s => s.id === currentPlayingSong.id);
        
        if (currentQueuePos !== -1 && currentQueuePos < queue.length - 1) {
            // Play next song in queue
            console.log("Skip to next in queue");
            queueIndex = currentQueuePos + 1;
            playSong(queue[queueIndex]);
            return;
        } else if (repeatMode === 'all' && queue.length > 0) {
            // Loop back to start of queue
            console.log("Skip to next - looping queue");
            queueIndex = 0;
            playSong(queue[0]);
            return;
        }
    }
    
    // Not in queue mode or at end of queue, handle playlist or single song
    if (shuffleMode && currentSongs.length > 1) {
        // Pick random song (not current)
        let newIndex;
        do {
            newIndex = Math.floor(Math.random() * currentSongs.length);
        } while (newIndex === currentIndex && currentSongs.length > 1);
        
        console.log("Skip to next - shuffle mode");
        currentIndex = newIndex;
        playSong(currentSongs[currentIndex]);
        return;
    }
    
    if (currentIndex < currentSongs.length - 1) {
        console.log("Skip to next in playlist");
        currentIndex++;
        playSong(currentSongs[currentIndex]);
    } else if (repeatMode === 'all' && currentSongs.length > 0) {
        console.log("Skip to next - repeat all");
        currentIndex = 0;
        playSong(currentSongs[currentIndex]);
    } else {
        console.log("Skip to next - no more songs");
        showNotification("No more songs in queue/playlist");
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
    
    const popularQueries = [
        'pop hits', 'hip hop', 'indie', 'r&b soul', 'electronic', 'chill'
    ];
    
    const randomQuery = popularQueries[Math.floor(Math.random() * popularQueries.length)];
    
    try {
        const tracks = await searchDeezer(randomQuery, 'track', 8);
        container.innerHTML = '';
        
        if (tracks.length > 0) {
            tracks.forEach(song => {
                const div = document.createElement('div');
                div.className = 'album-card';
                div.innerHTML = `
                    <img src="${song.art}" alt="">
                    <div class="album-title">${escapeHtml(song.title)}</div>
                    <div class="album-artist">${escapeHtml(song.artist)}</div>
                `;
                div.onclick = () => playSong(song);
                container.appendChild(div);
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
            const scUrl = extractSoundCloudUrl(value);

if (scUrl) {
    e.target.value = '';
    showNotification("Loading SoundCloud track...");
    const song = {
        id: 'sc_paste',
        scPermalinkUrl: scUrl,
        title: "SoundCloud Track",
        artist: "SoundCloud",
        art: '',
        _isSoundCloud: true
    };
    playSong(song);
    showNotification("Playing SoundCloud track!");
} else if (value.length >= 3) {
                try {
                    const [tracks, albums] = await Promise.all([
                        searchDeezer(value, 'track', 10),
                        searchDeezer(value, 'album', 6)
                    ]);
                    renderDeezerSearchResults(tracks, albums);
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
            const scUrl = extractSoundCloudUrl(value);

if (scUrl) {
    e.target.value = '';
    showNotification("Loading SoundCloud track...");
    const song = {
        id: 'sc_paste',
        scPermalinkUrl: scUrl,
        title: "SoundCloud Track",
        artist: "SoundCloud",
        art: '',
        _isSoundCloud: true
    };
    playSong(song);
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
            searchDeezer(artist, 'album', 2)
        );
        
        const results = await Promise.all(albumPromises);
        const albums = results.flat().slice(0, 6);
        
        container.innerHTML = '';
        
        if (albums.length === 0) {
            container.innerHTML = '<div style="padding:20px;color:var(--muted);">No albums found</div>';
            return;
        }
        
        albums.forEach(album => {
            const div = document.createElement('div');
            div.className = 'album-card';
            div.innerHTML = `
                <img src="${album.art}" alt="">
                <div class="album-title">${escapeHtml(album.title)}</div>
                <div class="album-artist">${escapeHtml(album.artist)}</div>
            `;
            div.onclick = () => playDeezerAlbum(album.deezerAlbumId, album.title, album.art);
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
    
    // Extract unique artists from search results
    const artistsMap = new Map();
    if (videos.items) {
        videos.items.forEach(item => {
            const artistName = item.snippet.channelTitle;
            if (!artistsMap.has(artistName)) {
                artistsMap.set(artistName, {
                    name: artistName,
                    channelId: item.snippet.channelId,
                    thumbnail: item.snippet.thumbnails.default.url
                });
            }
        });
    }
    
    // Artists Section
    if (artistsMap.size > 0) {
        const artistSection = document.createElement('div');
        artistSection.className = 'section';
        artistSection.innerHTML = `
            <div class="section-header"><h2>Artists</h2></div>
            <div class="scroll-container" id="searchArtistsScroll"></div>
        `;
        
        const scrollContainer = artistSection.querySelector('.scroll-container');
        const artistsArray = Array.from(artistsMap.values()).slice(0, 8);
        
        artistsArray.forEach(artist => {
            const artistId = artist.name.replace(/\W/g, '_');
            const isInLibrary = savedArtists[artistId];
            
            const div = document.createElement('div');
            div.className = 'search-artist-card';
            div.innerHTML = `
                <div class="search-artist-image-container">
                    <img src="${artist.thumbnail}" alt="${escapeHtml(artist.name)}" class="search-artist-image">
                    ${isInLibrary ? '<div class="in-library-badge">✓</div>' : ''}
                </div>
                <div class="search-artist-name">${escapeHtml(artist.name)}</div>
                <div class="search-artist-type">Artist</div>
                <button class="search-artist-btn" onclick="event.stopPropagation(); ${isInLibrary ? `viewArtistProfile('${artistId}')` : `saveArtistToLibrary('${escapeHtml(artist.name)}', '${artist.channelId}')`}">
                    ${isInLibrary ? 'View Profile' : '+ Follow'}
                </button>
            `;
            
            div.onclick = () => {
                if (isInLibrary) {
                    viewArtistProfile(artistId);
                } else {
                    showArtistQuickMenu(artist.name);
                }
            };
            
            if (scrollContainer) scrollContainer.appendChild(div);
        });
        
        container.appendChild(artistSection);
    }
    
    // Albums Section
    if (playlists.items && playlists.items.length > 0) {
        const albumSection = document.createElement('div');
        albumSection.className = 'section';
        albumSection.innerHTML = `
            <div class="section-header"><h2>Albums & Playlists</h2></div>
            <div class="scroll-container" id="searchAlbumsScroll"></div>
        `;
        
        const scrollContainer = albumSection.querySelector('.scroll-container');
        playlists.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-album-card';
            div.innerHTML = `
                <img src="${item.snippet.thumbnails.medium.url}" alt="">
                <div class="search-card-title">${escapeHtml(item.snippet.title)}</div>
                <div class="search-card-artist">${escapeHtml(item.snippet.channelTitle)}</div>
                <button class="search-card-play-btn" onclick="event.stopPropagation(); playPlaylist('${item.id.playlistId}', true)">
                    ▶ Play
                </button>
            `;
            div.onclick = () => playPlaylist(item.id.playlistId, true);
            if (scrollContainer) scrollContainer.appendChild(div);
        });
        
        container.appendChild(albumSection);
    }
    
    // Songs Section
    if (videos.items && videos.items.length > 0) {
        const songSection = document.createElement('div');
        songSection.className = 'section';
        songSection.innerHTML = `
            <div class="section-header"><h2>Songs</h2></div>
            <div class="scroll-container" id="searchSongsScroll"></div>
        `;
        
        const scrollContainer = songSection.querySelector('.scroll-container');

        videos.items.forEach(item => {
            const song = {
                id: item.id.videoId,
                title: item.snippet.title,
                artist: item.snippet.channelTitle,
                art: item.snippet.thumbnails.medium.url
            };

            const div = document.createElement('div');
            div.className = 'search-song-card';
            div.setAttribute('data-song', JSON.stringify(song));
            div.innerHTML = `
                <img src="${song.art}" alt="" class="search-song-image">
                <div class="search-song-info">
                    <div class="search-song-title loading">${escapeHtml(song.title)}</div>
                    <div class="search-song-artist clickable-artist" onclick="event.stopPropagation(); showArtistQuickMenu('${escapeHtml(song.artist)}')">${escapeHtml(song.artist)}</div>
                </div>
                <div class="search-song-actions">
                    <button class="search-action-btn play-btn" onclick="event.stopPropagation(); playSong(${JSON.stringify(song).replace(/"/g, '&quot;')})" title="Play">
                        ▶
                    </button>
                    <button class="search-action-btn" onclick="event.stopPropagation(); addToQueue(${JSON.stringify(song).replace(/"/g, '&quot;')})" title="Add to Queue">
                        +
                    </button>
                    <button class="search-action-btn" onclick="event.stopPropagation(); showAddToPlaylistMenu(${JSON.stringify(song).replace(/"/g, '&quot;')})" title="Add to Playlist">
                        📝
                    </button>
                    <button class="search-action-btn ${isLiked(song.id) ? 'liked' : ''}" onclick="event.stopPropagation(); toggleLike(${JSON.stringify(song).replace(/"/g, '&quot;')})" title="Like">
                        ❤️
                    </button>
                </div>
            `;
            
            div.onclick = () => playSong(song);
            
            // Add context menu
            div.addEventListener('contextmenu', (e) => {
                showContextMenu(e, song);
            });
            
            if (scrollContainer) scrollContainer.appendChild(div);

            getCleanSongTitle(song.id, song.title).then(clean => {
                const titleEl = div.querySelector('.search-song-title');
                if (titleEl) {
                    titleEl.textContent = clean;
                    titleEl.classList.remove('loading');
                }
            });
        });

        container.appendChild(songSection);
    }
    
    // Radio Section (no API - uses recent songs as seed)
    if (recent.length > 0) {
        const radioSection = document.createElement('div');
        radioSection.className = 'section';
        radioSection.innerHTML = `
            <div class="section-header"><h2>🎙️ Suggested Radio Stations</h2></div>
            <div class="scroll-container" id="searchRadioScroll"></div>
        `;
        
        const scrollContainer = radioSection.querySelector('.scroll-container');
        
        // Create radio stations from recent artists (no API needed)
        const recentArtists = [...new Set(recent.map(s => s.artist).filter(Boolean))].slice(0, 6);
        
        recentArtists.forEach(artistName => {
            const div = document.createElement('div');
            div.className = 'search-radio-card';
            
            const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            div.innerHTML = `
                <div class="search-radio-icon" style="background: linear-gradient(135deg, ${randomColor}, ${randomColor}88);">
                    📻
                </div>
                <div class="search-card-title">${escapeHtml(artistName)} Radio</div>
                <div class="search-card-artist">Based on your listening</div>
                <button class="search-card-play-btn" onclick="event.stopPropagation(); playArtistMix('${escapeHtml(artistName)}')">
                    ▶ Play
                </button>
            `;
            
            div.onclick = () => playArtistMix(artistName);
            if (scrollContainer) scrollContainer.appendChild(div);
        });
        
        container.appendChild(radioSection);
    }
}

function renderDeezerSearchResults(tracks, albums) {
    const container = document.getElementById('searchResults');
    if (!container) return;
    container.innerHTML = '';

    // Extract artists from tracks
    const artistsMap = new Map();
    tracks.forEach(t => {
        if (t.artist && !artistsMap.has(t.artist)) {
            artistsMap.set(t.artist, { name: t.artist, thumbnail: t.art });
        }
    });

    // Artists section
    if (artistsMap.size > 0) {
        const artistSection = document.createElement('div');
        artistSection.className = 'section';
        artistSection.innerHTML = `<div class="section-header"><h2>Artists</h2></div><div class="scroll-container" id="searchArtistsScroll"></div>`;
        const scroll = artistSection.querySelector('.scroll-container');
        [...artistsMap.values()].slice(0, 6).forEach(artist => {
            const artistId = artist.name.replace(/\W/g, '_');
            const div = document.createElement('div');
            div.className = 'search-artist-card';
            div.innerHTML = `
                <div class="search-artist-image-container">
                    <img src="${artist.thumbnail}" alt="${escapeHtml(artist.name)}" class="search-artist-image">
                </div>
                <div class="search-artist-name">${escapeHtml(artist.name)}</div>
                <div class="search-artist-type">Artist</div>
                <button class="search-artist-btn" onclick="event.stopPropagation(); showArtistQuickMenu('${escapeHtml(artist.name)}')">
                    + Follow
                </button>
            `;
            div.onclick = () => showArtistQuickMenu(artist.name);
            scroll.appendChild(div);
        });
        container.appendChild(artistSection);
    }

    // Albums section
    if (albums.length > 0) {
        const albumSection = document.createElement('div');
        albumSection.className = 'section';
        albumSection.innerHTML = `<div class="section-header"><h2>Albums & Playlists</h2></div><div class="scroll-container" id="searchAlbumsScroll"></div>`;
        const scroll = albumSection.querySelector('.scroll-container');
        albums.forEach(album => {
            const div = document.createElement('div');
            div.className = 'search-album-card';
            div.innerHTML = `
                <img src="${album.art}" alt="">
                <div class="search-card-title">${escapeHtml(album.title)}</div>
                <div class="search-card-artist">${escapeHtml(album.artist)}</div>
                <button class="search-card-play-btn" onclick="event.stopPropagation(); playDeezerAlbum(${album.deezerAlbumId}, '${escapeHtml(album.title)}', '${escapeHtml(album.art)}')">
                    ▶ Play
                </button>
            `;
            div.onclick = () => playDeezerAlbum(album.deezerAlbumId, album.title, album.art);
            scroll.appendChild(div);
        });
        container.appendChild(albumSection);
    }

    // Songs section
    if (tracks.length > 0) {
        const songSection = document.createElement('div');
        songSection.className = 'section';
        songSection.innerHTML = `<div class="section-header"><h2>Songs</h2></div><div class="scroll-container" id="searchSongsScroll"></div>`;
        const scroll = songSection.querySelector('.scroll-container');
        tracks.forEach(song => {
            const safeJson = JSON.stringify(song).replace(/"/g, '&quot;');
            const div = document.createElement('div');
            div.className = 'search-song-card';
            div.innerHTML = `
                <img src="${song.art}" alt="" class="search-song-image">
                <div class="search-song-info">
                    <div class="search-song-title">${escapeHtml(song.title)}</div>
                    <div class="search-song-artist">${escapeHtml(song.artist)}</div>
                </div>
                <div class="search-song-actions">
                    <button class="search-action-btn play-btn" onclick="event.stopPropagation(); playSong(${safeJson})" title="Play">▶</button>
                    <button class="search-action-btn" onclick="event.stopPropagation(); addToQueue(${safeJson})" title="Add to Queue">+</button>
                    <button class="search-action-btn" onclick="event.stopPropagation(); showAddToPlaylistMenu(${safeJson})" title="Add to Playlist">📝</button>
                    <button class="search-action-btn" onclick="event.stopPropagation(); toggleLike(${safeJson})" title="Like">❤️</button>
                </div>
            `;
            div.onclick = () => playSong(song);
            scroll.appendChild(div);
        });
        container.appendChild(songSection);
    }
}

async function playDeezerAlbum(deezerAlbumId, albumName, albumArt) {
    showNotification('Loading album...');
    try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(`https://api.deezer.com/album/${deezerAlbumId}/tracks`)}`;
        const res = await fetch(proxyUrl);
        const data = await res.json();
        if (!data.data || data.data.length === 0) { showNotification('No tracks found'); return; }
        const songs = data.data.map(track => ({
            id: `dz_${track.id}`,
            deezerTrackId: track.id,
            title: track.title,
            artist: track.artist?.name || 'Unknown',
            art: albumArt,
            youtubeId: null,
            _isDeezer: true
        }));
        currentSongs = songs;
        currentIndex = 0;
        showAlbumView(songs, albumName);
    } catch (err) {
        console.error('Deezer album error:', err);
        showNotification('Could not load album');
    }
}

window.playDeezerAlbum = playDeezerAlbum;
window.renderDeezerSearchResults = renderDeezerSearchResults;

// Helper function for artist mix (uses cached data, no API)
function playArtistMix(artistName) {
    const artistSongs = recent.filter(s => s.artist === artistName);
    
    if (artistSongs.length === 0) {
        showNotification("No songs found for this artist");
        return;
    }
    
    currentSongs = [...artistSongs];
    currentIndex = 0;
    currentPlaylist = null;
    
    playSong(currentSongs[0]);
    showNotification(`Playing ${artistName} Mix 📻`);
}

window.playArtistMix = playArtistMix; 

function renderPlaylists() {
    const container = document.getElementById('playlistsList');
    if (!container) return;
    container.innerHTML = '';

    // First, render regular playlists (excluding Liked Songs)
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

    // Then, render saved albums
    const albums = Object.values(savedAlbums);
    albums.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    
    albums.forEach(album => {
        const div = document.createElement('div');
        div.className = 'playlist-item album-playlist-item';
        div.innerHTML = `
            <img src="${album.cover}" class="playlist-album-cover" alt="">
            <div class="playlist-info">
                <div class="playlist-name">${escapeHtml(album.name)}</div>
                <div class="playlist-count">${album.songs?.length || 0} songs</div>
            </div>
        `;
        div.onclick = () => playAlbumFromLibrary(album);
        container.appendChild(div);
    });
}

// ────────────────────────────────────────
// PLAYLIST FUNCTIONS
// ────────────────────────────────────────

async function playPlaylist(playlistId, isAlbum = false) {
    // playlistId may be a Deezer album ID or SC playlist ID
    try {
        let songs = [];
        let albumName = 'Playlist';

        // Try Deezer album
        if (playlistId && !String(playlistId).startsWith('sc_')) {
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(`https://api.deezer.com/album/${playlistId}/tracks`)}`;
            const res = await fetch(proxyUrl);
            if (res.ok) {
                const data = await res.json();
                if (data.data?.length > 0) {
                    // Get album details for name
                    const albumRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(`https://api.deezer.com/album/${playlistId}`)}`);
                    const albumData = albumRes.ok ? await albumRes.json() : null;
                    albumName = albumData?.title || 'Album';
                    const albumArt = albumData?.cover_medium || '';

                    songs = data.data.map(track => ({
                        id: `dz_${track.id}`,
                        deezerTrackId: track.id,
                        title: track.title,
                        artist: track.artist?.name || albumData?.artist?.name || 'Unknown',
                        art: albumArt,
                        _isDeezer: true
                    }));
                }
            }
        }

        if (songs.length === 0) {
            showNotification("Couldn't load playlist tracks");
            return;
        }

        currentSongs = songs;
        currentIndex = 0;
        currentPlaylist = null;

        if (isAlbum) {
            showAlbumView(songs, albumName, playlistId);
        } else {
            playSong(currentSongs[0]);
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
    const query = `${seedSong.artist}`;
    try {
        const tracks = await searchDeezer(query, 'track', 15);
        return tracks;
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
    
    const url = currentPlayingSong.scPermalinkUrl || `https://soundcloud.com/search?q=${encodeURIComponent((currentPlayingSong.title || '') + ' ' + (currentPlayingSong.artist || ''))}`;
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
// FULLSCREEN LYRICS - IMPROVED
// ────────────────────────────────────────

function setupFullscreenLyrics() {
    // Remove any existing fullscreen overlay
    const existingOverlay = document.getElementById('fullscreenLyricsOverlay');
    if (existingOverlay) existingOverlay.remove();
    
    // Remove any existing fullscreen button
    const existingBtn = document.getElementById('fullscreenLyricsBtn');
    if (existingBtn) existingBtn.remove();
    
    const lyricsSection = document.querySelector('.lyrics-section');
    if (!lyricsSection) return;

    // Create fullscreen button
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.id = 'fullscreenLyricsBtn';
    fullscreenBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
    `;
    fullscreenBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        color: white;
        cursor: pointer;
        z-index: 10;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    `;
    
    fullscreenBtn.onmouseover = () => {
        fullscreenBtn.style.background = 'rgba(255, 255, 255, 0.15)';
        fullscreenBtn.style.transform = 'scale(1.1)';
    };
    fullscreenBtn.onmouseout = () => {
        fullscreenBtn.style.background = 'rgba(0, 0, 0, 0.6)';
        fullscreenBtn.style.transform = 'scale(1)';
    };
    
    lyricsSection.appendChild(fullscreenBtn);

    // Create fullscreen overlay
    const fullscreenLyricsOverlay = document.createElement('div');
    fullscreenLyricsOverlay.id = 'fullscreenLyricsOverlay';
    fullscreenLyricsOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 80px 40px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
    `;
    
    fullscreenLyricsOverlay.innerHTML = `
        <!-- Animated background -->
        <div id="fullscreenLyricsBg" style="
            position: absolute;
            inset: 0;
            background: radial-gradient(circle at 50% 50%, var(--gradient-color) 0%, transparent 70%);
            opacity: 0.3;
            animation: breathe 8s ease-in-out infinite;
        "></div>
        
        <!-- Now Playing Info -->
        <div id="fullscreenNowPlaying" style="
            position: absolute;
            top: 40px;
            left: 40px;
            display: flex;
            align-items: center;
            gap: 16px;
            z-index: 2;
        ">
            <img id="fullscreenAlbumArt" src="" style="
                width: 64px;
                height: 64px;
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
            ">
            <div>
                <div id="fullscreenSongTitle" style="
                    font-family: 'Syne', sans-serif;
                    font-size: 20px;
                    font-weight: 700;
                    color: white;
                    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
                    margin-bottom: 4px;
                ">Song Title</div>
                <div id="fullscreenArtist" style="
                    font-size: 14px;
                    color: rgba(255, 255, 255, 0.7);
                    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
                ">Artist</div>
            </div>
        </div>
        
        <!-- Exit Button -->
        <button id="exitFullscreenLyrics" style="
            position: absolute;
            top: 40px;
            right: 40px;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            width: 52px;
            height: 52px;
            border-radius: 50%;
            font-size: 28px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            z-index: 2;
        ">×</button>
        
        <!-- Lyrics Container -->
        <div id="fullscreenLyricsText" style="
            max-width: 900px;
            width: 100%;
            max-height: calc(100vh - 200px);
            overflow-y: auto;
            padding: 40px 20px;
            color: white;
            text-align: center;
            font-size: 32px;
            line-height: 2.2;
            font-weight: 400;
            text-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
            position: relative;
            z-index: 1;
            scroll-behavior: smooth;
        "></div>
    `;
    
    document.body.appendChild(fullscreenLyricsOverlay);

    // Toggle function
    function toggleFullscreenLyrics() {
        isFullscreenLyrics = !isFullscreenLyrics;
        
        if (isFullscreenLyrics) {
            // Open fullscreen
            fullscreenLyricsOverlay.style.opacity = '1';
            fullscreenLyricsOverlay.style.pointerEvents = 'all';
            
            // Copy lyrics content
            const lyricsContainer = document.getElementById('lyrics');
            const fullscreenText = document.getElementById('fullscreenLyricsText');
            if (fullscreenText && lyricsContainer) {
                fullscreenText.innerHTML = lyricsContainer.innerHTML;
            }
            
            // Update now playing info
            if (currentPlayingSong) {
                const albumArt = document.getElementById('fullscreenAlbumArt');
                const songTitle = document.getElementById('fullscreenSongTitle');
                const artist = document.getElementById('fullscreenArtist');
                
                if (albumArt) albumArt.src = currentPlayingSong.art || '';
                if (songTitle) songTitle.textContent = currentPlayingSong.title || 'Unknown';
                if (artist) artist.textContent = currentPlayingSong.artist || 'Unknown';
            }
            
            // Prevent body scroll
            document.body.style.overflow = 'hidden';
            
        } else {
            // Close fullscreen
            fullscreenLyricsOverlay.style.opacity = '0';
            fullscreenLyricsOverlay.style.pointerEvents = 'none';
            
            // Restore body scroll
            document.body.style.overflow = '';
        }
    }

    // Event listeners
    fullscreenBtn.onclick = toggleFullscreenLyrics;
    
    const exitBtn = document.getElementById('exitFullscreenLyrics');
    if (exitBtn) {
        exitBtn.onmouseover = () => {
            exitBtn.style.background = 'rgba(255, 255, 255, 0.15)';
            exitBtn.style.transform = 'scale(1.1) rotate(90deg)';
        };
        exitBtn.onmouseout = () => {
            exitBtn.style.background = 'rgba(0, 0, 0, 0.6)';
            exitBtn.style.transform = 'scale(1) rotate(0deg)';
        };
        exitBtn.onclick = toggleFullscreenLyrics;
    }
    
    // Close on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFullscreenLyrics) {
            toggleFullscreenLyrics();
        }
    });
    
    // Click overlay background to close
    fullscreenLyricsOverlay.addEventListener('click', (e) => {
        if (e.target === fullscreenLyricsOverlay) {
            toggleFullscreenLyrics();
        }
    });
}

// Export to global scope
window.setupFullscreenLyrics = setupFullscreenLyrics;

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
        save('queue_index', 0);
        renderQueue();
        showNotification("Queue cleared");
        // Keep playing current song if any
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
    renderPlaylists(); // ADD THIS LINE
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
        renderPlaylists(); // ADD THIS LINE
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
        case 'artist':  // NEW
            showArtistQuickMenu(contextMenuTarget.artist);
            break;
        case 'share':
            const url = contextMenuTarget.scPermalinkUrl || `https://soundcloud.com/search?q=${encodeURIComponent((contextMenuTarget.title || '') + ' ' + (contextMenuTarget.artist || ''))}`;
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


// ═══════════════════════════════════════
// ARTIST LIBRARY SYSTEM
// ═══════════════════════════════════════

let savedArtists = load('indy_saved_artists', {});

// Artist data structure
function createArtistObject(name, channelId = null) {
    return {
        id: channelId || name.replace(/\W/g, '_'),
        name: name,
        channelId: channelId,
        image: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=400&background=random&bold=true`,
        dateAdded: Date.now(),
        topTracks: [],
        albums: [],
        lastFetched: null
    };
}

// Save artist to library
function saveArtistToLibrary(artistName, channelId = null) {
    const artistId = channelId || artistName.replace(/\W/g, '_');
    
    if (savedArtists[artistId]) {
        showNotification("Artist already in library!");
        return false;
    }
    
    const artist = createArtistObject(artistName, channelId);
    savedArtists[artistId] = artist;
    
    save('indy_saved_artists', savedArtists);
    showNotification(`Added ${artistName} to library! 🎤`);
    
    renderPlaylists();
    updateFilterCounts();
    
    // Fetch artist data in background (only once)
    fetchArtistDataBackground(artistId);
    
    return true;
}

// Fetch artist data with caching (only if not fetched recently)
async function fetchArtistDataBackground(artistId) {
    const artist = savedArtists[artistId];
    if (!artist) return;
    
    // If fetched within last 7 days, skip
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    if (artist.lastFetched && artist.lastFetched > weekAgo) {
        console.log(`Artist data for ${artist.name} is fresh, skipping fetch`);
        return;
    }
    
    try {
        // Fetch top tracks via Deezer (free, no key)
        const tracks = await searchDeezer(artist.name, 'track', 10);
        if (tracks.length > 0) {
            artist.topTracks = tracks;
        }
        
        // Fetch albums via Deezer
        const albums = await searchDeezer(artist.name + ' album', 'album', 6);
        if (albums.length > 0) {
            artist.albums = albums.map(a => ({
                id: a.deezerAlbumId,
                name: a.title,
                art: a.art
            }));
        }
        
        artist.lastFetched = Date.now();
        save('indy_saved_artists', savedArtists);
        
        console.log(`✓ Artist data cached for ${artist.name}`);
        
    } catch (error) {
        console.error("Artist data fetch error:", error);
    }
}

// View artist profile
async function viewArtistProfile(artistId) {
    const artist = savedArtists[artistId];
    if (!artist) return;
    
    const mainContent = document.getElementById('mainContent');
    if (!mainContent) return;
    
    // Show loading state
    mainContent.innerHTML = `
        <div class="artist-view">
            <button class="back-btn" onclick="showHome()">← Back</button>
            <div class="artist-header">
                <img src="${artist.image}" class="artist-image skeleton" alt="${escapeHtml(artist.name)}">
                <div class="artist-info">
                    <h1>${escapeHtml(artist.name)}</h1>
                    <div class="loading-text">Loading artist data...</div>
                </div>
            </div>
            <div class="skeleton" style="height: 300px; border-radius: 12px; margin-top: 24px;"></div>
        </div>
    `;
    
    // Fetch fresh data only if needed
    await fetchArtistDataBackground(artistId);
    
    // Render full artist view
    renderArtistView(artistId);
}

// Render complete artist profile
function renderArtistView(artistId) {
    const artist = savedArtists[artistId];
    if (!artist) return;
    
    const mainContent = document.getElementById('mainContent');
    if (!mainContent) return;
    
    mainContent.innerHTML = `
        <div class="artist-view">
            <button class="back-btn" onclick="showHome()">← Back</button>
            
            <div class="artist-header">
                <img src="${artist.image}" class="artist-image" alt="${escapeHtml(artist.name)}">
                <div class="artist-info">
                    <h1>${escapeHtml(artist.name)}</h1>
                    <p>${artist.topTracks?.length || 0} top tracks • ${artist.albums?.length || 0} albums</p>
                    <div style="display:flex;gap:12px;margin-top:16px;">
                        <button class="play-all-btn" onclick="playArtistRadio('${artistId}')">
                            ▶ Play Radio
                        </button>
                        <button class="remove-artist-btn" onclick="removeArtistFromLibrary('${artistId}')">
                            🗑️ Remove from Library
                        </button>
                    </div>
                </div>
            </div>
            
            ${artist.topTracks && artist.topTracks.length > 0 ? `
                <div class="section">
                    <div class="section-header">
                        <h2>Popular Tracks</h2>
                    </div>
                    <div class="artist-tracks" id="artistTopTracks"></div>
                </div>
            ` : ''}
            
            ${artist.albums && artist.albums.length > 0 ? `
                <div class="section">
                    <div class="section-header">
                        <h2>Albums</h2>
                    </div>
                    <div class="scroll-container" id="artistAlbums"></div>
                </div>
            ` : ''}
        </div>
    `;
    
    // Render top tracks
    if (artist.topTracks && artist.topTracks.length > 0) {
        const tracksContainer = document.getElementById('artistTopTracks');
        artist.topTracks.forEach((track, i) => {
            const div = document.createElement('div');
            div.className = 'album-song-item';
            div.innerHTML = `
                <span class="song-number">${i + 1}</span>
                <img src="${track.art}" alt="">
                <div class="song-info">
                    <div class="song-title">${escapeHtml(track.title)}</div>
                    <div class="song-artist">${escapeHtml(artist.name)}</div>
                </div>
                <button onclick="event.stopPropagation(); addToQueue(${JSON.stringify(track).replace(/"/g, '&quot;')})" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:var(--text);width:32px;height:32px;border-radius:50%;cursor:pointer;margin-left:auto;">+</button>
            `;
            div.onclick = () => {
                currentSongs = artist.topTracks;
                currentIndex = i;
                playSong(track);
            };
            if (tracksContainer) tracksContainer.appendChild(div);
        });
    }
    
    // Render albums
    if (artist.albums && artist.albums.length > 0) {
        const albumsContainer = document.getElementById('artistAlbums');
        artist.albums.forEach(album => {
            const div = document.createElement('div');
            div.className = 'album-card';
            div.innerHTML = `
                <img src="${album.art}" alt="">
                <div class="album-title">${escapeHtml(album.name)}</div>
                <div class="album-artist">${escapeHtml(artist.name)}</div>
            `;
            div.onclick = () => playPlaylist(album.id, true);
            if (albumsContainer) albumsContainer.appendChild(div);
        });
    }
}

// Play artist radio (mix of their top tracks)
function playArtistRadio(artistId) {
    const artist = savedArtists[artistId];
    if (!artist || !artist.topTracks || artist.topTracks.length === 0) {
        showNotification("No tracks available for this artist");
        return;
    }
    
    currentSongs = [...artist.topTracks];
    currentIndex = 0;
    currentPlaylist = null;
    
    playSong(currentSongs[0]);
    showNotification(`Playing ${artist.name} Radio 📻`);
}

// Remove artist from library
function removeArtistFromLibrary(artistId) {
    const artist = savedArtists[artistId];
    if (!artist) return;
    
    if (confirm(`Remove ${artist.name} from your library?`)) {
        delete savedArtists[artistId];
        save('indy_saved_artists', savedArtists);
        showNotification(`Removed ${artist.name} from library`);
        
        renderPlaylists();
        updateFilterCounts();
        showHome();
    }
}

// Update renderPlaylists to include artists
window.renderPlaylistsOriginal = renderPlaylists;
renderPlaylists = function() {
    renderPlaylistsOriginal();
    
    const container = document.getElementById('playlistsList');
    if (!container) return;
    
    // Add artists section
    const artists = Object.values(savedArtists);
    if (artists.length > 0) {
        artists.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        
        artists.forEach(artist => {
            const div = document.createElement('div');
            div.className = 'playlist-item artist-playlist-item';
            div.innerHTML = `
                <img src="${artist.image}" class="playlist-artist-image" alt="">
                <div class="playlist-info">
                    <div class="playlist-name">${escapeHtml(artist.name)}</div>
                    <div class="playlist-count">Artist</div>
                </div>
            `;
            div.onclick = () => viewArtistProfile(artist.id);
            container.appendChild(div);
        });
    }
};

// Add "Add Artist" button to search results
window.renderSearchResultsOriginal = renderSearchResults;
renderSearchResults = function(videos, playlists) {
    renderSearchResultsOriginal(videos, playlists);
    
    // Add quick "Save Artist" buttons to song cards
    const songCards = document.querySelectorAll('.song-card');
    songCards.forEach(card => {
        const songData = card.getAttribute('data-song');
        if (songData) {
            try {
                const song = JSON.parse(songData);
                const artistBtn = document.createElement('button');
                artistBtn.innerHTML = '🎤';
                artistBtn.title = `Add ${song.artist} to library`;
                artistBtn.style.cssText = `
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    color: var(--text);
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    cursor: pointer;
                    font-size: 18px;
                    margin-left: 8px;
                `;
                artistBtn.onclick = (e) => {
                    e.stopPropagation();
                    saveArtistToLibrary(song.artist);
                };
                card.appendChild(artistBtn);
            } catch (e) {
                console.error("Error parsing song data:", e);
            }
        }
    });
};

// Export to global scope
window.saveArtistToLibrary = saveArtistToLibrary;
window.viewArtistProfile = viewArtistProfile;
window.removeArtistFromLibrary = removeArtistFromLibrary;
window.playArtistRadio = playArtistRadio;

console.log('✓ Artist library system loaded');


// Update the renderRecent function to make artist names clickable
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
                <div class="song-artist clickable-artist" data-artist="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
            </div>
        `;
        div.onclick = () => playSong(song);
        
        // Make artist name clickable
        const artistEl = div.querySelector('.song-artist');
        if (artistEl) {
            artistEl.onclick = (e) => {
                e.stopPropagation();
                showArtistQuickMenu(song.artist);
            };
        }
        
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


// Show quick menu when clicking artist name
function showArtistQuickMenu(artistName) {
    const artistId = artistName.replace(/\W/g, '_');
    const isInLibrary = savedArtists[artistId];
    
    const menu = document.createElement('div');
    menu.className = 'modal active';
    menu.id = 'artistQuickMenu';
    menu.innerHTML = `
        <div class="modal-content" style="max-width: 360px;">
            <h3 style="margin-bottom: 20px;">🎤 ${escapeHtml(artistName)}</h3>
            
            <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">
                ${isInLibrary ? `
                    <button class="link-option-btn" onclick="viewArtistProfile('${artistId}'); closeArtistQuickMenu()">
                        <span style="font-size: 28px;">👤</span>
                        <div>
                            <div>View Artist Profile</div>
                            <div style="font-size: 13px; color: var(--muted); margin-top: 3px;">
                                See all songs and albums
                            </div>
                        </div>
                    </button>
                ` : `
                    <button class="link-option-btn" onclick="saveArtistToLibrary('${escapeHtml(artistName)}'); closeArtistQuickMenu()">
                        <span style="font-size: 28px;">➕</span>
                        <div>
                            <div>Add to Library</div>
                            <div style="font-size: 13px; color: var(--muted); margin-top: 3px;">
                                Save this artist to your library
                            </div>
                        </div>
                    </button>
                `}
                
                <button class="link-option-btn" onclick="searchArtistSongs('${escapeHtml(artistName)}'); closeArtistQuickMenu()">
                    <span style="font-size: 28px;">🔍</span>
                    <div>
                        <div>Search Songs</div>
                        <div style="font-size: 13px; color: var(--muted); margin-top: 3px;">
                            Find more by this artist
                        </div>
                    </div>
                </button>
            </div>
            
            <div class="modal-buttons">
                <button class="secondary" onclick="closeArtistQuickMenu()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(menu);
}

function closeArtistQuickMenu() {
    const menu = document.getElementById('artistQuickMenu');
    if (menu) menu.remove();
}

function searchArtistSongs(artistName) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = artistName;
        showSearch();
        setTimeout(() => {
            searchInput.focus();
            searchInput.dispatchEvent(new Event('input'));
        }, 100);
    }
}

// Export functions
window.showArtistQuickMenu = showArtistQuickMenu;
window.closeArtistQuickMenu = closeArtistQuickMenu;
window.searchArtistSongs = searchArtistSongs;

// ═══════════════════════════════════════
// GENRE BROWSE SYSTEM
// ═══════════════════════════════════════

const musicGenres = [
    { name: 'Pop', emoji: '🎤', color: '#FF6B9D', gradient: 'linear-gradient(135deg, #FF6B9D, #C44569)' },
    { name: 'Hip Hop', emoji: '🎧', color: '#8E44AD', gradient: 'linear-gradient(135deg, #8E44AD, #6C5CE7)' },
    { name: 'Rock', emoji: '🎸', color: '#E74C3C', gradient: 'linear-gradient(135deg, #E74C3C, #C0392B)' },
    { name: 'Jazz', emoji: '🎷', color: '#3498DB', gradient: 'linear-gradient(135deg, #3498DB, #2980B9)' },
    { name: 'Classical', emoji: '🎻', color: '#9B59B6', gradient: 'linear-gradient(135deg, #9B59B6, #8E44AD)' },
    { name: 'Electronic', emoji: '🎹', color: '#1ABC9C', gradient: 'linear-gradient(135deg, #1ABC9C, #16A085)' },
    { name: 'R&B', emoji: '💿', color: '#E67E22', gradient: 'linear-gradient(135deg, #E67E22, #D35400)' },
    { name: 'Country', emoji: '🤠', color: '#F39C12', gradient: 'linear-gradient(135deg, #F39C12, #E67E22)' },
    { name: 'Reggae', emoji: '🌴', color: '#27AE60', gradient: 'linear-gradient(135deg, #27AE60, #229954)' },
    { name: 'Blues', emoji: '🎺', color: '#34495E', gradient: 'linear-gradient(135deg, #34495E, #2C3E50)' },
    { name: 'Metal', emoji: '⚡', color: '#95A5A6', gradient: 'linear-gradient(135deg, #95A5A6, #7F8C8D)' },
    { name: 'Soul', emoji: '✨', color: '#D4AF37', gradient: 'linear-gradient(135deg, #D4AF37, #C19A2E)' },
    { name: 'Indie', emoji: '🌙', color: '#5DADE2', gradient: 'linear-gradient(135deg, #5DADE2, #3498DB)' },
    { name: 'Folk', emoji: '🍂', color: '#A04000', gradient: 'linear-gradient(135deg, #A04000, #7D3C00)' },
    { name: 'Latin', emoji: '💃', color: '#EC7063', gradient: 'linear-gradient(135deg, #EC7063, #E74C3C)' },
    { name: 'K-Pop', emoji: '🌸', color: '#FF69B4', gradient: 'linear-gradient(135deg, #FF69B4, #FF1493)' },
    { name: 'Disco', emoji: '🕺', color: '#BB8FCE', gradient: 'linear-gradient(135deg, #BB8FCE, #9B59B6)' },
    { name: 'Funk', emoji: '🎵', color: '#F4D03F', gradient: 'linear-gradient(135deg, #F4D03F, #F39C12)' },
    { name: 'Gospel', emoji: '🙏', color: '#85C1E2', gradient: 'linear-gradient(135deg, #85C1E2, #5DADE2)' },
    { name: 'Punk', emoji: '💀', color: '#E74C3C', gradient: 'linear-gradient(135deg, #E74C3C, #CB4335)' },
    { name: 'Broadway', emoji: '🎭', color: '#FFD700', gradient: 'linear-gradient(135deg, #FFD700, #FFA500)' },
    { name: 'Anime', emoji: '🎌', color: '#FF6B9D', gradient: 'linear-gradient(135deg, #FF6B9D, #FF1493)' },
    { name: 'Lo-fi', emoji: '☕', color: '#A0826D', gradient: 'linear-gradient(135deg, #A0826D, #8B7355)' },
    { name: 'EDM', emoji: '💥', color: '#00D9FF', gradient: 'linear-gradient(135deg, #00D9FF, #0099CC)' },
    { name: 'Trap', emoji: '🔥', color: '#FF4757', gradient: 'linear-gradient(135deg, #FF4757, #EE5A6F)' },
    { name: 'Acoustic', emoji: '🎼', color: '#6C5B7B', gradient: 'linear-gradient(135deg, #6C5B7B, #5B4A6B)' },
    { name: 'Ambient', emoji: '🌊', color: '#4ECDC4', gradient: 'linear-gradient(135deg, #4ECDC4, #44A9A0)' },
    { name: 'Techno', emoji: '⚙️', color: '#2C3E50', gradient: 'linear-gradient(135deg, #2C3E50, #1A252F)' },
    { name: 'House', emoji: '🏠', color: '#F39C12', gradient: 'linear-gradient(135deg, #F39C12, #D68910)' },
    { name: 'Trance', emoji: '🌀', color: '#9B59B6', gradient: 'linear-gradient(135deg, #9B59B6, #7D3C98)' },
    { name: 'Dubstep', emoji: '🎚️', color: '#16A085', gradient: 'linear-gradient(135deg, #16A085, #138D75)' },
    { name: 'Drum & Bass', emoji: '🥁', color: '#E67E22', gradient: 'linear-gradient(135deg, #E67E22, #CA6F1E)' },
    { name: 'Ska', emoji: '🎺', color: '#F1C40F', gradient: 'linear-gradient(135deg, #F1C40F, #D4AC0D)' },
    { name: 'Swing', emoji: '🎩', color: '#566573', gradient: 'linear-gradient(135deg, #566573, #424949)' },
    { name: 'Bollywood', emoji: '🇮🇳', color: '#FF9933', gradient: 'linear-gradient(135deg, #FF9933, #FF6600)' },
    { name: 'Afrobeat', emoji: '🌍', color: '#28B463', gradient: 'linear-gradient(135deg, #28B463, #239B56)' }
];

function renderGenreBrowse() {
    const genreGrid = document.getElementById('genreGrid');
    if (!genreGrid) return;
    
    genreGrid.innerHTML = '';
    
    musicGenres.forEach((genre, index) => {
        const card = document.createElement('div');
        card.className = 'genre-card';
        card.style.background = genre.gradient;
        card.style.animationDelay = `${index * 0.03}s`;
        
        card.innerHTML = `
            <div class="genre-emoji">${genre.emoji}</div>
            <div class="genre-name">${escapeHtml(genre.name)}</div>
        `;
        
        card.onclick = () => searchGenre(genre.name);
        
        genreGrid.appendChild(card);
    });
}

function searchGenre(genreName) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = genreName;
        
        // Trigger search
        const event = new Event('input');
        searchInput.dispatchEvent(event);
    }
}

// Update setupSearchInput to handle showing/hiding genre browse
function setupSearchInput() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput || searchInput.dataset.enhanced) return;

    searchInput.dataset.enhanced = 'true';
    
    const genreBrowse = document.getElementById('genreBrowse');
    const searchResults = document.getElementById('searchResults');

    searchInput.oninput = (e) => {
        clearTimeout(searchTimeout);
        const value = e.target.value.trim();

        if (!value) {
            // Show genre browse, hide results
            if (genreBrowse) genreBrowse.style.display = 'block';
            if (searchResults) {
                searchResults.style.display = 'none';
                searchResults.innerHTML = '';
            }
            return;
        }
        
        // Hide genre browse, show results
        if (genreBrowse) genreBrowse.style.display = 'none';
        if (searchResults) searchResults.style.display = 'block';

        searchTimeout = setTimeout(async () => {
            const scUrl = extractSoundCloudUrl(value);

            if (scUrl) {
                e.target.value = '';
                const song = { id: 'sc_paste', scPermalinkUrl: scUrl, title: "SoundCloud Track", artist: "SoundCloud", art: '', _isSoundCloud: true };
                playSong(song);
                showNotification("Playing SoundCloud track!");
} else if (value.length >= 3) {
                try {
                    const [tracks, albums] = await Promise.all([
                        searchDeezer(value, 'track', 10),
                        searchDeezer(value, 'album', 6)
                    ]);
                    renderDeezerSearchResults(tracks, albums);
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
            const scUrl = extractSoundCloudUrl(value);

            if (scUrl) {
                e.target.value = '';
                const song = { id: 'sc_paste', scPermalinkUrl: scUrl, title: "SoundCloud Track", artist: "SoundCloud", art: '', _isSoundCloud: true };
                playSong(song);
                showNotification("Playing SoundCloud track!");
            }
        }
    });
    
    // Initial render of genre browse
    renderGenreBrowse();
}

// Update showSearch to show genre browse initially
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
    
    // Show genre browse if search is empty
    const genreBrowse = document.getElementById('genreBrowse');
    const searchResults = document.getElementById('searchResults');
    if (searchInput && !searchInput.value.trim()) {
        if (genreBrowse) genreBrowse.style.display = 'block';
        if (searchResults) searchResults.style.display = 'none';
        renderGenreBrowse();
    }
}
console.log('✓ Genre browse system loaded');
// Export functions
window.renderGenreBrowse = renderGenreBrowse;
window.searchGenre = searchGenre;


// ============================================
// AI DJ v4 - WITH SAVED SESSIONS + 5 NEW FEATURES
// Full replacement — paste over your AI DJ section
// ============================================

let djMode = false;
let djHistory = [];
let djSessions = load('dj_sessions', []); // Persisted sessions
let currentSessionId = null;

// ─────────────────────────────────────────────
// SESSION HELPERS
// ─────────────────────────────────────────────

function createDJSession(firstMessage = null) {
    const session = {
        id: Date.now().toString(),
        createdAt: Date.now(),
        label: firstMessage ? firstMessage.slice(0, 40) : 'New Session',
        messages: []
    };
    djSessions.unshift(session);
    if (djSessions.length > 10) djSessions = djSessions.slice(0, 10);
    save('dj_sessions', djSessions);
    currentSessionId = session.id;
    return session;
}

function saveMessageToSession(role, content) {
    if (!currentSessionId) createDJSession();
    const session = djSessions.find(s => s.id === currentSessionId);
    if (!session) return;
    session.messages.push({ role, content, ts: Date.now() });
    if (session.messages.length === 1 && role === 'user') {
        session.label = content.slice(0, 40);
    }
    save('dj_sessions', djSessions);
}

function loadDJSession(sessionId) {
    const session = djSessions.find(s => s.id === sessionId);
    if (!session) return;
    currentSessionId = sessionId;
    djHistory = session.messages.map(m => ({ role: m.role, content: m.content }));

    const messagesDiv = document.getElementById('djMessages');
    if (!messagesDiv) return;
    messagesDiv.innerHTML = '';

    session.messages.forEach(m => renderDJMessage(m.role, m.content));
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Hide session list, show chat
    document.getElementById('djSessionList')?.style.setProperty('display', 'none');
    document.getElementById('djChatArea')?.style.setProperty('display', 'flex');
    document.getElementById('djBackBtn')?.style.setProperty('display', 'flex');
    document.getElementById('djQuickActions')?.style.setProperty('display', 'none');
}

function deleteDJSession(sessionId, e) {
    e.stopPropagation();
    djSessions = djSessions.filter(s => s.id !== sessionId);
    save('dj_sessions', djSessions);
    if (currentSessionId === sessionId) {
        currentSessionId = null;
        djHistory = [];
    }
    renderSessionList();
}

// ─────────────────────────────────────────────
// INIT BUTTON
// ─────────────────────────────────────────────

function initAIDJ() {
    const recentHeader = document.querySelector('#recentSection .section-header h2');
    if (recentHeader && !document.getElementById('aiDjSparkleBtn')) {
        const btn = document.createElement('button');
        btn.id = 'aiDjSparkleBtn';
        btn.innerHTML = '✦ AI DJ';
        btn.style.cssText = `
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 20px;
            color: var(--text);
            font-size: 13px;
            font-weight: 700;
            padding: 7px 16px;
            cursor: pointer;
            margin-left: 14px;
            letter-spacing: 0.5px;
            transition: all 0.2s ease;
        `;
        btn.onmouseover = () => { btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.borderColor = 'rgba(255,255,255,0.22)'; };
        btn.onmouseout  = () => { btn.style.background = 'rgba(255,255,255,0.06)'; btn.style.borderColor = 'rgba(255,255,255,0.12)'; };
        btn.onclick = openAIDJ;
        const hdr = recentHeader.parentElement;
        hdr.style.display = 'flex';
        hdr.style.alignItems = 'center';
        hdr.appendChild(btn);
    }
}

// ─────────────────────────────────────────────
// OPEN / CLOSE
// ─────────────────────────────────────────────

function openAIDJ() {
    document.getElementById('aiDjOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'aiDjOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,0.85);
        backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div id="djPanel" style="
            width:100%;max-width:680px;max-height:90vh;
            background:rgba(18,18,18,0.98);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:16px;display:flex;
            flex-direction:column;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.8);
        ">

            <!-- HEADER -->
            <div style="
                display:flex;align-items:center;justify-content:space-between;
                padding:18px 22px;
                border-bottom:1px solid rgba(255,255,255,0.06);
                flex-shrink:0;
            ">
                <div style="display:flex;align-items:center;gap:10px;">
                    <!-- Back button (hidden by default) -->
                    <button id="djBackBtn" onclick="showDJHome()" style="
                        display:none;align-items:center;justify-content:center;
                        background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                        border-radius:8px;color:var(--text);width:32px;height:32px;
                        cursor:pointer;font-size:16px;transition:all 0.2s ease;flex-shrink:0;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">←</button>

                    <span style="font-size:18px;">✦</span>
                    <div>
                        <div style="font-family:'Syne',sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.5px;" id="djPanelTitle">AI DJ</div>
                        <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px;" id="djPanelSubtitle">Your personal music assistant</div>
                    </div>
                </div>

                <div style="display:flex;gap:8px;align-items:center;">
                    <button onclick="showDJSessions()" id="djHistoryBtn" title="Past sessions" style="
                        background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                        border-radius:8px;color:rgba(255,255,255,0.6);
                        width:32px;height:32px;cursor:pointer;font-size:15px;
                        display:flex;align-items:center;justify-content:center;
                        transition:all 0.2s ease;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='white'" onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.color='rgba(255,255,255,0.6)'">⏱</button>

                    <button onclick="closeAIDJ()" style="
                        background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                        color:var(--text);width:32px;height:32px;border-radius:50%;
                        cursor:pointer;font-size:18px;
                        display:flex;align-items:center;justify-content:center;
                        transition:all 0.2s ease;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">×</button>
                </div>
            </div>

            <!-- SESSION LIST (hidden by default) -->
            <div id="djSessionList" style="display:none;flex-direction:column;flex:1;overflow-y:auto;padding:16px 22px;gap:8px;"></div>

            <!-- HOME: Quick Actions -->
            <div id="djQuickActions" style="
                padding:18px 22px;
                border-bottom:1px solid rgba(255,255,255,0.06);
                flex-shrink:0;
            ">
                <div style="font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;font-weight:600;">Quick Start</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    ${[
                        ['🌊','Create a Vibe','vibe'],
                        ['🔍','Discover Music','discovery'],
                        ['📖','Song Stories','story'],
                        ['💭','Custom Request','custom'],
                    ].map(([icon, label, type]) => `
                        <button onclick="startDJSession('${type}')" style="
                            background:rgba(255,255,255,0.04);
                            border:1px solid rgba(255,255,255,0.08);
                            border-radius:10px;padding:13px 15px;
                            color:var(--text);cursor:pointer;text-align:left;
                            display:flex;align-items:center;gap:10px;
                            font-size:13px;font-weight:600;
                            transition:all 0.2s ease;
                        "
                        onmouseover="this.style.background='rgba(255,255,255,0.08)';this.style.borderColor='rgba(255,255,255,0.14)'"
                        onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='rgba(255,255,255,0.08)'">
                            <span style="font-size:17px;">${icon}</span>
                            <span>${label}</span>
                        </button>
                    `).join('')}
                </div>

                <!-- Recent sessions preview -->
                <div id="djRecentPreview" style="margin-top:14px;"></div>
            </div>

            <!-- CHAT AREA (hidden until session starts) -->
            <div id="djChatArea" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
                <div id="djMessages" style="
                    flex:1;overflow-y:auto;
                    padding:18px 22px;
                    display:flex;flex-direction:column;gap:12px;
                    min-height:80px;max-height:360px;
                "></div>
            </div>

            <!-- INPUT -->
            <div style="
                padding:14px 22px 18px;
                border-top:1px solid rgba(255,255,255,0.06);
                display:flex;gap:8px;flex-shrink:0;
            ">
                <input id="djInput" type="text" placeholder="Ask your DJ anything..." style="
                    flex:1;
                    background:rgba(255,255,255,0.05);
                    border:1px solid rgba(255,255,255,0.1);
                    border-radius:10px;padding:11px 15px;
                    color:var(--text);font-size:14px;outline:none;
                    transition:border-color 0.2s ease;
                    font-family:'DM Sans',sans-serif;
                "
                onfocus="this.style.borderColor='rgba(255,255,255,0.25)'"
                onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
                onkeypress="if(event.key==='Enter') sendDJMessage()">
                <button onclick="sendDJMessage()" style="
                    background:rgba(255,255,255,0.1);
                    border:1px solid rgba(255,255,255,0.15);
                    border-radius:10px;color:var(--text);
                    padding:11px 18px;font-size:13px;font-weight:600;
                    cursor:pointer;white-space:nowrap;transition:all 0.2s ease;
                "
                onmouseover="this.style.background='rgba(255,255,255,0.16)'"
                onmouseout="this.style.background='rgba(255,255,255,0.1)'">Send ↵</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.opacity = '1'; }, 20);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAIDJ(); });

    renderRecentSessionsPreview();
    document.getElementById('djInput').focus();

    // ESC to close
    const escFn = e => { if (e.key === 'Escape') { closeAIDJ(); document.removeEventListener('keydown', escFn); } };
    document.addEventListener('keydown', escFn);
}

function closeAIDJ() {
    const overlay = document.getElementById('aiDjOverlay');
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
}

// ─────────────────────────────────────────────
// SESSION LIST UI
// ─────────────────────────────────────────────

function showDJSessions() {
    document.getElementById('djQuickActions').style.display = 'none';
    document.getElementById('djChatArea').style.display = 'none';
    document.getElementById('djBackBtn').style.display = 'flex';
    document.getElementById('djHistoryBtn').style.display = 'none';
    document.getElementById('djPanelTitle').textContent = 'Past Sessions';
    document.getElementById('djPanelSubtitle').textContent = 'Saved for this device';

    const list = document.getElementById('djSessionList');
    list.style.display = 'flex';
    renderSessionList();
}

function showDJHome() {
    document.getElementById('djSessionList').style.display = 'none';
    document.getElementById('djChatArea').style.display = 'none';
    document.getElementById('djBackBtn').style.display = 'none';
    document.getElementById('djHistoryBtn').style.display = 'flex';
    document.getElementById('djQuickActions').style.display = 'block';
    document.getElementById('djPanelTitle').textContent = 'AI DJ';
    document.getElementById('djPanelSubtitle').textContent = 'Your personal music assistant';
    renderRecentSessionsPreview();
}

function renderSessionList() {
    const list = document.getElementById('djSessionList');
    if (!list) return;
    list.innerHTML = '';

    if (djSessions.length === 0) {
        list.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.25);font-size:14px;padding:40px 0;">No saved sessions yet</div>`;
        return;
    }

    djSessions.forEach(session => {
        const item = document.createElement('div');
        item.style.cssText = `
            display:flex;align-items:center;gap:12px;
            padding:13px 15px;
            background:rgba(255,255,255,0.04);
            border:1px solid rgba(255,255,255,0.07);
            border-radius:10px;cursor:pointer;
            transition:all 0.2s ease;
        `;
        item.onmouseover = () => { item.style.background = 'rgba(255,255,255,0.08)'; item.style.borderColor = 'rgba(255,255,255,0.12)'; };
        item.onmouseout  = () => { item.style.background = 'rgba(255,255,255,0.04)'; item.style.borderColor = 'rgba(255,255,255,0.07)'; };

        const age = formatSessionAge(session.createdAt);
        item.innerHTML = `
            <div style="font-size:20px;flex-shrink:0;">💬</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${session.label}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:2px;">${session.messages.length} messages · ${age}</div>
            </div>
            <button onclick="deleteDJSession('${session.id}', event)" style="
                background:transparent;border:none;
                color:rgba(255,255,255,0.25);font-size:18px;
                cursor:pointer;padding:4px 8px;border-radius:6px;
                transition:all 0.2s ease;flex-shrink:0;
            " onmouseover="this.style.color='#ff5555'" onmouseout="this.style.color='rgba(255,255,255,0.25)'">×</button>
        `;
        item.onclick = () => loadDJSession(session.id);
        list.appendChild(item);
    });

    // Clear all button
    if (djSessions.length > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear all sessions';
        clearBtn.style.cssText = `
            background:transparent;border:none;
            color:rgba(255,255,255,0.25);font-size:13px;
            cursor:pointer;padding:8px;margin-top:4px;
            transition:color 0.2s ease;align-self:center;
        `;
        clearBtn.onmouseover = () => clearBtn.style.color = '#ff5555';
        clearBtn.onmouseout  = () => clearBtn.style.color = 'rgba(255,255,255,0.25)';
        clearBtn.onclick = () => {
            djSessions = [];
            save('dj_sessions', djSessions);
            renderSessionList();
        };
        list.appendChild(clearBtn);
    }
}

function renderRecentSessionsPreview() {
    const preview = document.getElementById('djRecentPreview');
    if (!preview || djSessions.length === 0) return;

    preview.innerHTML = `
        <div style="font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;font-weight:600;">Recent</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
            ${djSessions.slice(0, 3).map(s => `
                <button onclick="loadDJSession('${s.id}')" style="
                    background:rgba(255,255,255,0.03);
                    border:1px solid rgba(255,255,255,0.06);
                    border-radius:8px;padding:10px 13px;
                    color:rgba(255,255,255,0.7);
                    cursor:pointer;text-align:left;
                    display:flex;align-items:center;gap:10px;
                    font-size:13px;transition:all 0.2s ease;
                "
                onmouseover="this.style.background='rgba(255,255,255,0.07)';this.style.color='white'"
                onmouseout="this.style.background='rgba(255,255,255,0.03)';this.style.color='rgba(255,255,255,0.7)'">
                    <span style="opacity:0.5;font-size:14px;">💬</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${s.label}</span>
                    <span style="opacity:0.35;font-size:11px;flex-shrink:0;">${formatSessionAge(s.createdAt)}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function formatSessionAge(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return `${Math.floor(diff/86400000)}d ago`;
}

// ─────────────────────────────────────────────
// CHAT LOGIC
// ─────────────────────────────────────────────

function openChatView() {
    document.getElementById('djQuickActions').style.display = 'none';
    document.getElementById('djSessionList').style.display = 'none';
    document.getElementById('djChatArea').style.display = 'flex';
    document.getElementById('djBackBtn').style.display = 'flex';
    document.getElementById('djHistoryBtn').style.display = 'none';
}

async function startDJSession(type) {
    currentSessionId = null;
    djHistory = [];
    createDJSession(type);
    openChatView();

    document.getElementById('djMessages').innerHTML = '';
    document.getElementById('djPanelTitle').textContent = 'AI DJ';
    document.getElementById('djPanelSubtitle').textContent = 'Session started';

    let prompt = '';
    const context = buildMusicContext();

    switch (type) {
        case 'vibe':
            prompt = `Based on my listening history, create a perfect vibe playlist for right now. Suggest 6-8 songs that flow together. Format each as "Song Title" by Artist Name and explain the mood briefly.`;
            break;
        case 'discovery':
            prompt = `Look at my music taste and recommend 5 artists or songs I've never heard but would love. Format each as "Song Title" by Artist Name and explain why.`;
            break;
        case 'story':
            prompt = `Pick 2-3 songs from my recent plays and tell me a fascinating story about each. Keep it conversational and fun.`;
            break;
        case 'custom':
            renderDJMessage('assistant', "Hey! I'm your INDY DJ. What are you in the mood for? I can build playlists, recommend artists, tell you song stories, or anything else music-related.");
            saveMessageToSession('assistant', "Hey! I'm your INDY DJ. What are you in the mood for?");
            document.getElementById('djInput')?.focus();
            return;
    }

    addDJLoadingMessage();
    await callDJ(prompt, context);
}

async function sendDJMessage() {
    const input = document.getElementById('djInput');
    const message = input?.value.trim();
    if (!message) return;

    if (!currentSessionId) createDJSession(message);
    openChatView();

    renderDJMessage('user', message);
    saveMessageToSession('user', message);
    input.value = '';

    addDJLoadingMessage();
    await callDJ(message, buildMusicContext());
}

async function callDJ(userMessage, context = '') {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: `You are a knowledgeable music DJ for INDY Music. Be concise, conversational, and enthusiastic. When suggesting songs format them as "Song Title" by Artist Name. Keep responses under 200 words unless telling a story. No markdown headers.`
                    },
                    ...djHistory,
                    { role: 'user', content: `${context}\n\n${userMessage}` }
                ],
                temperature: 0.8,
                max_tokens: 600
            })
        });

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || 'Something went wrong, try again.';

        djHistory.push({ role: 'user', content: userMessage }, { role: 'assistant', content: reply });
        if (djHistory.length > 20) djHistory = djHistory.slice(-20);

        removeDJLoadingMessage();
        renderDJMessage('assistant', reply);
        saveMessageToSession('assistant', reply);
        parseSongsFromResponse(reply);

    } catch (err) {
        removeDJLoadingMessage();
        renderDJMessage('assistant', "Couldn't reach the AI right now. Check your connection.");
        console.error('DJ error:', err);
    }
}

function buildMusicContext() {
    const recentSongs = recent.slice(0, 8).map(s => `"${s.title}" by ${s.artist}`).join(', ');
    const topArtists = [...new Set(recent.map(s => s.artist))].slice(0, 5).join(', ');
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'late night';
    return `User context: Recently played: ${recentSongs || 'nothing yet'}. Favourite artists: ${topArtists || 'none'}. Time of day: ${timeOfDay}.`;
}

// ─────────────────────────────────────────────
// MESSAGE RENDERING
// ─────────────────────────────────────────────

function renderDJMessage(role, content) {
    const messagesDiv = document.getElementById('djMessages');
    if (!messagesDiv) return;

    const isUser = role === 'user';
    const msg = document.createElement('div');
    msg.style.cssText = `
        display:flex;gap:9px;align-items:flex-start;
        ${isUser ? 'flex-direction:row-reverse;' : ''}
        animation:fadeInUp 0.3s ease;
    `;
    msg.innerHTML = `
        <div style="
            width:26px;height:26px;border-radius:50%;flex-shrink:0;margin-top:2px;
            background:${isUser ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)'};
            border:1px solid rgba(255,255,255,0.1);
            display:flex;align-items:center;justify-content:center;font-size:12px;
        ">${isUser ? '👤' : '✦'}</div>
        <div style="
            max-width:80%;
            background:${isUser ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)'};
            border:1px solid rgba(255,255,255,${isUser ? '0.08' : '0.06'});
            border-radius:${isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px'};
            padding:11px 14px;
            font-size:14px;line-height:1.6;
            color:rgba(255,255,255,${isUser ? '0.85' : '0.9'});
        ">${formatDJMessage(content)}</div>
    `;
    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addDJLoadingMessage() {
    const messagesDiv = document.getElementById('djMessages');
    if (!messagesDiv) return;
    const el = document.createElement('div');
    el.id = 'djLoadingMsg';
    el.style.cssText = 'display:flex;gap:9px;align-items:flex-start;animation:fadeInUp 0.3s ease;';
    el.innerHTML = `
        <div style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">✦</div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:4px 12px 12px 12px;padding:13px 16px;display:flex;gap:5px;align-items:center;">
            <span style="width:5px;height:5px;background:rgba(255,255,255,0.4);border-radius:50%;animation:djDot 1.2s infinite 0s;display:inline-block;"></span>
            <span style="width:5px;height:5px;background:rgba(255,255,255,0.4);border-radius:50%;animation:djDot 1.2s infinite 0.2s;display:inline-block;"></span>
            <span style="width:5px;height:5px;background:rgba(255,255,255,0.4);border-radius:50%;animation:djDot 1.2s infinite 0.4s;display:inline-block;"></span>
        </div>
    `;
    messagesDiv.appendChild(el);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function removeDJLoadingMessage() { document.getElementById('djLoadingMsg')?.remove(); }

function formatDJMessage(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em style="color:rgba(255,255,255,0.6)">$1</em>')
        .replace(/\n/g, '<br>')
        .replace(/"([^"]+)"\s+by\s+([^<,\n.]+)/g,
            '<span style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:2px 8px;font-weight:600;white-space:nowrap;font-size:13px;">"$1" by $2</span>');
}

function parseSongsFromResponse(text) {
    const matches = [...text.matchAll(/"([^"]+)"\s+by\s+([^,\n.<]+)/gi)];
    if (matches.length === 0) return;
    const songs = matches.map(m => ({ title: m[1].trim(), artist: m[2].trim() }));
    const messagesDiv = document.getElementById('djMessages');
    if (!messagesDiv) return;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;padding-left:35px;flex-wrap:wrap;';
    bar.innerHTML = `
        <button onclick="searchAndPlayDJPlaylist(${JSON.stringify(songs).replace(/"/g,'&quot;')})" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);border-radius:20px;color:var(--text);padding:7px 15px;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s ease;" onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">▶ Play ${songs.length} songs</button>
        <button onclick="addDJSongsToQueue(${JSON.stringify(songs).replace(/"/g,'&quot;')})" style="background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:20px;color:rgba(255,255,255,0.6);padding:7px 15px;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s ease;" onmouseover="this.style.borderColor='rgba(255,255,255,0.2)';this.style.color='white'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.color='rgba(255,255,255,0.6)'">+ Queue</button>
    `;
    messagesDiv.appendChild(bar);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function searchAndPlayDJPlaylist(songs) {
    closeAIDJ();
    showNotification(`✦ Finding ${songs.length} songs on SoundCloud...`);
    const found = [];
    for (const song of songs.slice(0, 8)) {
        try {
            const tracks = await searchDeezer(`${song.title} ${song.artist}`, 'track', 1);
            if (tracks.length > 0) found.push(tracks[0]);
        } catch(e) { console.error(e); }
    }
    if (found.length > 0) {
        currentSongs = found; currentIndex = 0; currentPlaylist = null;
        playSong(found[0]);
        showNotification(`✦ Playing DJ playlist — ${found.length} songs`);
    } else {
        showNotification("Couldn't find those songs");
    }
}

async function addDJSongsToQueue(songs) {
    showNotification(`✦ Adding ${songs.length} songs to queue...`);
    for (const song of songs.slice(0, 6)) {
        try {
            const tracks = await searchDeezer(`${song.title} ${song.artist}`, 'track', 1);
            if (tracks.length > 0) addToQueue(tracks[0]);
        } catch(e) { console.error(e); }
    }
    showNotification(`✦ Added to queue!`);
}

// ─────────────────────────────────────────────
// INJECT STYLES
// ─────────────────────────────────────────────

const djStyle = document.createElement('style');
djStyle.textContent = `
    @keyframes djDot {
        0%,100% { opacity:0.3; transform:translateY(0); }
        50% { opacity:1; transform:translateY(-3px); }
    }
`;
document.head.appendChild(djStyle);

setTimeout(() => { initAIDJ(); }, 1000);

window.openAIDJ = openAIDJ;
window.closeAIDJ = closeAIDJ;
window.startDJSession = startDJSession;
window.sendDJMessage = sendDJMessage;
window.showDJSessions = showDJSessions;
window.showDJHome = showDJHome;
window.loadDJSession = loadDJSession;
window.deleteDJSession = deleteDJSession;
window.searchAndPlayDJPlaylist = searchAndPlayDJPlaylist;
window.addDJSongsToQueue = addDJSongsToQueue;


// ============================================
// NEW FEATURE 1: MOOD DETECTOR
// Analyzes recent plays and shows a mood card
// ============================================

function openMoodDetector() {
    if (recent.length < 3) {
        showNotification('Play a few songs first so I can read your mood!');
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'moodOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="
            width:100%;max-width:460px;
            background:rgba(18,18,18,0.98);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:16px;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.8);
        ">
            <div style="padding:22px 24px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-family:'Syne',sans-serif;font-size:17px;font-weight:800;">Mood Detector</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:1px;">Based on your recent plays</div>
                </div>
                <button onclick="document.getElementById('moodOverlay').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">×</button>
            </div>

            <div id="moodContent" style="padding:28px 24px;text-align:center;">
                <div style="font-size:48px;margin-bottom:4px;">🔍</div>
                <div style="color:rgba(255,255,255,0.4);font-size:14px;">Analyzing your vibe...</div>
            </div>

            <div style="padding:0 24px 22px;display:flex;gap:8px;" id="moodActions" style="display:none;"></div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.opacity = '1'; }, 20);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Analyze via AI
    analyzeMoodWithAI();
}

async function analyzeMoodWithAI() {
    const songs = recent.slice(0, 8).map(s => `"${s.title}" by ${s.artist}`).join(', ');

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{
                    role: 'user',
                    content: `Analyze the mood of these recently played songs: ${songs}. 
Reply ONLY as JSON: { "emoji": "one emoji", "mood": "2-3 word mood label", "description": "one sentence", "color": "a css hex color that matches the mood", "suggestion": "one short sentence suggestion for what to play next" }`
                }],
                temperature: 0.7,
                max_tokens: 200
            })
        });

        const data = await res.json();
        let text = data.choices?.[0]?.message?.content || '';
        text = text.replace(/```json|```/g, '').trim();
        const mood = JSON.parse(text);

        const content = document.getElementById('moodContent');
        const actions = document.getElementById('moodActions');
        if (!content) return;

        content.innerHTML = `
            <div style="
                width:90px;height:90px;border-radius:50%;
                background:${mood.color}22;
                border:2px solid ${mood.color}55;
                display:flex;align-items:center;justify-content:center;
                font-size:44px;margin:0 auto 20px;
            ">${mood.emoji}</div>
            <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;margin-bottom:8px;">${mood.mood}</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6;margin-bottom:16px;">${mood.description}</div>
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 16px;font-size:13px;color:rgba(255,255,255,0.5);">
                💡 ${mood.suggestion}
            </div>
        `;

        actions.style.display = 'flex';
        actions.innerHTML = `
            <button onclick="document.getElementById('moodOverlay').remove(); openAIDJ(); setTimeout(() => startDJSession('vibe'), 400);" style="
                flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);
                border-radius:10px;color:var(--text);padding:12px;font-size:14px;font-weight:600;
                cursor:pointer;transition:all 0.2s ease;
            " onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">✦ Build Vibe Playlist</button>
            <button onclick="document.getElementById('moodOverlay').remove()" style="
                background:transparent;border:1px solid rgba(255,255,255,0.08);
                border-radius:10px;color:rgba(255,255,255,0.5);padding:12px 20px;
                font-size:14px;cursor:pointer;transition:all 0.2s ease;
            " onmouseover="this.style.borderColor='rgba(255,255,255,0.15)';this.style.color='white'" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)';this.style.color='rgba(255,255,255,0.5)'">Close</button>
        `;

    } catch (err) {
        const content = document.getElementById('moodContent');
        if (content) content.innerHTML = `<div style="color:rgba(255,255,255,0.4);font-size:14px;padding:20px 0;">Couldn't analyze mood right now.</div>`;
        console.error('Mood error:', err);
    }
}

window.openMoodDetector = openMoodDetector;
console.log('✓ Mood Detector loaded');


// ============================================
// NEW FEATURE 2: LISTENING RECAP
// A weekly summary modal — no AI needed
// ============================================

function openListeningRecap() {
    const topArtists = {};
    recent.forEach(s => {
        if (s.artist) topArtists[s.artist] = (topArtists[s.artist] || 0) + 1;
    });

    const sortedArtists = Object.entries(topArtists)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const totalSongs   = listeningStats.songsPlayed  || 0;
    const totalMinutes = listeningStats.totalMinutes  || 0;
    const totalAlbums  = Object.keys(savedAlbums).length;
    const streak       = load('play_streak', { count: 0 }).count;

const overlay = document.createElement('div');
overlay.id = 'listeningRecapOverlay';   // ← add this line
overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="
            width:100%;max-width:500px;
            background:rgba(18,18,18,0.98);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:16px;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.8);
        ">
            <div style="padding:22px 24px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-family:'Syne',sans-serif;font-size:17px;font-weight:800;">Your Listening Recap</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:1px;">All time on this device</div>
                </div>
               <button onclick="this.closest('div[style*=position\\:fixed]').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">×</button>
            </div>

            <!-- Big stats -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid rgba(255,255,255,0.06);">
                ${[
                    [totalSongs, 'Songs Played'],
                    [Math.floor(totalMinutes / 60) + 'h', 'Listened'],
                    [streak + ' day' + (streak !== 1 ? 's' : ''), 'Streak'],
                ].map(([val, label]) => `
                    <div style="padding:22px 16px;text-align:center;border-right:1px solid rgba(255,255,255,0.06);">
                        <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;margin-bottom:4px;">${val}</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">${label}</div>
                    </div>
                `).join('')}
            </div>

            <!-- Top Artists -->
            <div style="padding:20px 24px;">
                <div style="font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;font-weight:600;">Top Artists</div>
                ${sortedArtists.length === 0
                    ? `<div style="color:rgba(255,255,255,0.3);font-size:14px;">No data yet — play some music!</div>`
                    : sortedArtists.map(([artist, count], i) => `
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                            <span style="font-size:13px;color:rgba(255,255,255,0.3);min-width:18px;text-align:right;">${i + 1}</span>
                            <div style="flex:1;background:rgba(255,255,255,0.04);border-radius:6px;height:36px;position:relative;overflow:hidden;">
                                <div style="
                                    position:absolute;left:0;top:0;bottom:0;
                                    width:${Math.round((count / (sortedArtists[0][1] || 1)) * 100)}%;
                                    background:rgba(255,255,255,0.07);
                                    border-radius:6px;transition:width 0.8s ease;
                                "></div>
                                <span style="position:relative;padding:0 12px;line-height:36px;font-size:14px;font-weight:600;">${artist}</span>
                            </div>
                            <span style="font-size:12px;color:rgba(255,255,255,0.35);min-width:30px;text-align:right;">${count}x</span>
                        </div>
                    `).join('')
                }
            </div>

            <!-- Footer -->
            <div style="padding:0 24px 22px;">
                <button onclick="shareSongCard(null); document.getElementById('listeningRecapOverlay').remove()" style="
                    width:100%;background:rgba(255,255,255,0.06);
                    border:1px solid rgba(255,255,255,0.1);
                    border-radius:10px;color:var(--text);
                    padding:12px;font-size:14px;font-weight:600;
                    cursor:pointer;transition:all 0.2s ease;
                " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">📋 Copy Stats to Clipboard</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.opacity = '1'; }, 20);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

window.openListeningRecap = openListeningRecap;
console.log('✓ Listening Recap loaded');


// ============================================
// NEW FEATURE 3: QUICK PLAYLIST BUILDER
// Type a vibe, AI names and fills the playlist
// ============================================

function openQuickPlaylistBuilder() {
    const overlay = document.createElement('div');
    overlay.id = 'qpbOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="
            width:100%;max-width:520px;
            background:rgba(18,18,18,0.98);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:16px;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.8);
        ">
            <div style="padding:22px 24px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-family:'Syne',sans-serif;font-size:17px;font-weight:800;">Quick Playlist Builder</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:1px;">Describe a vibe, AI does the rest</div>
                </div>
                <button onclick="document.getElementById('qpbOverlay').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">×</button>
            </div>

            <!-- Prompt suggestions -->
            <div style="padding:20px 24px 0;">
                <div style="font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;font-weight:600;">Try one of these</div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;">
                    ${['Late night drive 🌙','Gym energy ⚡','Rainy afternoon ☔','Summer road trip 🚗','Focus & study 📚','Feel-good Friday 🎉'].map(v => `
                        <button onclick="document.getElementById('qpbInput').value='${v}'" style="
                            background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
                            border-radius:20px;padding:6px 14px;color:rgba(255,255,255,0.7);
                            font-size:13px;cursor:pointer;transition:all 0.2s ease;
                        " onmouseover="this.style.background='rgba(255,255,255,0.08)';this.style.color='white'" onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='rgba(255,255,255,0.7)'">${v}</button>
                    `).join('')}
                </div>

                <input id="qpbInput" type="text" placeholder="Or describe your own vibe..." style="
                    width:100%;background:rgba(255,255,255,0.05);
                    border:1px solid rgba(255,255,255,0.1);
                    border-radius:10px;padding:13px 16px;
                    color:var(--text);font-size:14px;outline:none;
                    transition:border-color 0.2s ease;
                    font-family:'DM Sans',sans-serif;margin-bottom:10px;
                " onfocus="this.style.borderColor='rgba(255,255,255,0.25)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'" onkeypress="if(event.key==='Enter') buildQuickPlaylist()">
            </div>

            <div id="qpbResult" style="padding:0 24px;min-height:0;transition:all 0.3s ease;"></div>

            <div style="padding:14px 24px 22px;display:flex;gap:8px;">
                <button onclick="buildQuickPlaylist()" id="qpbBuildBtn" style="
                    flex:1;background:rgba(255,255,255,0.1);
                    border:1px solid rgba(255,255,255,0.15);
                    border-radius:10px;color:var(--text);
                    padding:12px;font-size:14px;font-weight:600;
                    cursor:pointer;transition:all 0.2s ease;
                " onmouseover="this.style.background='rgba(255,255,255,0.16)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">✦ Build Playlist</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.opacity = '1'; overlay.querySelector('#qpbInput').focus(); }, 20);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function buildQuickPlaylist() {
    const input = document.getElementById('qpbInput');
    const vibe = input?.value.trim();
    if (!vibe) { showNotification('Describe a vibe first!'); return; }

    const result = document.getElementById('qpbResult');
    const btn = document.getElementById('qpbBuildBtn');
    if (btn) btn.textContent = 'Building...';
    if (result) result.innerHTML = `<div style="text-align:center;padding:20px 0;color:rgba(255,255,255,0.35);font-size:14px;">✦ Asking AI...</div>`;

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{
                    role: 'user',
                    content: `Create a playlist for this vibe: "${vibe}". 
Reply ONLY as JSON: { "name": "short playlist name", "emoji": "one emoji", "songs": [{"title": "...", "artist": "..."}] } 
Include exactly 8 songs. No markdown, no extra text.`
                }],
                temperature: 0.9,
                max_tokens: 400
            })
        });

        const data = await res.json();
        let text = data.choices?.[0]?.message?.content || '';
        text = text.replace(/```json|```/g, '').trim();
        const playlist = JSON.parse(text);

        if (result) {
            result.innerHTML = `
                <div style="
                    background:rgba(255,255,255,0.04);
                    border:1px solid rgba(255,255,255,0.08);
                    border-radius:10px;padding:16px;margin-bottom:14px;
                ">
                    <div style="font-size:22px;margin-bottom:6px;">${playlist.emoji}</div>
                    <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;margin-bottom:12px;">${playlist.name}</div>
                    <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
                        ${playlist.songs.map((s, i) => `
                            <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
                                <span style="color:rgba(255,255,255,0.25);min-width:18px;">${i + 1}</span>
                                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.title}</span>
                                <span style="color:rgba(255,255,255,0.4);white-space:nowrap;">${s.artist}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:6px;">
                    <button onclick="saveAndPlayQPBPlaylist(${JSON.stringify(playlist).replace(/"/g,'&quot;')})" style="flex:1;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:var(--text);padding:11px;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s ease;" onmouseover="this.style.background='rgba(255,255,255,0.16)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">▶ Play Now</button>
                    <button onclick="saveQPBToLibrary(${JSON.stringify(playlist).replace(/"/g,'&quot;')})" style="background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:rgba(255,255,255,0.6);padding:11px 16px;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s ease;" onmouseover="this.style.borderColor='rgba(255,255,255,0.2)';this.style.color='white'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.color='rgba(255,255,255,0.6)'">+ Save</button>
                </div>
            `;
        }
        if (btn) btn.textContent = '✦ Rebuild';

    } catch (err) {
        if (result) result.innerHTML = `<div style="color:rgba(255,255,255,0.4);font-size:14px;padding:16px 0;">Couldn't build playlist right now.</div>`;
        if (btn) btn.textContent = '✦ Build Playlist';
        console.error('QPB error:', err);
    }
}

async function saveAndPlayQPBPlaylist(playlist) {
    document.getElementById('qpbOverlay')?.remove();
    showNotification(`✦ Finding songs for "${playlist.name}"...`);
    const found = [];
    for (const song of playlist.songs.slice(0, 8)) {
        try {
            const tracks = await searchDeezer(`${song.title} ${song.artist}`, 'track', 1);
            if (tracks.length > 0) found.push(tracks[0]);
        } catch(e) { console.error(e); }
    }
    if (found.length > 0) {
        currentSongs = found; currentIndex = 0; currentPlaylist = null;
        playSong(found[0]);
        showNotification(`${playlist.emoji} Playing "${playlist.name}"`);
    }
}

function saveQPBToLibrary(playlist) {
    const name = `${playlist.emoji} ${playlist.name}`;
    if (playlists[name]) { showNotification('Playlist already saved!'); return; }
    playlists[name] = { emoji: playlist.emoji, songs: [] };
    save('playlists', playlists);
    renderPlaylists();
    showNotification(`Saved "${name}" to library — songs will load when you play it`);
    document.getElementById('qpbOverlay')?.remove();
}

window.openQuickPlaylistBuilder = openQuickPlaylistBuilder;
window.buildQuickPlaylist = buildQuickPlaylist;
window.saveAndPlayQPBPlaylist = saveAndPlayQPBPlaylist;
window.saveQPBToLibrary = saveQPBToLibrary;
console.log('✓ Quick Playlist Builder loaded');


// ============================================
// NEW FEATURE 4: SONG RADIO INFO CARD
// Right-click a song → "What is this?" card
// Pulls AI-generated trivia about the track
// ============================================

function openSongInfoCard(song) {
    if (!song) song = currentPlayingSong;
    if (!song) { showNotification('Nothing playing right now'); return; }

    const overlay = document.createElement('div');
    overlay.id = 'songInfoOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="
            width:100%;max-width:480px;
            background:rgba(18,18,18,0.98);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:16px;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.8);
        ">
            <!-- Song header -->
            <div style="display:flex;align-items:center;gap:16px;padding:22px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
                <img src="${song.art || ''}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,0.05);">
                <div style="flex:1;min-width:0;">
                    <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${song.title}</div>
                    <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:2px;">${song.artist}</div>
                </div>
                <button onclick="document.getElementById('songInfoOverlay').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">×</button>
            </div>

            <div id="songInfoContent" style="padding:24px;text-align:center;">
                <div style="color:rgba(255,255,255,0.3);font-size:14px;">Loading info...</div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.opacity = '1'; }, 20);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    fetchSongInfo(song);
}

async function fetchSongInfo(song) {
    const content = document.getElementById('songInfoContent');

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{
                    role: 'user',
                    content: `Tell me about the song "${song.title}" by ${song.artist}. 
Reply ONLY as JSON: {
  "year": "release year or decade",
  "genre": "main genre",
  "mood": "2-3 word mood",
  "fact": "one genuinely interesting fact about the song or artist (1-2 sentences)",
  "similar": ["Artist One", "Artist Two", "Artist Three"]
}`
                }],
                temperature: 0.7,
                max_tokens: 300
            })
        });

        const data = await res.json();
        let text = data.choices?.[0]?.message?.content || '';
        text = text.replace(/```json|```/g, '').trim();
        const info = JSON.parse(text);

        if (!content) return;
        content.style.textAlign = 'left';
        content.innerHTML = `
            <!-- Tags row -->
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
                ${[info.year, info.genre, info.mood].filter(Boolean).map(tag => `
                    <span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:5px 12px;font-size:13px;font-weight:500;">${tag}</span>
                `).join('')}
            </div>

            <!-- Fact -->
            <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-weight:600;">Did you know</div>
                <div style="font-size:14px;color:rgba(255,255,255,0.8);line-height:1.7;">${info.fact}</div>
            </div>

            <!-- Similar artists -->
            <div>
                <div style="font-size:11px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;font-weight:600;">You might also like</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${(info.similar || []).map(artist => `
                        <button onclick="searchArtistSongs('${artist.replace(/'/g,"\\'")}'); document.getElementById('songInfoOverlay')?.remove();" style="
                            background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
                            border-radius:20px;padding:7px 14px;color:rgba(255,255,255,0.7);
                            font-size:13px;cursor:pointer;transition:all 0.2s ease;
                        " onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='white'" onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='rgba(255,255,255,0.7)'">${artist}</button>
                    `).join('')}
                </div>
            </div>
        `;

    } catch (err) {
        if (content) content.innerHTML = `<div style="color:rgba(255,255,255,0.4);font-size:14px;">Couldn't load song info right now.</div>`;
        console.error('Song info error:', err);
    }
}

window.openSongInfoCard = openSongInfoCard;
// Add to context menu — in contextMenuAction add: case 'info': openSongInfoCard(contextMenuTarget); break;
// Add to context menu HTML: <div class="context-menu-item" onclick="contextMenuAction('info')"><span>ℹ️</span> Song Info</div>
console.log('✓ Song Info Card loaded');


// ============================================
// NEW FEATURE 5: DAILY MIX GENERATOR
// One tap → fresh daily mix, cached per day
// ============================================

function openDailyMix() {
    const today = new Date().toDateString();
    const cached = load('daily_mix_cache', null);

    const overlay = document.createElement('div');
    overlay.id = 'dailyMixOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="
            width:100%;max-width:500px;
            background:rgba(18,18,18,0.98);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:16px;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.8);
        ">
            <div style="padding:22px 24px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-family:'Syne',sans-serif;font-size:17px;font-weight:800;">Daily Mix</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:1px;" id="dailyMixSubtitle">Fresh for ${today}</div>
                </div>
                <button onclick="document.getElementById('dailyMixOverlay').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">×</button>
            </div>

            <div id="dailyMixContent" style="padding:24px;">
                <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:14px;">Building your mix...</div>
            </div>

            <div style="padding:0 24px 22px;display:flex;gap:8px;" id="dailyMixActions"></div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.opacity = '1'; }, 20);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    if (cached && cached.date === today && cached.songs?.length > 0) {
        renderDailyMixResult(cached.songs, cached.theme, true);
    } else {
        generateDailyMix();
    }
}

async function generateDailyMix() {
    const today = new Date().toDateString();
    const context = buildMusicContext();

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{
                    role: 'user',
                    content: `${context}

Create a daily mix for today. Pick a theme based on the time of day and my taste.
Reply ONLY as JSON: {
  "theme": "short theme name",
  "description": "one sentence",
  "songs": [{"title": "...", "artist": "..."}]
}
Include exactly 10 songs. No markdown.`
                }],
                temperature: 0.9,
                max_tokens: 500
            })
        });

        const data = await res.json();
        let text = data.choices?.[0]?.message?.content || '';
        text = text.replace(/```json|```/g, '').trim();
        const mix = JSON.parse(text);

        save('daily_mix_cache', { date: today, songs: mix.songs, theme: mix.theme, description: mix.description });
        renderDailyMixResult(mix.songs, mix.theme, false, mix.description);

    } catch (err) {
        const content = document.getElementById('dailyMixContent');
        if (content) content.innerHTML = `<div style="color:rgba(255,255,255,0.4);font-size:14px;text-align:center;">Couldn't generate mix right now.</div>`;
        console.error('Daily mix error:', err);
    }
}

function renderDailyMixResult(songs, theme, fromCache, description = '') {
    const content = document.getElementById('dailyMixContent');
    const actions = document.getElementById('dailyMixActions');
    if (!content) return;

    content.innerHTML = `
        ${description ? `<div style="font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:18px;line-height:1.5;">${description}</div>` : ''}
        ${fromCache ? `<div style="display:inline-block;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:4px 12px;font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:16px;">Cached today ·  refreshes tomorrow</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:7px;max-height:260px;overflow-y:auto;">
            ${songs.map((s, i) => `
                <div style="
                    display:flex;align-items:center;gap:12px;
                    padding:10px 12px;
                    background:rgba(255,255,255,0.03);
                    border:1px solid rgba(255,255,255,0.06);
                    border-radius:8px;font-size:14px;
                ">
                    <span style="color:rgba(255,255,255,0.25);font-size:12px;min-width:18px;">${i + 1}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.title}</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.4);">${s.artist}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    if (actions) {
        actions.innerHTML = `
            <button onclick="playDailyMix()" style="flex:1;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:var(--text);padding:12px;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s ease;" onmouseover="this.style.background='rgba(255,255,255,0.16)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">▶ Play Mix</button>
            <button onclick="save('daily_mix_cache', null); generateDailyMix();" style="background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:rgba(255,255,255,0.5);padding:12px 16px;font-size:13px;cursor:pointer;transition:all 0.2s ease;" onmouseover="this.style.borderColor='rgba(255,255,255,0.2)';this.style.color='white'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.color='rgba(255,255,255,0.5)'" title="Regenerate">↺</button>
        `;
    }
}

async function playDailyMix() {
    const cached = load('daily_mix_cache', null);
    if (!cached?.songs) return;
    document.getElementById('dailyMixOverlay')?.remove();
    showNotification(`✦ Loading Daily Mix...`);
    const found = [];
    for (const song of cached.songs.slice(0, 10)) {
        try {
            const tracks = await searchDeezer(`${song.title} ${song.artist}`, 'track', 1);
            if (tracks.length > 0) found.push(tracks[0]);
        } catch(e) { console.error(e); }
    }
    if (found.length > 0) {
        currentSongs = found; currentIndex = 0; currentPlaylist = null;
        playSong(found[0]);
        showNotification(`🎵 Daily Mix — ${found.length} songs`);
    }
}

window.openDailyMix = openDailyMix;
window.generateDailyMix = generateDailyMix;
window.playDailyMix = playDailyMix;
console.log('✓ Daily Mix loaded');


// ============================================
// INDY MUSIC - FIREBASE AUTH & SYNC MODULE
// Drop this at the bottom of script.js
// ============================================

// ── CONFIG ──────────────────────────────────
// Replace these with your own Firebase project config
// (Firebase Console → Project Settings → Your Apps → SDK setup)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC50_wBK3TfERX1gm35puugCD324SxHJR8",
  authDomain: "tunesandindy.firebaseapp.com",
  projectId: "tunesandindy",
  storageBucket: "tunesandindy.firebasestorage.app",
  messagingSenderId: "335192973371",
  appId: "1:335192973371:web:ce69d4b67c765d6aaf7c1e",
  measurementId: "G-5MQG01VZ6H"
};

// ── STATE ────────────────────────────────────
let fbApp = null;
let fbAuth = null;
let fbDb = null;
let currentUser = null;
let syncDebounceTimer = null;

// Keys that get synced to Firebase
const SYNC_KEYS = [
    { local: 'playlists',        fb: 'playlists' },
    { local: 'recent',           fb: 'recent' },
    { local: 'indy_saved_albums',fb: 'savedAlbums' },
    { local: 'indy_saved_artists',fb: 'savedArtists' },
    { local: 'listening_stats',  fb: 'listeningStats' },
    { local: 'queue',            fb: 'queue' },
    { local: 'dj_sessions',      fb: 'djSessions' },
];

// ── INIT ─────────────────────────────────────

async function initFirebase() {
    // Dynamically load Firebase SDKs (no bundler needed)
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js');

    if (!firebase.apps.length) {
        fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    } else {
        fbApp = firebase.apps[0];
    }

    fbAuth = firebase.auth();
    fbDb   = firebase.firestore();

    // Listen for auth state changes
    fbAuth.onAuthStateChanged(user => {
        currentUser = user;
        if (user) {
            onUserSignedIn(user);
        } else {
            onUserSignedOut();
        }
    });

    // Inject UI
    injectAuthUI();

    console.log('✓ Firebase initialized');
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ── AUTH HANDLERS ────────────────────────────

async function onUserSignedIn(user) {
    console.log('Signed in:', user.email || user.uid);
    updateAuthButton();

    // Pull data from Firebase and merge into localStorage
    try {
        const doc = await fbDb.collection('users').doc(user.uid).get();
        if (doc.exists) {
            const data = doc.data();
            mergeFirebaseDataIntoLocal(data);
        } else {
            // First sign-in: push existing localStorage to Firebase
            await pushLocalToFirebase();
            showNotification(`Account created! Your data is now synced ☁️`);
        }
    } catch (err) {
        console.error('Error loading user data:', err);
    }

    // Start auto-sync: patch localStorage.setItem to trigger sync on writes
    patchLocalStorageForSync();
}

function onUserSignedOut() {
    console.log('Signed out');
    updateAuthButton();
    unpatchLocalStorage();
}

// ── DATA SYNC ────────────────────────────────

async function pushLocalToFirebase() {
    if (!currentUser) return;
    const payload = {};
    SYNC_KEYS.forEach(({ local, fb }) => {
        const val = localStorage.getItem(local);
        if (val) {
            try { payload[fb] = JSON.parse(val); }
            catch(e) { /* skip malformed */ }
        }
    });
    await fbDb.collection('users').doc(currentUser.uid).set(payload, { merge: true });
    console.log('✓ Pushed local data to Firebase');
}

function mergeFirebaseDataIntoLocal(fbData) {
    SYNC_KEYS.forEach(({ local, fb }) => {
        if (!fbData[fb]) return;
        const remote = fbData[fb];
        let merged;

        if (Array.isArray(remote)) {
            // Arrays: merge by id, remote wins for conflicts
            const local_arr = JSON.parse(localStorage.getItem(local) || '[]');
            const localIds = new Set(local_arr.map(i => i?.id || JSON.stringify(i)));
            merged = [...local_arr, ...remote.filter(i => !localIds.has(i?.id || JSON.stringify(i)))];
        } else if (typeof remote === 'object') {
            // Objects: deep merge, remote wins
            const local_obj = JSON.parse(localStorage.getItem(local) || '{}');
            merged = deepMerge(local_obj, remote);
        } else {
            merged = remote;
        }

        localStorage.setItem(local, JSON.stringify(merged));
    });

    // Reload app state from updated localStorage
    reloadAppState();
}

function deepMerge(local, remote) {
    const result = { ...local };
    for (const key in remote) {
        if (key in local && typeof local[key] === 'object' && !Array.isArray(local[key])) {
            result[key] = deepMerge(local[key], remote[key]);
        } else {
            result[key] = remote[key];
        }
    }
    return result;
}

// Debounced push so rapid writes don't spam Firestore
function scheduleSyncToFirebase() {
    if (!currentUser) return;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
        pushLocalToFirebase().catch(console.error);
    }, 2000); // 2s debounce
}

// Monkey-patch localStorage.setItem so any write auto-syncs
const _origSetItem = localStorage.setItem.bind(localStorage);
let _patchActive = false;

function patchLocalStorageForSync() {
    if (_patchActive) return;
    _patchActive = true;
    localStorage.setItem = function(key, value) {
        _origSetItem(key, value);
        const syncKey = SYNC_KEYS.find(k => k.local === key);
        if (syncKey && currentUser) scheduleSyncToFirebase();
    };
}

function unpatchLocalStorage() {
    localStorage.setItem = _origSetItem;
    _patchActive = false;
}

// Reload all app global variables from localStorage after merge
function reloadAppState() {
    // These reference the globals defined in script.js
    try { recent = JSON.parse(localStorage.getItem('recent') || '[]'); } catch(e) {}
    try { playlists = JSON.parse(localStorage.getItem('playlists') || '{}'); } catch(e) {}
    try { liked = playlists['Liked Songs']?.songs || []; } catch(e) {}
    try { savedAlbums = JSON.parse(localStorage.getItem('indy_saved_albums') || '{}'); } catch(e) {}
    try { savedArtists = JSON.parse(localStorage.getItem('indy_saved_artists') || '{}'); } catch(e) {}
    try { listeningStats = JSON.parse(localStorage.getItem('listening_stats') || '{}'); } catch(e) {}
    try { queue = JSON.parse(localStorage.getItem('queue') || '[]'); } catch(e) {}

    // Re-render UI
    try { renderRecent(); } catch(e) {}
    try { renderPlaylists(); } catch(e) {}
    try { renderLibrary(); } catch(e) {}
    try { updateLikedCount(); } catch(e) {}
    try { updateFilterCounts(); } catch(e) {}
    try { updateStats(); } catch(e) {}
}

// ── AUTH UI ──────────────────────────────────

function injectAuthUI() {
    const linkBtn = document.getElementById('linkBtn');
    if (!linkBtn) return;

    // Force nav-right to be a horizontal row
    const navRight = linkBtn.parentNode;
    navRight.style.display = 'flex';
    navRight.style.flexDirection = 'row';
    navRight.style.alignItems = 'center';

    const authBtn = document.createElement('button');
    authBtn.id = 'authNavBtn';
    authBtn.onclick = openAuthModal;
    authBtn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: var(--text);
        padding: 10px 22px;
        border-radius: 40px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-right: 8px;
        font-family: 'DM Sans', sans-serif;
    `;
    authBtn.onmouseover = () => { authBtn.style.background = 'rgba(255,255,255,0.1)'; };
    authBtn.onmouseout  = () => { authBtn.style.background = 'rgba(255,255,255,0.05)'; };

    linkBtn.parentNode.insertBefore(authBtn, linkBtn);
    updateAuthButton();
}

function updateAuthButton() {
    const btn = document.getElementById('authNavBtn');
    if (!btn) return;
    if (currentUser) {
        const initial = (currentUser.email || '?').charAt(0).toUpperCase();
        btn.innerHTML = `
            <span style="
                width:24px;height:24px;border-radius:50%;
                background:rgba(255,255,255,0.15);
                display:inline-flex;align-items:center;justify-content:center;
                font-size:12px;font-weight:700;
            ">${initial}</span>
            <span>${currentUser.email?.split('@')[0] || 'Account'}</span>
        `;
        btn.title = 'Account settings';
        btn.onclick = openAccountModal;
    } else {
        btn.innerHTML = `<span>☁</span> Sign In`;
        btn.title = 'Sign in to sync your data';
        btn.onclick = openAuthModal;
    }
}

// ── AUTH MODAL ───────────────────────────────

function openAuthModal() {
    closeAuthModal();

    const overlay = document.createElement('div');
    overlay.id = 'authOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:999999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    overlay.innerHTML = `
        <div style="
            width:100%;max-width:420px;
            background:rgba(18,18,18,0.99);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:20px;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.9);
            font-family:'DM Sans',sans-serif;
        ">
            <!-- Header -->
            <div style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:32px;margin-bottom:10px;">✦</div>
                <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px;">
                    Sync Your Music
                </div>
                <div style="font-size:14px;color:rgba(255,255,255,0.4);line-height:1.5;">
                    Sign in to back up your playlists, liked songs,<br>and listening history across devices.
                </div>
            </div>

            <!-- Tab switcher -->
            <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.06);">
                <button id="authTabSignIn" onclick="switchAuthTab('signin')" style="
                    flex:1;padding:14px;background:transparent;border:none;
                    color:rgba(255,255,255,0.9);font-size:14px;font-weight:600;
                    cursor:pointer;border-bottom:2px solid white;
                    transition:all 0.2s;font-family:'DM Sans',sans-serif;
                ">Sign In</button>
                <button id="authTabSignUp" onclick="switchAuthTab('signup')" style="
                    flex:1;padding:14px;background:transparent;border:none;
                    color:rgba(255,255,255,0.4);font-size:14px;font-weight:600;
                    cursor:pointer;border-bottom:2px solid transparent;
                    transition:all 0.2s;font-family:'DM Sans',sans-serif;
                ">Sign Up</button>
            </div>

            <!-- Form -->
            <div style="padding:24px 28px;">
                <div id="authError" style="
                    display:none;background:rgba(255,80,80,0.15);
                    border:1px solid rgba(255,80,80,0.3);border-radius:10px;
                    padding:10px 14px;font-size:13px;color:#ff8080;
                    margin-bottom:16px;
                "></div>

                <div style="margin-bottom:14px;">
                    <label style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;font-weight:600;display:block;margin-bottom:6px;">Email</label>
                    <input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" style="
                        width:100%;padding:13px 15px;
                        background:rgba(255,255,255,0.05);
                        border:1px solid rgba(255,255,255,0.1);
                        border-radius:10px;color:white;font-size:14px;outline:none;
                        transition:border-color 0.2s;box-sizing:border-box;
                        font-family:'DM Sans',sans-serif;
                    " onfocus="this.style.borderColor='rgba(255,255,255,0.3)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'" onkeypress="if(event.key==='Enter')document.getElementById('authPassword').focus()">
                </div>

                <div style="margin-bottom:20px;">
                    <label style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;font-weight:600;display:block;margin-bottom:6px;">Password</label>
                    <input id="authPassword" type="password" placeholder="••••••••" autocomplete="current-password" style="
                        width:100%;padding:13px 15px;
                        background:rgba(255,255,255,0.05);
                        border:1px solid rgba(255,255,255,0.1);
                        border-radius:10px;color:white;font-size:14px;outline:none;
                        transition:border-color 0.2s;box-sizing:border-box;
                        font-family:'DM Sans',sans-serif;
                    " onfocus="this.style.borderColor='rgba(255,255,255,0.3)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'" onkeypress="if(event.key==='Enter')submitAuth()">
                </div>

                <button id="authSubmitBtn" onclick="submitAuth()" style="
                    width:100%;padding:14px;
                    background:linear-gradient(135deg, #ffffff, #e0e0e0);
                    border:none;border-radius:10px;color:#000;
                    font-size:15px;font-weight:700;cursor:pointer;
                    transition:all 0.2s ease;margin-bottom:14px;
                    font-family:'DM Sans',sans-serif;
                " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                    Sign In
                </button>

                <button onclick="submitForgotPassword()" id="forgotPasswordBtn" style="
                    width:100%;padding:10px;background:transparent;
                    border:none;color:rgba(255,255,255,0.35);font-size:13px;
                    cursor:pointer;transition:color 0.2s;font-family:'DM Sans',sans-serif;
                " onmouseover="this.style.color='rgba(255,255,255,0.7)'" onmouseout="this.style.color='rgba(255,255,255,0.35)'">
                    Forgot password?
                </button>
            </div>

            <!-- Footer -->
            <div style="padding:0 28px 24px;display:flex;justify-content:center;">
                <button onclick="closeAuthModal()" style="
                    background:transparent;border:none;
                    color:rgba(255,255,255,0.25);font-size:13px;
                    cursor:pointer;transition:color 0.2s;font-family:'DM Sans',sans-serif;
                " onmouseover="this.style.color='rgba(255,255,255,0.5)'" onmouseout="this.style.color='rgba(255,255,255,0.25)'">
                    Not now
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => {
        overlay.style.opacity = '1';
        document.getElementById('authEmail')?.focus();
    }, 20);

    overlay.addEventListener('click', e => { if (e.target === overlay) closeAuthModal(); });
    document.addEventListener('keydown', authEscHandler);
}

function authEscHandler(e) {
    if (e.key === 'Escape') {
        closeAuthModal();
        document.removeEventListener('keydown', authEscHandler);
    }
}

function closeAuthModal() {
    const overlay = document.getElementById('authOverlay');
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
    document.removeEventListener('keydown', authEscHandler);
}

let authMode = 'signin'; // 'signin' | 'signup'

function switchAuthTab(mode) {
    authMode = mode;
    const isSignUp = mode === 'signup';

    const tabSignIn = document.getElementById('authTabSignIn');
    const tabSignUp = document.getElementById('authTabSignUp');
    const submitBtn = document.getElementById('authSubmitBtn');
    const forgotBtn = document.getElementById('forgotPasswordBtn');

    if (tabSignIn) {
        tabSignIn.style.color = isSignUp ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.9)';
        tabSignIn.style.borderBottom = isSignUp ? '2px solid transparent' : '2px solid white';
    }
    if (tabSignUp) {
        tabSignUp.style.color = isSignUp ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
        tabSignUp.style.borderBottom = isSignUp ? '2px solid white' : '2px solid transparent';
    }
    if (submitBtn) submitBtn.textContent = isSignUp ? 'Create Account & Sync Data' : 'Sign In';
    if (forgotBtn) forgotBtn.style.display = isSignUp ? 'none' : 'block';

    clearAuthError();
}

function clearAuthError() {
    const err = document.getElementById('authError');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
}

function showAuthError(msg) {
    const err = document.getElementById('authError');
    if (err) { err.style.display = 'block'; err.textContent = msg; }
}

async function submitAuth() {
    const email    = document.getElementById('authEmail')?.value.trim();
    const password = document.getElementById('authPassword')?.value;
    const btn      = document.getElementById('authSubmitBtn');

    if (!email || !password) { showAuthError('Please fill in both fields.'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }

    clearAuthError();
    if (btn) { btn.textContent = 'Please wait...'; btn.disabled = true; }

    try {
        if (authMode === 'signup') {
            await fbAuth.createUserWithEmailAndPassword(email, password);
        } else {
            await fbAuth.signInWithEmailAndPassword(email, password);
        }
        closeAuthModal();
    } catch (err) {
        const messages = {
            'auth/user-not-found':      'No account found with that email.',
            'auth/wrong-password':      'Incorrect password.',
            'auth/email-already-in-use':'An account already exists with this email.',
            'auth/invalid-email':       'Please enter a valid email address.',
            'auth/weak-password':       'Password must be at least 6 characters.',
            'auth/too-many-requests':   'Too many attempts. Please try again later.',
            'auth/network-request-failed': 'Network error. Check your connection.',
        };
        showAuthError(messages[err.code] || err.message || 'Something went wrong.');
        if (btn) { btn.textContent = authMode === 'signup' ? 'Create Account & Sync Data' : 'Sign In'; btn.disabled = false; }
    }
}

async function submitForgotPassword() {
    const email = document.getElementById('authEmail')?.value.trim();
    if (!email) { showAuthError('Enter your email above first.'); return; }
    try {
        await fbAuth.sendPasswordResetEmail(email);
        showAuthError(''); // Clear error box
        const err = document.getElementById('authError');
        if (err) {
            err.style.display = 'block';
            err.style.background = 'rgba(80,200,80,0.15)';
            err.style.borderColor = 'rgba(80,200,80,0.3)';
            err.style.color = '#80e080';
            err.textContent = 'Password reset email sent! Check your inbox.';
        }
    } catch (e) {
        showAuthError(e.message);
    }
}

// ── ACCOUNT MODAL (signed-in state) ──────────

function openAccountModal() {
    closeAuthModal();

    const overlay = document.createElement('div');
    overlay.id = 'authOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:999999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.3s ease;
    `;

    const email    = currentUser?.email || '';
    const initial  = email.charAt(0).toUpperCase() || '?';
    const lastSync = load('_last_firebase_sync', null);
    const syncText = lastSync ? `Last synced ${new Date(lastSync).toLocaleString()}` : 'Syncing...';

    overlay.innerHTML = `
        <div style="
            width:100%;max-width:400px;
            background:rgba(18,18,18,0.99);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:20px;overflow:hidden;
            box-shadow:0 24px 64px rgba(0,0,0,0.9);
            font-family:'DM Sans',sans-serif;
        ">
            <!-- Profile header -->
            <div style="padding:28px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
                <div style="
                    width:64px;height:64px;border-radius:50%;
                    background:rgba(255,255,255,0.08);
                    border:2px solid rgba(255,255,255,0.15);
                    display:flex;align-items:center;justify-content:center;
                    font-size:26px;font-weight:700;margin:0 auto 14px;
                ">${initial}</div>
                <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;">${email}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.3);margin-top:4px;">☁ ${syncText}</div>
            </div>

            <!-- Stats preview -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid rgba(255,255,255,0.06);">
                ${[
                    [Object.keys(playlists).filter(n=>n!=='Liked Songs').length, 'Playlists'],
                    [playlists['Liked Songs']?.songs?.length || 0, 'Liked'],
                    [Object.keys(savedAlbums).length, 'Albums'],
                ].map(([v, l]) => `
                    <div style="padding:16px;text-align:center;border-right:1px solid rgba(255,255,255,0.06);">
                        <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;">${v}</div>
                        <div style="font-size:11px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;margin-top:2px;">${l}</div>
                    </div>
                `).join('')}
            </div>

            <!-- Actions -->
            <div style="padding:20px 24px;display:flex;flex-direction:column;gap:10px;">
                <button onclick="manualSyncToFirebase()" style="
                    width:100%;padding:12px;
                    background:rgba(255,255,255,0.06);
                    border:1px solid rgba(255,255,255,0.1);
                    border-radius:10px;color:var(--text);
                    font-size:14px;font-weight:600;cursor:pointer;
                    transition:all 0.2s;font-family:'DM Sans',sans-serif;
                " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">
                    ↑ Sync Now
                </button>

                <button onclick="pullFromFirebase()" style="
                    width:100%;padding:12px;
                    background:rgba(255,255,255,0.06);
                    border:1px solid rgba(255,255,255,0.1);
                    border-radius:10px;color:var(--text);
                    font-size:14px;font-weight:600;cursor:pointer;
                    transition:all 0.2s;font-family:'DM Sans',sans-serif;
                " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">
                    ↓ Pull from Cloud
                </button>

                <button onclick="signOut()" style="
                    width:100%;padding:12px;
                    background:rgba(255,60,60,0.1);
                    border:1px solid rgba(255,60,60,0.2);
                    border-radius:10px;color:#ff8080;
                    font-size:14px;font-weight:600;cursor:pointer;
                    transition:all 0.2s;font-family:'DM Sans',sans-serif;
                " onmouseover="this.style.background='rgba(255,60,60,0.18)'" onmouseout="this.style.background='rgba(255,60,60,0.1)'">
                    Sign Out
                </button>
            </div>

            <div style="padding:0 24px 20px;display:flex;justify-content:center;">
                <button onclick="closeAuthModal()" style="
                    background:transparent;border:none;
                    color:rgba(255,255,255,0.25);font-size:13px;
                    cursor:pointer;font-family:'DM Sans',sans-serif;
                " onmouseover="this.style.color='rgba(255,255,255,0.5)'" onmouseout="this.style.color='rgba(255,255,255,0.25)'">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.opacity = '1'; }, 20);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAuthModal(); });
    document.addEventListener('keydown', authEscHandler);
}

// ── PUBLIC ACTIONS ───────────────────────────

async function signOut() {
    closeAuthModal();
    await fbAuth.signOut();
    showNotification('Signed out. Data still saved locally.');
}

async function manualSyncToFirebase() {
    closeAuthModal();
    if (!currentUser) { showNotification('Sign in first to sync'); return; }
    showNotification('Syncing to cloud...');
    try {
        await pushLocalToFirebase();
        save('_last_firebase_sync', Date.now());
        showNotification('✓ Synced to cloud!');
    } catch (err) {
        showNotification('Sync failed — check connection');
        console.error(err);
    }
}

async function pullFromFirebase() {
    closeAuthModal();
    if (!currentUser) { showNotification('Sign in first'); return; }
    showNotification('Pulling from cloud...');
    try {
        const doc = await fbDb.collection('users').doc(currentUser.uid).get();
        if (doc.exists) {
            mergeFirebaseDataIntoLocal(doc.data());
            showNotification('✓ Data pulled from cloud!');
        } else {
            showNotification('No cloud data found yet');
        }
    } catch (err) {
        showNotification('Pull failed — check connection');
        console.error(err);
    }
}

// ── BOOT ─────────────────────────────────────

// Auto-init after a short delay so the main app loads first
setTimeout(() => {
    initFirebase()
        .then(() => setTimeout(maybePromptSignIn, 2500))
        .catch(err => console.warn('Firebase init failed:', err));
}, 800);

// Exports
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.openAccountModal = openAccountModal;
window.submitAuth = submitAuth;
window.submitForgotPassword = submitForgotPassword;
window.switchAuthTab = switchAuthTab;
window.signOut = signOut;
window.manualSyncToFirebase = manualSyncToFirebase;
window.pullFromFirebase = pullFromFirebase;

console.log('✓ INDY Firebase Auth & Sync module loaded');

// ── PROMPT UNAUTHENTICATED USERS ─────────────

function maybePromptSignIn() {
    // Don't prompt if already signed in
    if (currentUser) return;

    // Don't prompt more than once per session
    if (sessionStorage.getItem('auth_prompt_shown')) return;
    sessionStorage.setItem('auth_prompt_shown', 'true');

    const banner = document.createElement('div');
    banner.id = 'authPromptBanner';
    banner.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(120px);
        background: rgba(18, 18, 18, 0.98);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 16px;
        z-index: 9000;
        box-shadow: 0 12px 40px rgba(0,0,0,0.7);
        backdrop-filter: blur(20px);
        transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        max-width: 440px;
        width: calc(100vw - 48px);
        font-family: 'DM Sans', sans-serif;
    `;

    banner.innerHTML = `
        <div style="font-size: 28px; flex-shrink: 0;">☁</div>
        <div style="flex: 1; min-width: 0;">
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 3px;">
                Sync your music across devices
            </div>
            <div style="font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.4;">
                Sign in to back up playlists, liked songs & history
            </div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0;">
            <button onclick="
                document.getElementById('authPromptBanner').style.transform='translateX(-50%) translateY(120px)';
                setTimeout(() => document.getElementById('authPromptBanner')?.remove(), 500);
                sessionStorage.setItem('auth_prompt_dismissed', 'true');
            " style="
                background: transparent;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 8px;
                color: rgba(255,255,255,0.4);
                padding: 8px 14px;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'DM Sans', sans-serif;
            " onmouseover="this.style.borderColor='rgba(255,255,255,0.25)';this.style.color='rgba(255,255,255,0.7)'"
               onmouseout="this.style.borderColor='rgba(255,255,255,0.12)';this.style.color='rgba(255,255,255,0.4)'">
                Not now
            </button>
            <button onclick="
                document.getElementById('authPromptBanner').style.transform='translateX(-50%) translateY(120px)';
                setTimeout(() => document.getElementById('authPromptBanner')?.remove(), 400);
                openAuthModal();
            " style="
                background: linear-gradient(135deg, #ffffff, #e0e0e0);
                border: none;
                border-radius: 8px;
                color: #000;
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'DM Sans', sans-serif;
            " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                Sign In
            </button>
        </div>
    `;

    document.body.appendChild(banner);

    // Slide up after a 3 second delay
    setTimeout(() => {
        banner.style.transform = 'translateX(-50%) translateY(0)';
    }, 3000);

    // Auto-dismiss after 12 seconds
    setTimeout(() => {
        if (document.getElementById('authPromptBanner')) {
            banner.style.transform = 'translateX(-50%) translateY(120px)';
            setTimeout(() => banner.remove(), 500);
        }
    }, 12000);
}

// Hook into onUserSignedOut so banner also shows if they sign out mid-session
const _origOnUserSignedOut = onUserSignedOut;
onUserSignedOut = function() {
    _origOnUserSignedOut();
    sessionStorage.removeItem('auth_prompt_shown');
    setTimeout(maybePromptSignIn, 2000);
};

// ── PATCH IMPORT FUNCTIONS TO ALSO SYNC ──────

// Wait for the main app's functions to exist, then override them
setTimeout(() => {

    // Patch importData (used by the JSON file import in the Link menu)
    const _origImportData = window.importData;
    window.importData = async function(data) {
        _origImportData(data); // runs the original, saves to localStorage
        // After the original finishes (it reloads after 1s), push to Firebase
        if (currentUser) {
            try {
                await pushLocalToFirebase();
                save('_last_firebase_sync', Date.now());
                console.log('✓ Imported data synced to Firebase');
            } catch (err) {
                console.error('Firebase sync after import failed:', err);
            }
        }
    };

    // Patch mergePastedData (used by the Transfer/paste JSON feature)
    const _origMergePastedData = window.mergePastedData;
    window.mergePastedData = async function() {
        _origMergePastedData(); // runs the original, merges into localStorage
        // Give it a moment to finish writing to localStorage before pushing
        setTimeout(async () => {
            if (currentUser) {
                try {
                    await pushLocalToFirebase();
                    save('_last_firebase_sync', Date.now());
                    showNotification('✓ Merged data synced to cloud!');
                    console.log('✓ Merged data synced to Firebase');
                } catch (err) {
                    console.error('Firebase sync after merge failed:', err);
                }
            }
        }, 1500);
    };

    console.log('✓ Import/merge functions patched for Firebase sync');

}, 2000); // Wait 2s so the original functions are definitely defined

// ── JAM BUTTON ───────────────────────────────

setTimeout(() => {
    const authBtn = document.getElementById('authNavBtn');
    if (!authBtn) return;

    const jamBtn = document.createElement('button');
    jamBtn.id = 'jamNavBtn';
    jamBtn.innerHTML = `<span>Jam</span>`;
    jamBtn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: var(--text);
        padding: 10px 22px;
        border-radius: 40px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-right: 8px;
        font-family: 'DM Sans', sans-serif;
    `;
    jamBtn.onmouseover = () => {
        jamBtn.style.background = 'rgba(255,255,255,0.1)';
        jamBtn.style.borderColor = 'rgba(255,255,255,0.15)';
    };
    jamBtn.onmouseout = () => {
        jamBtn.style.background = 'rgba(255,255,255,0.05)';
        jamBtn.style.borderColor = 'rgba(255,255,255,0.08)';
    };
    jamBtn.onclick = () => window.location.href = 'jam.html';

    // Insert before the auth button so order is: Jam → Sign In → Link
    authBtn.parentNode.insertBefore(jamBtn, authBtn);

    console.log('✓ Jam button added');
}, 2500); // Slightly after auth button renders

// ────────────────────────────────────────
// NAV SEARCH - defined here so searchDeezer is in scope
// ────────────────────────────────────────

window.performNavSearch = function() {
    const navSearchInput = document.getElementById('navSearchInput');
    if (!navSearchInput) return;
    const searchQuery = navSearchInput.value.trim();

    if (!searchQuery) { showSearch(); return; }

    showSearch();
    navSearchInput.value = '';

    const scUrl = extractSoundCloudUrl(searchQuery);

    if (scUrl) {
        showNotification("Loading SoundCloud track...");
        const song = { id: 'sc_paste', scPermalinkUrl: scUrl, title: "SoundCloud Track", artist: "SoundCloud", art: '', _isSoundCloud: true };
        playSong(song);
        showNotification("Playing SoundCloud track!");
    } else if (searchQuery.length >= 3) {
        Promise.all([
            searchDeezer(searchQuery, 'track', 10),
            searchDeezer(searchQuery, 'album', 6)
        ])
        .then(([tracks, albums]) => renderDeezerSearchResults(tracks, albums))
        .catch(err => { console.error("Search error:", err); showNotification("Search failed"); });
    }
};

window.handleNavSearchKeyPress = function(event) {
    if (event.key === 'Enter') window.performNavSearch();
};

console.log('✓ Nav search (Deezer) loaded');
