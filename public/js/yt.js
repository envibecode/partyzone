/* ══════════════════════════════════════════════════════════
   Pont avec l'IFrame Player API de YouTube.
   Deux usages :
     • lecture audio de la piste du blind test (lecteur invisible)
     • extraction des IDs d'une playlist, sans clé API (lecteur « scanner »)
   ══════════════════════════════════════════════════════════ */
window.PZYouTube = (() => {
  let apiPromise = null;
  let player = null;
  let scanner = null;
  let playerReady = false;
  let volume = 70;

  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
    return apiPromise;
  }

  async function ensurePlayer() {
    const YT = await loadApi();
    if (player) return player;
    return new Promise((resolve) => {
      player = new YT.Player('yt-player', {
        height: '1',
        width: '1',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            playerReady = true;
            try { player.setVolume(volume); } catch {}
            resolve(player);
          },
          onError: (e) => {
            document.dispatchEvent(new CustomEvent('pz:yt-error', { detail: e.data }));
          },
        },
      });
    });
  }

  /**
   * Lance une piste. `startFraction` (0..1) est décidé par le serveur :
   * tout le monde démarre donc au même endroit du morceau.
   */
  async function play(videoId, startFraction) {
    await ensurePlayer();
    return new Promise((resolve) => {
      let seeked = false;
      const onState = (ev) => {
        // 1 = lecture en cours
        if (ev.data === 1 && !seeked) {
          seeked = true;
          const dur = player.getDuration();
          if (dur && startFraction > 0) {
            const target = Math.max(0, Math.min(dur - 12, dur * startFraction));
            player.seekTo(target, true);
          }
          player.removeEventListener('onStateChange', onState);
          resolve();
        }
      };
      player.addEventListener('onStateChange', onState);
      try {
        player.loadVideoById({ videoId });
        player.setVolume(volume);
        player.playVideo();
      } catch (err) {
        resolve();
      }
      setTimeout(resolve, 4000); // filet de sécurité
    });
  }

  function stop() {
    if (player && playerReady) {
      try { player.stopVideo(); } catch {}
    }
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(100, Number(v) || 0));
    if (player && playerReady) {
      try { player.setVolume(volume); } catch {}
    }
    return volume;
  }

  function getVolume() { return volume; }

  /**
   * Extrait les IDs vidéo d'une playlist publique, côté navigateur, sans clé API.
   * Le lecteur charge la playlist en sourdine puis on lit getPlaylist().
   */
  async function scanPlaylist(playlistId) {
    const YT = await loadApi();
    return new Promise((resolve, reject) => {
      const done = (ids) => {
        clearInterval(poll);
        clearTimeout(fail);
        try { scanner.destroy(); } catch {}
        scanner = null;
        resolve(ids);
      };

      const host = document.getElementById('yt-scan');
      host.innerHTML = '<div id="yt-scanner"></div>';

      scanner = new YT.Player('yt-scanner', {
        height: '1',
        width: '1',
        playerVars: {
          listType: 'playlist',
          list: playlistId,
          autoplay: 0,
          controls: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            try { scanner.mute(); } catch {}
          },
          onError: () => {
            clearInterval(poll);
            clearTimeout(fail);
            reject(new Error('playlist illisible'));
          },
        },
      });

      const poll = setInterval(() => {
        try {
          const list = scanner && scanner.getPlaylist && scanner.getPlaylist();
          if (list && list.length) done(list);
        } catch {}
      }, 400);

      const fail = setTimeout(() => {
        clearInterval(poll);
        try { scanner.destroy(); } catch {}
        scanner = null;
        reject(new Error('délai dépassé'));
      }, 12000);
    });
  }

  return { play, stop, setVolume, getVolume, scanPlaylist, ensurePlayer };
})();
