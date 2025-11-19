

// ===== CUSTOM DIALOG FUNCTIONS =====
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
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        inputEl.onkeydown = null;
      };

      okBtn.onclick = () => {
        const value = inputEl.value.trim();
        cleanup();
        resolve(value || null);
      };

      cancelBtn.onclick = () => {
        cleanup();
        resolve(null);
      };

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
        okBtn.onclick = null;
        cancelBtn.onclick = null;
      };

      okBtn.onclick = () => {
        cleanup();
        resolve(true);
      };

      cancelBtn.onclick = () => {
        cleanup();
        resolve(false);
      };
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
        cancelBtn.onclick = null;
        resolve(null);
      };
    });
  }

  // DOM Elements
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

  // State
  let userName = localStorage.getItem("userName") || "User";
  let userAvatar = localStorage.getItem("userAvatar") || "https://via.placeholder.com/80";
  let userBio = localStorage.getItem("userBio") || "";
  let recentlyPlayed = JSON.parse(localStorage.getItem("recentlyPlayed") || "[]");
  let playlists = JSON.parse(localStorage.getItem("miniPlaylists") || "{}");
  let currentPlaylist = null;
  let queueFromPlaylist = false;

function getTimeBasedGreeting() {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return "Good morning";
  } else if (hour >= 12 && hour < 17) {
    return "Good afternoon";
  } else if (hour >= 17 && hour < 22) {
    return "Good evening";
  } else {
    return "Good night";
  }
}

  // Generate ID
  function generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  // Migrate old playlists
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

  // Update Profile
function updateUserProfile() {
  userName = localStorage.getItem("userName") || "User";
  userAvatar = localStorage.getItem("userAvatar") || "https://via.placeholder.com/80";
  userBio = localStorage.getItem("userBio") || "";

  // ← THIS IS THE NEW DYNAMIC GREETING
  const greeting = getTimeBasedGreeting();
  welcome.innerText = `${greeting}, ${userName}!`;

  profileName.innerText = userName;
  profileAvatar.src = userAvatar;
  bioInput.value = userBio;

  if (userAvatar !== "https://via.placeholder.com/80") {
    const img = document.createElement('img');
    img.src = userAvatar;
    profileBtn.innerHTML = '';
    profileBtn.appendChild(img);
  } else {
    profileBtn.innerText = userName.charAt(0).toUpperCase();
  }
}
  updateUserProfile();

  // Bio save
  bioInput.addEventListener('input', () => {
    localStorage.setItem("userBio", bioInput.value);
  });

  // Avatar upload
  changeAvatarBtn.onclick = () => uploadAvatar.click();
  uploadAvatar.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        localStorage.setItem("userAvatar", ev.target.result);
        updateUserProfile();
      };
      reader.readAsDataURL(file);
    }
  });

  // Change name
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
  function closePremium() { premiumPopup.style.display = "none"; }
  profileBtn.onclick = () => {
    profilePopup.style.display = profilePopup.style.display === "block" ? "none" : "block";
  };
  document.addEventListener("click", (e) => {
    if (!profileBtn.contains(e.target) && !profilePopup.contains(e.target)) profilePopup.style.display = "none";
    if (!premiumBtn.contains(e.target) && !premiumPopup.contains(e.target)) premiumPopup.style.display = "none";
  });

  // Deezer fetch
  async function deezerFetch(path) {
    const url = `https://api.deezer.com/${path}&output=jsonp`;
    return new Promise((resolve) => {
      const callbackName = "dzcb_" + Math.random().toString(36).substring(2);
      window[callbackName] = function (data) {
        resolve(data.data || data || []);
        delete window[callbackName];
        const script = document.querySelector(`script[src^="${url}"]`);
        if (script) script.remove();
      };
      const script = document.createElement("script");
      script.src = `${url}&callback=${callbackName}`;
      document.body.appendChild(script);
    });
  }

  // Search
  let searchTimeout;
  searchInput.addEventListener("input", async () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    showSearch();
    results.innerHTML = "";
    searchResultsTitle.style.display = 'none';
    if (!q) { popularSection.style.display = 'block'; return; }
    popularSection.style.display = 'none';
    searchResultsTitle.style.display = 'block';
    showSkeletons(results, 5);
    searchTimeout = setTimeout(async () => {
      try {
        const songs = await deezerFetch(`search?q=${encodeURIComponent(q)}`);
        results.innerHTML = "";
        if (songs.length === 0) {
          results.innerHTML = "<p style='color:#aaa; text-align:center; padding:20px;'>No results found.</p>";
        } else {
          renderSongs(songs, results);
        }
      } catch (err) {
        results.innerHTML = "<p style='color:#f66; text-align:center;'>Search failed. Try again.</p>";
      }
    }, 400);
  });

  // Popular
  async function loadPopular() {
    popular.innerHTML = "";
    showSkeletons(popular, 5);
    try {
      const songs = await deezerFetch('chart/0/tracks?limit=20');
      renderSongs(songs, popular);
    } catch (err) {
      popular.innerHTML = "<p style='color:#f66;'>Failed to load popular songs.</p>";
    }
  }

  // AI Recommendations
  let recommendTimeout;
  recommendInput.addEventListener("input", async () => {
    clearTimeout(recommendTimeout);
    const q = recommendInput.value.trim();
    aiRecommendations.innerHTML = "";
    if (!q) return;
    showSkeletons(aiRecommendations, 5);
    recommendTimeout = setTimeout(async () => {
      try {
        const searchResults = await deezerFetch(`search/track?q=${encodeURIComponent(q)}&limit=1`);
        if (!searchResults.length) {
          aiRecommendations.innerHTML = "<p style='color:#aaa;'>No song found.</p>";
          return;
        }
        const song = searchResults[0];
        const recommendations = await deezerFetch(`artist/${song.artist.id}/radio?limit=12`);
        aiRecommendations.innerHTML = `<p style='margin-bottom:12px; color:#aaa;'>Songs like <strong>${song.title}</strong>:</p>`;
        renderSongs(recommendations, aiRecommendations);
      } catch (err) {
        aiRecommendations.innerHTML = "<p style='color:#f66;'>Recommendation failed.</p>";
      }
    }, 500);
  });

  // Render song card (for search, popular, AI)
  function renderSongs(songs, container) {
    songs.forEach(song => {
      const div = document.createElement("div");
      div.className = "song-card";
      const artistName = song.artist ? song.artist.name : (song.name || "Unknown");
      const cover = song.album ? song.album.cover_medium : (song.cover_medium || 'https://via.placeholder.com/64');
      div.innerHTML = `
        <div style='display:flex; align-items:center; gap:16px;'>
          <img class="cover" src="${cover}" alt="Cover" />
          <div>
            <strong>${song.title}</strong><br>
            <small style="color:#aaa;">${artistName}</small>
          </div>
        </div>
        <button>Add</button>
      `;
      div.querySelector('button').onclick = (e) => { e.stopPropagation(); addSongToPlaylist(song); };
      div.onclick = () => playSong(song);
      container.appendChild(div);
    });
  }

  function showSkeletons(container, count) {
    for (let i = 0; i < count; i++) {
      const sk = document.createElement("div");
      sk.className = "skeleton";
      container.appendChild(sk);
    }
  }

  // === GRID CARD RENDERER ===
  function renderGridCard(item, container, clickHandler) {
    const div = document.createElement('div');
    div.className = 'grid-card';
    const cover = item.album?.cover_medium || item.cover_medium || 'https://via.placeholder.com/180?text=♪';
    const title = item.title || item.name || 'Untitled';
    div.innerHTML = `
      <img class="grid-cover" src="${cover}" alt="cover">
      <div class="grid-title">${title}</div>
    `;
    div.onclick = () => clickHandler(item);
    container.appendChild(div);
  }

  // === PLAY SONG + QUEUE ===
  function playSong(song, fromPlaylist = false) {
    audio.src = song.preview;
    nowPlaying.innerText = `Now playing: ${song.title} — ${song.artist?.name || ''}`;
    player.style.display = "block";
    audio.play().catch(() => {});
    // Update recently played (max 6)
    recentlyPlayed = recentlyPlayed.filter(s => s.id !== song.id);
    recentlyPlayed.push(song);
    localStorage.setItem("recentlyPlayed", JSON.stringify(recentlyPlayed.slice(-6)));
    if (homePage.style.display === 'block') loadHomeContent();
    // Queue logic
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
    playSong(pl.songs[startIdx], true);
  }

  audio.onended = () => {
    if (queueFromPlaylist && currentPlaylist) {
      const pl = playlists[currentPlaylist.name];
      const nextIdx = currentPlaylist.index + 1;
      if (nextIdx < pl.songs.length) {
        currentPlaylist.index = nextIdx;
        playSong(pl.songs[nextIdx], true);
      } else {
        queueFromPlaylist = false;
        currentPlaylist = null;
      }
    }
  };

  // === PLAYLISTS ===
  function savePlaylists() {
    ensurePlaylistIds();
    localStorage.setItem("miniPlaylists", JSON.stringify(playlists));
  }

  function renderSidebarPlaylists() {
    const playlistItems = sidebar.querySelectorAll('.playlist-item');
    playlistItems.forEach(item => item.remove());
    // + New Playlist
    const newBtn = document.createElement('div');
    newBtn.className='playlist-item';
    newBtn.innerHTML='<strong style="color:var(--accent);">+ New Playlist</strong>';
    newBtn.onclick = async () => {
      const name = await showInputDialog('New Playlist', 'Enter playlist name:');
      if (!name?.trim()) return;
      const id = generateId();
      playlists[name] = { id, songs: [], cover: null };
      savePlaylists();
      renderSidebarPlaylists();
      loadHomeContent();
    };
    sidebar.appendChild(newBtn);
    // Existing Playlists
    for (const name in playlists) {
      const pl = playlists[name];
      const cover = pl.cover || 'https://via.placeholder.com/42x42.png?text=♪';
      const div = document.createElement('div');
      div.className='playlist-item';
      div.innerHTML = `
        <img class='playlist-cover' src='${cover}'/>
        <strong style="flex:1;">${name}</strong>
        <div class="playlist-actions">
          <button onclick="editPlaylist('${name}')">Edit</button>
          <button onclick="uploadPlaylistCoverFunc('${name}')">Cover</button>
        </div>
      `;
      // Click on cover or name → open playlist
      div.onclick = (e) => {
        if (!e.target.closest('.playlist-actions')) loadPlaylist(name);
      };
      sidebar.appendChild(div);
    }
  }

  window.editPlaylist = async function(name) {
    const newName = await showInputDialog('Rename Playlist', 'Enter new name:', name);
    if (newName && newName !== name) {
      playlists[newName] = playlists[name];
      delete playlists[name];
      savePlaylists();
      renderSidebarPlaylists();
      loadHomeContent();
    }
  };

  window.sharePlaylist = async function(id) {
    const url = `${location.origin}${location.pathname}?playlist=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      await showAlert('Link Copied!', `Share this link with friends:\n${url}`);
    } catch {
      await showAlert('Share Link', url);
    }
  };

  window.deletePlaylist = async function(name) {
    const confirmed = await showConfirm('Delete Playlist', `Delete "${name}"?`);
    if (confirmed) {
      delete playlists[name];
      savePlaylists();
      renderSidebarPlaylists();
      loadHomeContent();
    }
  };

  function loadPlaylist(name) {
    showSearch();
    searchInput.style.display = 'none';
    popularSection.style.display = 'none';
    searchResultsTitle.style.display = 'none';
    results.innerHTML = `
      <div class="playlist-header">
        <h3>${name}</h3>
        <div class="btns">
          <button onclick="sharePlaylist('${playlists[name].id}')">Share</button>
          <button onclick="deletePlaylist('${name}')">Delete</button>
        </div>
      </div>
    `;
    const songsContainer = document.createElement('div');
    playlists[name].songs.forEach((song, idx) => {
      const div = document.createElement('div');
      div.className = 'song-card';
      div.innerHTML = `
        <img class='cover' src='${song.album.cover_medium}'>
        <div><strong>${song.title}</strong><br><small style="color:#aaa;">${song.artist.name}</small></div>
      `;
      div.onclick = () => startPlaylistPlayback(name, idx);
      songsContainer.appendChild(div);
    });
    results.appendChild(songsContainer);
  }

  async function addSongToPlaylist(song) {
    const names = Object.keys(playlists);
    if (!names.length) {
      await showAlert('No Playlists', 'Create a playlist first!');
      return;
    }
    const pl = await showPlaylistSelect(playlists);
    if (pl && playlists[pl]) {
      playlists[pl].songs.push(song);
      savePlaylists();
      await showAlert('Success', `Added to ${pl}`);
      loadHomeContent();
    }
  }

  window.uploadPlaylistCoverFunc = function(playlistName) {
    uploadPlaylistCover.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        playlists[playlistName].cover = ev.target.result;
        savePlaylists();
        renderSidebarPlaylists();
        loadHomeContent();
      };
      reader.readAsDataURL(file);
    };
    uploadPlaylistCover.click();
  };

  // === HOME CONTENT (3x2 grids) ===
  function loadHomeContent() {
    // Recently Played (6 max)
    recentlyPlayedDiv.innerHTML = '';
    const recent = recentlyPlayed.slice(-6).reverse();
    if (recent.length) {
      const grid = document.createElement('div');
      grid.className = 'grid-container';
      recent.forEach(s => renderGridCard(s, grid, playSong));
      recentlyPlayedDiv.appendChild(grid);
    } else {
      recentlyPlayedDiv.innerHTML = '<p style="color:#666; font-style:italic;">No songs played yet.</p>';
    }
    // Your Playlists
    yourPlaylists.innerHTML = '';
    const plNames = Object.keys(playlists);
    if (plNames.length) {
      const grid = document.createElement('div');
      grid.className = 'grid-container';
      plNames.forEach(name => {
        const pl = playlists[name];
        const fakeSong = { title: name, album: { cover_medium: pl.cover || 'https://via.placeholder.com/180?text=♪' } };
        renderGridCard(fakeSong, grid, () => loadPlaylist(name));
      });
      yourPlaylists.appendChild(grid);
    } else {
      yourPlaylists.innerHTML = '<p style="color:#666; font-style:italic;">No playlists yet. Create one!</p>';
    }
  }

  // Navigation
  function showHome() {
    homePage.style.display = 'block';
    searchPage.style.display = 'none';
    homeNav.classList.add('active');
    searchNav.classList.remove('active');
    lyricsViewer.style.display = 'none';
    loadHomeContent();
  }

  function showSearch() {
    homePage.style.display = 'none';
    searchPage.style.display = 'block';
    homeNav.classList.remove('active');
    searchNav.classList.add('active');
    searchInput.style.display = 'block';
    searchResultsTitle.style.display = 'none';
    results.innerHTML = '';
  }

  homeNav.onclick = showHome;
  searchNav.onclick = showSearch;

  // Init
  ensurePlaylistIds();
  renderSidebarPlaylists();
  showHome();
  loadPopular();

  // URL playlist load
  const params = new URLSearchParams(location.search);
  const plId = params.get("playlist");
  if (plId) {
    setTimeout(() => {
      for (const name in playlists) {
        if (playlists[name].id === plId) {
          loadPlaylist(name);
          break;
        }
      }
    }, 500);
  }
// Update greeting at midnight automatically
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    updateUserProfile();
  }
}, 60000); // check every minute
