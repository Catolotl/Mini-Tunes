const rightSidebar = document.getElementById("right-sidebar");
const nowPlayingSidebar = document.getElementById("now-playing-sidebar");
const nowPlayingCover = document.getElementById("now-playing-cover");
const nowPlayingTitle = document.getElementById("now-playing-title");
const nowPlayingArtist = document.getElementById("now-playing-artist");
const addCurrentBtn = document.getElementById("add-current-to-playlist");

let currentSong = null;
let currentPlaylist = null; // { name, index }
let queueFromPlaylist = false;
let currentAlbum = null;

let recentlyPlayedAlbums = JSON.parse(localStorage.getItem("recentlyPlayedAlbums") || "[]");

function saveRecentAlbum(album) {
  const albumToSave = {
    id: album.id,
    title: album.title,
    artist: album.artist,
    cover: album.cover,
    cover_medium: album.cover_medium
  };
  recentlyPlayedAlbums = recentlyPlayedAlbums.filter(a => a.id !== album.id);
  recentlyPlayedAlbums.push(albumToSave);
  if (recentlyPlayedAlbums.length > 20) recentlyPlayedAlbums.shift();
  localStorage.setItem("recentlyPlayedAlbums", JSON.stringify(recentlyPlayedAlbums));

  if (homePage.style.display === "block") loadHomeContent();
}

// ====================== DIALOGS ======================
function showInputDialog(title, message, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('input-modal');
    const titleEl = document.getElementById('input-modal-title');
    const messageEl = document.getElementById('input-modal-message');
    const inputEl = document.getElementById('input-modal-input');
    const okBtn = document.getElementById('input-modal-ok');
    const cancelBtn = document.getElementById('input-modal-cancel');
    titleEl.textContent = title;
    messageEl.textContent = message;
    inputEl.value = defaultValue;
    modal.classList.add('active');
    inputEl.focus();
    const cleanup = () => {
      modal.classList.remove('active');
      okBtn.onclick = cancelBtn.onclick = inputEl.onkeydown = null;
    };
    okBtn.onclick = () => { cleanup(); resolve(inputEl.value.trim() || null); };
    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') okBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    };
  });
}

function showAlert(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-modal-title');
    const messageEl = document.getElementById('alert-modal-message');
    const okBtn = document.getElementById('alert-modal-ok');
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('active');
    okBtn.onclick = () => {
      modal.classList.remove('active');
      okBtn.onclick = null;
      resolve();
    };
  });
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('active');
    const cleanup = () => {
      modal.classList.remove('active');
      okBtn.onclick = cancelBtn.onclick = null;
    };
    okBtn.onclick = () => { cleanup(); resolve(true); };
    cancelBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

function showPlaylistSelect(playlists) {
  return new Promise((resolve) => {
    const modal = document.getElementById('playlist-select-modal');
    const listEl = document.getElementById('playlist-select-list');
    const cancelBtn = document.getElementById('playlist-select-cancel');
    listEl.innerHTML = '';
    Object.keys(playlists).forEach(name => {
      const item = document.createElement('div');
      item.className = 'playlist-select-item';
      item.textContent = name;
      item.onclick = () => {
        modal.classList.remove('active');
        resolve(name);
      };
      listEl.appendChild(item);
    });
    modal.classList.add('active');
    cancelBtn.onclick = () => {
      modal.classList.remove('active');
      resolve(null);
    };
  });
}

// ====================== DOM ELEMENTS ======================
const premiumBtn = document.getElementById("premium-btn");
const premiumPopup = document.getElementById("premium-popup");
const profileBtn = document.getElementById("profile-btn");
const profilePopup = document.getElementById("profile-popup");
const profileName = document.getElementById("profile-name");
const changeNameBtn = document.getElementById("change-name");
const profileAvatar = document.getElementById("profile-avatar");
const changeAvatarBtn = document.getElementById("change-avatar-btn");
const uploadAvatar = document.getElementById("upload-avatar");
const bioInput = document.getElementById("bio-input");
const searchInput = document.getElementById("search");
const results = document.getElementById("results");
const audio = document.getElementById("audio");
const player = document.getElementById("player");
const nowPlaying = document.getElementById("now-playing");
const sidebar = document.getElementById("sidebar");
const lyricsViewer = document.getElementById("lyrics-viewer");
const lyricsText = document.getElementById("lyrics-text");
const homePage = document.getElementById("home-page");
const searchPage = document.getElementById("search-page");
const homeNav = document.getElementById("home-nav");
const searchNav = document.getElementById("search-nav");
const welcome = document.getElementById("welcome");
const recentlyPlayedDiv = document.getElementById("recently-played");
const aiRecommendations = document.getElementById("ai-recommendations");
const recommendInput = document.getElementById("recommend-input");
const yourPlaylists = document.getElementById("your-playlists");
const popular = document.getElementById("popular");
const popularSection = document.getElementById("popular-section");
const searchResultsTitle = document.getElementById("search-results-title");
const uploadPlaylistCover = document.getElementById("upload-playlist-cover");

// ====================== STATE ======================
let userName = localStorage.getItem("userName") || "User";
let userAvatar = localStorage.getItem("userAvatar") || "https://via.placeholder.com/80";
let userBio = localStorage.getItem("userBio") || "";
let recentlyPlayed = JSON.parse(localStorage.getItem("recentlyPlayed") || "[]");
let playlists = JSON.parse(localStorage.getItem("miniPlaylists") || "{}");

// ====================== LIKED ARTISTS (HEART SYSTEM) ======================
let likedArtists = JSON.parse(localStorage.getItem("likedArtists") || "{}");
// Format: { "Artist Name": { name, cover } }

function toggleLikeArtist(artistName, coverUrl) {
  if (likedArtists[artistName]) {
    delete likedArtists[artistName];
  } else {
    likedArtists[artistName] = {
      name: artistName,
      cover: coverUrl || 'https://via.placeholder.com/42'
    };
  }
  localStorage.setItem("likedArtists", JSON.stringify(likedArtists));
  renderLikedArtistsSidebar();
}

function renderLikedArtistsSidebar() {
  const sidebar = document.getElementById('sidebar');

  // Remove old Liked Artists section
  const existingHeader = sidebar.querySelector('.playlists-header[data-type="liked-artists"]');
  if (existingHeader) {
    let next = existingHeader.nextElementSibling;
    while (next && next.classList.contains('liked-artist-item')) {
      next.remove();
      next = existingHeader.nextElementSibling;
    }
    existingHeader.remove();
  }

  const likedList = Object.values(likedArtists);
  if (likedList.length === 0) return;

  // Add header
  const header = document.createElement('div');
  header.className = 'playlists-header';
  header.setAttribute('data-type', 'liked-artists');
  header.textContent = '♥️ Liked Artists';
  sidebar.appendChild(header);

  // Add artists
  likedList.forEach(artist => {
    const div = document.createElement('div');
    div.className = 'playlist-item liked-artist-item';
    div.innerHTML = `
      <img class="playlist-cover" src="${artist.cover}" alt="artist">
      <strong style="flex:1;">${artist.name}</strong>
      <span class="heart-btn liked" onclick="event.stopPropagation(); toggleLikeArtist('${artist.name}', '${artist.cover}')">♥️</span>
    `;
    div.onclick = () => loadArtistSongs(artist.name);
    sidebar.appendChild(div);
  });
}

// Helper: Load songs by artist
async function loadArtistSongs(artistName) {
  showSearch();
  searchInput.style.display = 'none';
  popularSection.style.display = 'none';
  searchResultsTitle.style.display = 'none';
  searchResultsTitle.textContent = `Songs by ${artistName}`;
  searchResultsTitle.style.display = 'block';

  results.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Loading songs...</p>';

  const songs = await itunesFetch(artistName, 30);
  results.innerHTML = '';

  if (!songs.length) {
    results.innerHTML = '<p style="text-align:center;color:#888;">No songs found.</p>';
    return;
  }

  const container = document.createElement('div');
  songs.forEach(song => {
    const div = document.createElement('div');
    div.className = 'song-card';
    const coverSrc = song.album?.cover_medium || 'https://via.placeholder.com/64';
    const isLiked = !!likedArtists[song.artist?.name];

    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;flex:1;">
        <img class="cover" src="${coverSrc}" alt="cover">
        <div style="flex:1;">
          <strong>${song.title}</strong><br>
          <small style="color:#aaa;">
            ${song.artist?.name || 'Unknown'}
            <span class="heart-btn ${isLiked ? 'liked' : ''}"
                  onclick="event.stopPropagation(); toggleLikeArtist('${song.artist?.name || 'Unknown'}', '${coverSrc}')">
              ${isLiked ? '♥️' : '♡'}
            </span>
          </small>
        </div>
      </div>
    `;
    div.onclick = () => playSong(song);
    container.appendChild(div);
  });
  results.appendChild(container);
}

// ====================== UTILS ======================
function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function ensurePlaylistIds() {
  let changed = false;
  for (const name in playlists) {
    if (!playlists[name].id) {
      playlists[name].id = generateId();
      changed = true;
    }
  }
  if (changed) savePlaylists();
}

function savePlaylists() {
  ensurePlaylistIds();
  localStorage.setItem("miniPlaylists", JSON.stringify(playlists));
}

// ====================== PROFILE ======================
function updateUserProfile() {
  userName = localStorage.getItem("userName") || "User";
  userAvatar = localStorage.getItem("userAvatar") || "https://via.placeholder.com/80";
  userBio = localStorage.getItem("userBio") || "";
  welcome.textContent = `${getTimeBasedGreeting()}, ${userName}!`;
  profileName.textContent = userName;
  profileAvatar.src = userAvatar;
  bioInput.value = userBio;

  if (userAvatar.includes("placeholder")) {
    profileBtn.textContent = userName.charAt(0).toUpperCase();
    profileBtn.style.background = "var(--accent)";
  } else {
    profileBtn.innerHTML = `<img src="${userAvatar}" style="width:100%;height:100%;border-radius:50%;">`;
  }
}

updateUserProfile();

bioInput.addEventListener('input', () => localStorage.setItem("userBio", bioInput.value));

changeAvatarBtn.onclick = () => uploadAvatar.click();
uploadAvatar.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    localStorage.setItem("userAvatar", ev.target.result);
    updateUserProfile();
  };
  reader.readAsDataURL(file);
});

changeNameBtn.onclick = async () => {
  const newName = await showInputDialog('Change Name', 'Enter your name:', userName);
  if (newName && newName.trim()) {
    localStorage.setItem("userName", newName.trim());
    updateUserProfile();
    profilePopup.style.display = "none";
  }
};

// Popups
premiumBtn.onclick = () => premiumPopup.style.display = "block";
window.closePremium = () => premiumPopup.style.display = "none";

profileBtn.onclick = () => {
  profilePopup.style.display = profilePopup.style.display === "block" ? "none" : "block";
};

document.addEventListener("click", (e) => {
  if (!profileBtn.contains(e.target) && !profilePopup.contains(e.target))
    profilePopup.style.display = "none";
  if (!premiumBtn.contains(e.target) && !premiumPopup.contains(e.target))
    premiumPopup.style.display = "none";
});

// ====================== ITUNES API ======================
async function itunesFetch(query, limit = 20) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.results || []).map(track => ({
      id: track.trackId,
      title: track.trackName,
      preview: track.previewUrl,
      artist: {
        id: track.artistId,
        name: track.artistName
      },
      album: {
        cover_medium: track.artworkUrl100?.replace('100x100', '200x200') || track.artworkUrl100,
        cover_big: track.artworkUrl100?.replace('100x100', '600x600') || track.artworkUrl100
      }
    }));
  } catch (err) {
    console.error('iTunes API error:', err);
    return [];
  }
}

async function itunesAlbumFetch(query, limit = 4) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=album&limit=${limit}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.results || []).map(album => ({
      id: album.collectionId,
      title: album.collectionName,
      artist: {
        id: album.artistId,
        name: album.artistName
      },
      cover: album.artworkUrl100?.replace('100x100', '600x600') || album.artworkUrl100,
      cover_medium: album.artworkUrl100?.replace('100x100', '200x200') || album.artworkUrl100,
      trackCount: album.trackCount,
      releaseDate: album.releaseDate
    }));
  } catch (err) {
    console.error('iTunes Album API error:', err);
    return [];
  }
}

async function itunesAlbumTracksFetch(albumId) {
  const url = `https://itunes.apple.com/lookup?id=${albumId}&entity=song`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const tracks = (data.results || []).slice(1);
    return tracks.map(track => ({
      id: track.trackId,
      title: track.trackName,
      preview: track.previewUrl,
      trackNumber: track.trackNumber,
      artist: {
        id: track.artistId,
        name: track.artistName
      },
      album: {
        id: track.collectionId,
        name: track.collectionName,
        cover_medium: track.artworkUrl100?.replace('100x100', '200x200') || track.artworkUrl100,
        cover_big: track.artworkUrl100?.replace('100x100', '600x600') || track.artworkUrl100
      }
    }));
  } catch (err) {
    console.error('iTunes Album Tracks API error:', err);
    return [];
  }
}

// ====================== SEARCH & POPULAR ======================
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  showSearch();
  results.innerHTML = "";
  searchResultsTitle.style.display = 'none';
  popularSection.style.display = q ? 'none' : 'block';
  if (!q) return;
  searchResultsTitle.style.display = 'block';
  showSkeletons(results, 12);
  searchTimeout = setTimeout(async () => {
    try {
      const [songs, albums] = await Promise.all([
        itunesFetch(q, 20),
        itunesAlbumFetch(q, 4)
      ]);

      results.innerHTML = "";

      if (!songs.length && !albums.length) {
        results.innerHTML = "<p style='color:#aaa;text-align:center;padding:40px;'>No results found.</p>";
        return;
      }

      if (albums.length) {
        const albumSection = document.createElement('div');
        albumSection.innerHTML = '<h3 style="margin:0 0 16px;font-size:1.2em;font-weight:600;color:#eee;">Albums</h3>';
        const albumGrid = document.createElement('div');
        albumGrid.className = 'grid-container';
        albumGrid.style.marginBottom = '32px';

        albums.forEach(album => {
          const div = document.createElement('div');
          div.className = 'grid-card';
          div.innerHTML = `
            <img class="grid-cover" src="${album.cover_medium}" alt="cover">
            <div>
              <div class="grid-title">${album.title}</div>
              <div class="grid-artist">${album.artist.name}</div>
            </div>
          `;
          div.onclick = () => loadAlbum(album);
          albumGrid.appendChild(div);
        });

        albumSection.appendChild(albumGrid);
        results.appendChild(albumSection);
      }

      if (songs.length) {
        const songSection = document.createElement('div');
        songSection.innerHTML = '<h3 style="margin:0 0 16px;font-size:1.2em;font-weight:600;color:#eee;">Songs</h3>';
        results.appendChild(songSection);
        renderSongs(songs, results);
      }
    } catch (err) {
      results.innerHTML = "<p style='color:#f66;text-align:center;'>Search failed.</p>";
    }
  }, 400);
});

async function loadPopular() {
  popular.innerHTML = "";
  showSkeletons(popular, 10);
  try {
    const songs = await itunesFetch('top songs 2024', 20);
    renderSongs(songs, popular);
  } catch {
    popular.innerHTML = "<p style='color:#f66;'>Failed to load popular songs.</p>";
  }
}

// AI Recommendations
let recommendTimeout;
recommendInput.addEventListener("input", () => {
  clearTimeout(recommendTimeout);
  const q = recommendInput.value.trim();
  aiRecommendations.innerHTML = "";
  if (!q) return;
  showSkeletons(aiRecommendations, 6);
  recommendTimeout = setTimeout(async () => {
    try {
      const songs = await itunesFetch(q, 12);
      if (!songs.length) throw new Error("No songs");
      const mainSong = songs[0];
      const similar = await itunesFetch(`${mainSong.artist.name} songs`, 12);
      aiRecommendations.innerHTML = `<p style='margin-bottom:12px;color:#aaa;'>Songs like <strong>${mainSong.title}</strong>:</p>`;
      renderSongs(similar, aiRecommendations);
    } catch {
      aiRecommendations.innerHTML = "<p style='color:#f66;'>Recommendation failed.</p>";
    }
  }, 600);
});

// ====================== RENDERING ======================
function showSkeletons(container, count) {
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const sk = document.createElement("div");
    sk.className = "skeleton";
    container.appendChild(sk);
  }
}

function renderSongs(songs, container) {
  songs.forEach(song => {
    const div = document.createElement("div");
    div.className = "song-card";
    const artistName = song.artist?.name || "Unknown Artist";
    const cover = song.album?.cover_medium || 'https://via.placeholder.com/64';
    const isLiked = !!likedArtists[artistName];

    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;flex:1;">
        <img class="cover" src="${cover}" alt="Cover">
        <div style="flex:1;">
          <strong>${song.title}</strong><br>
          <small style="color:#aaa;">
            ${artistName}
            <span class="heart-btn ${isLiked ? 'liked' : ''}"
                  onclick="event.stopPropagation(); toggleLikeArtist('${artistName}', '${cover}')">
              ${isLiked ? '♥️' : '♡'}
            </span>
          </small>
        </div>
      </div>
      <button class="add-btn">Add</button>
    `;
    div.querySelector('.add-btn').onclick = (e) => {
      e.stopPropagation();
      addSongToPlaylist(song);
    };
    div.onclick = () => playSong(song);
    container.appendChild(div);
  });
}

function renderGridCard(item, container, clickHandler) {
  const div = document.createElement('div');
  div.className = 'grid-card';
  const cover = item.album?.cover_medium || item.cover_medium || item.cover || 'https://via.placeholder.com/180?text=♪';
  const title = item.title || item.name || 'Untitled';
  const artist = item.artist?.name || '';
  div.innerHTML = `
    <img class="grid-cover" src="${cover}" alt="cover">
    <div>
      <div class="grid-title">${title}</div>
      ${artist ? `<div class="grid-artist">${artist}</div>` : ''}
    </div>
  `;
  div.onclick = () => clickHandler(item);
  container.appendChild(div);
}

// ====================== PLAYER ======================
async function playSong(song, fromPlaylist = false) {
  if (!song?.preview || !song.id) {
    await showAlert('Invalid Song', 'This song cannot be played.');
    return;
  }

  if (!song.album || !song.artist?.id) {
    try {
      const fresh = await itunesFetch(song.title + ' ' + song.artist?.name, 1);
      if (fresh[0]?.preview) song = fresh[0];
    } catch (e) { console.warn("Failed to refresh song data", e); }
  }

  currentSong = song;
  audio.src = song.preview;
  nowPlaying.textContent = `Now playing: ${song.title} — ${song.artist?.name || 'Unknown'}`;
  player.style.display = "block";

  const bigCover = song.album?.cover_big || song.album?.cover_medium || 'https://via.placeholder.com/240';
  nowPlayingCover.src = bigCover;
  nowPlayingTitle.textContent = song.title;
  nowPlayingArtist.textContent = song.artist?.name || 'Unknown Artist';
  rightSidebar.classList.remove("hidden");
  nowPlayingSidebar.style.display = "block";

  try {
    await audio.play();
  } catch (err) {
    console.log("Autoplay blocked:", err);
    await showAlert('Autoplay Blocked', 'Tap OK to start playing.');
    try { await audio.play(); } catch { }
  }

  const songToSave = {
    id: song.id,
    title: song.title,
    preview: song.preview,
    artist: { id: song.artist?.id, name: song.artist?.name || "Unknown" },
    album: {
      cover_medium: song.album?.cover_medium || 'https://via.placeholder.com/64',
      cover_big: song.album?.cover_big || 'https://via.placeholder.com/240'
    }
  };
  recentlyPlayed = recentlyPlayed.filter(s => s.id !== song.id);
  recentlyPlayed.push(songToSave);
  if (recentlyPlayed.length > 20) recentlyPlayed.shift();
  localStorage.setItem("recentlyPlayed", JSON.stringify(recentlyPlayed));

  if (homePage.style.display === "block") loadHomeContent();

  renderLikedArtistsSidebar(); // Refresh sidebar in case user liked during playback

  if (fromPlaylist && currentPlaylist) {
    queueFromPlaylist = true;
  } else {
    queueFromPlaylist = false;
    currentPlaylist = null;
  }
}

function startPlaylistPlayback(plName, startIdx = 0) {
  const pl = playlists[plName];
  if (!pl?.songs?.length) return;
  currentPlaylist = { name: plName, index: startIdx };
  queueFromPlaylist = true;
  playSong(pl.songs[startIdx], true);
}

function startAlbumPlayback(trackIndex) {
  if (!currentAlbum || !currentAlbum.tracks[trackIndex]) return;
  currentPlaylist = {
    name: `album_${currentAlbum.id}`,
    index: trackIndex,
    isAlbum: true
  };
  queueFromPlaylist = true;
  playSong(currentAlbum.tracks[trackIndex], true);
}

audio.onended = () => {
  if (queueFromPlaylist && currentPlaylist) {
    if (currentPlaylist.isAlbum && currentAlbum) {
      const next = currentPlaylist.index + 1;
      if (next < currentAlbum.tracks.length) {
        currentPlaylist.index = next;
        playSong(currentAlbum.tracks[next], true);
        return;
      }
    } else {
      const pl = playlists[currentPlaylist.name];
      const next = currentPlaylist.index + 1;
      if (next < pl.songs.length) {
        currentPlaylist.index = next;
        playSong(pl.songs[next], true);
        return;
      }
    }
  }
  queueFromPlaylist = false;
  currentPlaylist = null;
  setTimeout(hidePlayer, 800);
};

audio.onerror = async () => {
  await showAlert('Playback Error', 'This song is unavailable.');
  if (queueFromPlaylist && currentPlaylist) {
    if (currentPlaylist.isAlbum && currentAlbum) {
      const next = currentPlaylist.index + 1;
      if (next < currentAlbum.tracks.length) {
        currentPlaylist.index = next;
        playSong(currentAlbum.tracks[next], true);
        return;
      }
    } else {
      const pl = playlists[currentPlaylist.name];
      const next = currentPlaylist.index + 1;
      if (next < pl.songs.length) {
        currentPlaylist.index = next;
        playSong(pl.songs[next], true);
        return;
      }
    }
  }
  hidePlayer();
};

function hidePlayer() {
  nowPlayingSidebar.style.display = "none";
  player.style.display = "none";
  rightSidebar.classList.add("hidden");
  nowPlaying.textContent = "No song playing";
}

addCurrentBtn.onclick = async () => {
  if (!currentSong) return;
  await addSongToPlaylist(currentSong);
};

// ====================== PLAYLISTS ======================
function renderSidebarPlaylists() {
  sidebar.querySelectorAll('.playlist-item').forEach(el => el.remove());

  const newBtn = document.createElement('div');
  newBtn.className = 'playlist-item new-playlist';
  newBtn.innerHTML = '<strong style="color:var(--accent);">+ Create Playlist</strong>';
  newBtn.onclick = async () => {
    const name = await showInputDialog('New Playlist', 'Enter playlist name:');
    if (!name?.trim()) return;
    if (playlists[name.trim()]) {
      await showAlert('Oops', 'A playlist with that name already exists.');
      return;
    }
    playlists[name.trim()] = { id: generateId(), songs: [], cover: null };
    savePlaylists();
    renderSidebarPlaylists();
    loadHomeContent();
  };
  sidebar.appendChild(newBtn);

  Object.keys(playlists).forEach(name => {
    const pl = playlists[name];
    const cover = pl.cover || 'https://via.placeholder.com/42x42.png?text=♪';
    const div = document.createElement('div');
    div.className = 'playlist-item';
    div.innerHTML = `
      <img class="playlist-cover" src="${cover}" alt="cover">
      <strong style="flex:1;">${name}</strong>
      <div class="playlist-actions">
        <button onclick="editPlaylist('${name}')">Edit</button>
        <button onclick="uploadPlaylistCoverFunc('${name}')">Cover</button>
      </div>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.playlist-actions')) return;
      loadPlaylist(name);
    });
    sidebar.appendChild(div);
  });
}

async function editPlaylist(oldName) {
  const newName = await showInputDialog('Rename Playlist', 'New name:', oldName);
  if (!newName || newName === oldName) return;
  if (playlists[newName]) {
    await showAlert('Error', 'Playlist name already exists.');
    return;
  }
  playlists[newName] = playlists[oldName];
  delete playlists[oldName];
  savePlaylists();
  renderSidebarPlaylists();
  loadHomeContent();
}

async function sharePlaylist(id) {
  const url = `${location.origin}${location.pathname}?playlist=${id}`;
  try {
    await navigator.clipboard.writeText(url);
    await showAlert('Copied!', 'Playlist link copied to clipboard.');
  } catch {
    await showAlert('Share Link', url);
  }
}

async function deletePlaylist(name) {
  const ok = await showConfirm('Delete Playlist', `Delete "${name}" permanently?`);
  if (ok) {
    delete playlists[name];
    savePlaylists();
    renderSidebarPlaylists();
    loadHomeContent();
  }
}

function uploadPlaylistCoverFunc(name) {
  uploadPlaylistCover.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      playlists[name].cover = ev.target.result;
      savePlaylists();
      renderSidebarPlaylists();
      loadHomeContent();
      const bigCover = document.querySelector('.playlist-big-cover');
      if (bigCover) bigCover.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  uploadPlaylistCover.click();
}

async function addSongToPlaylist(song) {
  if (!Object.keys(playlists).length) {
    await showAlert('No Playlists', 'Create a playlist first!');
    return;
  }
  const plName = await showPlaylistSelect(playlists);
  if (!plName) return;
  const songToStore = {
    id: song.id,
    title: song.title,
    preview: song.preview,
    artist: { id: song.artist?.id, name: song.artist?.name || "Unknown" },
    album: {
      cover_medium: song.album?.cover_medium || 'https://via.placeholder.com/64',
      cover_big: song.album?.cover_big || 'https://via.placeholder.com/240'
    }
  };
  playlists[plName].songs.push(songToStore);
  savePlaylists();
  await showAlert('Added!', `Song added to "${plName}"`);
  loadHomeContent();
}

function loadPlaylist(name) {
  showSearch();
  searchInput.style.display = 'none';
  popularSection.style.display = 'none';
  searchResultsTitle.style.display = 'none';
  const pl = playlists[name];
  const cover = pl.cover || 'https://via.placeholder.com/280?text=♪';
  results.innerHTML = `
    <div class="playlist-view-header">
      <img class="playlist-big-cover" src="${cover}" alt="cover" style="cursor:pointer;" onclick="uploadPlaylistCoverFunc('${name}')">
      <h1 class="playlist-view-title">${name}</h1>
      <p class="playlist-view-song-count">${pl.songs.length} song${pl.songs.length !== 1 ? 's' : ''}</p>
    </div>
    <div class="playlist-header" style="justify-content:flex-end;margin:20px 0;">
      <button onclick="sharePlaylist('${pl.id}')">Share</button>
      <button onclick="deletePlaylist('${name}')">Delete</button>
    </div>
  `;
  const container = document.createElement('div');
  if (!pl.songs.length) {
    container.innerHTML = '<p style="text-align:center;color:#888;padding:60px;">This playlist is empty.<br>Add some songs!</p>';
  } else {
    pl.songs.forEach((song, i) => {
      const div = document.createElement('div');
      div.className = 'song-card';
      const artist = song.artist?.name || "Unknown";
      const coverSrc = song.album?.cover_medium || 'https://via.placeholder.com/64';
      const isLiked = !!likedArtists[artist];

      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;flex:1;">
          <img class="cover" src="${coverSrc}" alt="cover">
          <div style="flex:1;">
            <strong>${song.title}</strong><br>
            <small style="color:#aaa;">
              ${artist}
              <span class="heart-btn ${isLiked ? 'liked' : ''}"
                    onclick="event.stopPropagation(); toggleLikeArtist('${artist}', '${coverSrc}')">
                ${isLiked ? '♥️' : '♡'}
              </span>
            </small>
          </div>
        </div>
        <div style="color:#888;font-size:1.4em;">⋯</div>
      `;
      div.onclick = () => startPlaylistPlayback(name, i);
      container.appendChild(div);
    });
  }
  results.appendChild(container);
}

async function loadAlbum(album) {
  showSearch();
  searchInput.style.display = 'none';
  popularSection.style.display = 'none';
  searchResultsTitle.style.display = 'none';
  const cover = album.cover || 'https://via.placeholder.com/280?text=♪';
  results.innerHTML = `
    <div class="playlist-view-header">
      <img class="playlist-big-cover" src="${cover}" alt="cover">
      <h1 class="playlist-view-title">${album.title}</h1>
      <p class="playlist-view-song-count">${album.artist.name} • Album</p>
    </div>
  `;
  const loadingDiv = document.createElement('div');
  loadingDiv.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Loading tracks...</p>';
  results.appendChild(loadingDiv);

  const tracks = await itunesAlbumTracksFetch(album.id);
  loadingDiv.remove();

  currentAlbum = {
    id: album.id,
    title: album.title,
    tracks: tracks
  };

  const container = document.createElement('div');
  if (!tracks.length) {
    container.innerHTML = '<p style="text-align:center;color:#888;padding:60px;">No tracks found.</p>';
    currentAlbum = null;
  } else {
    tracks.forEach((song, i) => {
      const div = document.createElement('div');
      div.className = 'song-card';
      const coverSrc = song.album?.cover_medium || album.cover_medium;
      const isLiked = !!likedArtists[song.artist?.name];

      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;flex:1;">
          <img class="cover" src="${coverSrc}" alt="cover">
          <div style="flex:1;">
            <strong>${song.title}</strong><br>
            <small style="color:#aaa;">
              ${song.artist.name}
              <span class="heart-btn ${isLiked ? 'liked' : ''}"
                    onclick="event.stopPropagation(); toggleLikeArtist('${song.artist.name}', '${coverSrc}')">
                ${isLiked ? '♥️' : '♡'}
              </span>
            </small>
          </div>
        </div>
      `;
      div.onclick = () => startAlbumPlayback(i);
      container.appendChild(div);
    });
  }
  results.appendChild(container);
  saveRecentAlbum(album);
}

// ====================== HOME PAGE ======================
function loadHomeContent() {
  recentlyPlayedDiv.innerHTML = '';
  const recent = recentlyPlayed.slice(-8).reverse();

  if (recent.length) {
    const grid = document.createElement('div');
    grid.className = 'grid-container';
    recent.forEach(s => renderGridCard(s, grid, playSong));
    recentlyPlayedDiv.appendChild(grid);
  } else {
    recentlyPlayedDiv.innerHTML = '<p style="color:#666;font-style:italic;">No recently played songs.</p>';
  }

  yourPlaylists.innerHTML = '';
  const names = Object.keys(playlists);
  if (names.length) {
    const grid = document.createElement('div');
    grid.className = 'grid-container';
    names.forEach(name => {
      const pl = playlists[name];
      const fake = {
        title: name,
        cover: pl.cover || 'https://via.placeholder.com/180?text=♪'
      };
      renderGridCard(fake, grid, () => loadPlaylist(name));
    });
    yourPlaylists.appendChild(grid);
  } else {
    yourPlaylists.innerHTML = '<p style="color:#666;font-style:italic;">No playlists yet. Create one!</p>';
  }

  const existingAlbumSection = document.querySelector('[data-section="recent-albums"]');
  if (existingAlbumSection) existingAlbumSection.remove();

  const recentAlbums = recentlyPlayedAlbums.slice(-4).reverse();
  if (recentAlbums.length) {
    const albumSection = document.createElement('div');
    albumSection.className = 'section';
    albumSection.setAttribute('data-section', 'recent-albums');
    albumSection.innerHTML = '<h3>Recently Played Albums</h3>';

    const grid = document.createElement('div');
    grid.className = 'grid-container';
    recentAlbums.forEach(album => renderGridCard(album, grid, () => loadAlbum(album)));
    albumSection.appendChild(grid);

    const recentSection = recentlyPlayedDiv.parentElement;
    recentSection.parentElement.insertBefore(albumSection, recentSection.nextSibling);
  }
}

// ====================== NAVIGATION ======================
function showHome() {
  homePage.style.display = 'block';
  searchPage.style.display = 'none';
  homeNav.classList.add('active');
  searchNav.classList.remove('active');
  lyricsViewer.style.display = 'none';
  loadHomeContent();
  renderLikedArtistsSidebar();
}

function showSearch() {
  homePage.style.display = 'none';
  searchPage.style.display = 'block';
  homeNav.classList.remove('active');
  searchNav.classList.add('active');
  searchInput.style.display = 'block';
  searchInput.focus();
}

homeNav.onclick = showHome;
searchNav.onclick = showSearch;

// ====================== INIT ======================
ensurePlaylistIds();
renderSidebarPlaylists();
renderLikedArtistsSidebar();
showHome();
loadPopular();

// Load shared playlist from URL
const urlParams = new URLSearchParams(location.search);
const sharedId = urlParams.get('playlist');
if (sharedId) {
  setTimeout(() => {
    for (const name in playlists) {
      if (playlists[name].id === sharedId) {
        loadPlaylist(name);
        break;
      }
    }
  }, 600);
}

// Update greeting at midnight
setInterval(() => {
  if (new Date().getHours() === 0 && new Date().getMinutes() === 0) {
    updateUserProfile();
  }
}, 60000);

// Initial hide
if (!audio.src) hidePlayer();
rightSidebar.classList.add("hidden");
