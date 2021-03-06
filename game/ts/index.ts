import { InitSettings } from './settings/settings';
import { MountThemeCSS, updateMountedCss, resetBuiltInThemes, showThemeAddDialog } from './theme';
import { InitElementGameUi } from './element-game';
import { delay } from '../../shared/shared';
import { fetchWithProgress } from '../../shared/fetch-progress';
import { connectApi } from './api';
import { ElementalLoadingUi } from '../../shared/elem';
import { createLoadingUi } from './loading';
import { getActiveServer, installDefaultServers, setActiveServer } from './server-manager';
import { getNextMusic, loadSounds, playMusicTrack, playSound } from './audio';
import { AlertDialog } from './dialog';
import { getConfigBoolean } from './savefile';
import { Howler } from 'howler';
import { setWorkerRegistration } from './service-worker';
import marked from 'marked';

declare const $production: string;
declare const $version: string;
declare const $build_date: string;

const cacheName = 'ELEMENTAL';

export let SKIPPED_UPDATES = false;

type MenuAPI = {
  cache: string;
  status?: (text: string, progress?: number) => void;
  showGame?: () => void;
  upgraded?: string
}

async function boot(MenuAPI: MenuAPI) {
  // Initial Stuff
  delete window["$elemental4"];
  console.clear();
  console.log(`👋 Hello Elemental, version ${$version}`);

  if(typeof localStorage === 'undefined') return location.reload();

  const ui = MenuAPI.status ? MenuAPI : createLoadingUi();

  if(MenuAPI.upgraded) {
    ui.status('Finalizing Updates', 0);
    if (window.navigator && navigator.serviceWorker) {
      await navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map(x => x.unregister())));
    }
    await caches.delete('ELEMENTAL')
  }
  
  ui.status('Checking Updates', 0);

  if(!('serviceWorker' in navigator)) {
    alert('Service workers not supported, game cannot start. Make sure to use a Modern Web Browser!')
    location.reload();
    return;
  } else {
    ui.status('Loading Service', 0);
    await navigator.serviceWorker.register('/pwa.js');
    const reg = await navigator.serviceWorker.ready;
    setWorkerRegistration(reg);
  }
  
  let failedUpdateApply;
  ui.status('Checking Updates', 0);

  // check for updates
  try {
    const latestVersion = await fetch('/version').then(x => x.text());
    if (latestVersion !== $version || (!$production && !MenuAPI.upgraded)) {
      resetBuiltInThemes();
      if(await new Promise(async(resolve) => {
        const cacheKey = latestVersion + '-' + Math.random().toFixed(6).substr(2);
        const progress = fetchWithProgress(await fetch('/elemental.js?v=' + cacheKey));
        progress.on('progress', ({ percent, current, total }) => {
          ui.status(`Updating Client`, percent);
        });
        progress.on('done', async(text) => {
          localStorage.cache = cacheKey;
          
          if (await caches.has(cacheName)) {
            caches.delete(cacheName);
          }

          try {
            eval(text);

            // pass the current menu api / ui.
            window['$elemental4']({
              ...MenuAPI,
              ...ui,
              cache: cacheKey,
              upgraded: $version
            });
            resolve(true)
          } catch (error) {
            ui.status('Error Updating', 0);
            failedUpdateApply = error;
            resolve(false);
          }
        });
      })) {
        return;
      }
    }
  } catch (error) {
    console.log(error)
    SKIPPED_UPDATES = true;
    console.log("Could not check version, Updates Skipped.");
  }

  if(!await caches.has(cacheName)) {
    ui.status('Downloading Game Files', 0);
    const cache = await caches.open(cacheName)
    let count = 0;
    await Promise.all(
      [
        ...[
          '/elemental.js?v=' + MenuAPI.cache,
          '/',
          '/logo.svg',
          '/air.svg',
          '/earth.svg',
          '/fire.svg',
          '/water.svg',
          '/logo-workshop.svg',
          '/no-element.svg',
          '/game',
          '/font.css',
          '/icon/maskable.png',
          '/icon/normal.png',
          '/developer.png',
          '/theme.schema.json',
          '/p5_background',
          '/theme_editor',
          '/manifest.json',
          '/changelog.md',
          '/chrome-bypass.mp3',
        ].map(async (url, i, a) => {
          await cache.add(url);
          count++;
          ui.status('Downloading Game Files', count/(a.length));
        }),
        MountThemeCSS()
      ]
    );
  } else {
    await MountThemeCSS();
  }

  ui.status('Loading Game HTML', 0);
  const gameRoot = document.getElementById('game');
  gameRoot.innerHTML = await fetch('/game').then((x) => x.text());
  const changelogRoot = document.getElementById('changelog-root');
  changelogRoot.innerHTML = marked(await fetch('/changelog.md').then((x) => x.text()));

  const versionInfo = {
    'version': $version,
    'build-date': $build_date
  };
  document.querySelectorAll('[data-build-info]').forEach(x => x.innerHTML = versionInfo[x.getAttribute('data-build-info')]);

  if (!$production) {
    ui.status('Loading Console Vars', 0);
    require("./globals").exposeGlobals();
  }

  ui.status('Loading Servers', 0);
  await installDefaultServers();
  ui.status('Loading Servers', 0.8);
  const initialServer = await getActiveServer();
  ui.status('Loading Themes', 0);
  await updateMountedCss();

  if (failedUpdateApply) {
    await AlertDialog({
      title: 'Failed to apply updates.',
      text: `You are playing a potentially outdated version of the game. Error: \`\`\`${failedUpdateApply && failedUpdateApply.stack}\`\`\``
    });
  }

  ui.status('Loading Settings', 0);
  await InitSettings();
  ui.status('Loading Audio', 0);
  await loadSounds();
  ui.status('Checking for new DLC', 0);
  await showThemeAddDialog()
  ui.status('Loading Element UI', 0);
  InitElementGameUi();

  ui.status('Loading API', 0);

  await connectApi(initialServer.baseUrl, null, ui as ElementalLoadingUi)
  
  'dispose' in ui && ui.dispose();

  localStorage.cache = MenuAPI.cache;

  while (Howler.ctx.state === 'suspended') {
    await AlertDialog({
      title: 'Autoplay Disabled',
      text: 'Click OK on this dialog to enable audio autoplay. [Learn More](/chrome_autoplay)',
    });
    await delay(350);
  }

  MenuAPI.showGame && MenuAPI.showGame();

  localStorage.setItem('auto_start', 'true');
  
  await delay(10);

  document.getElementById('game').classList.add('animate-in');
  if(getConfigBoolean('config-play-startup-sound', true)) {
    playSound('startup');
    await delay(500);
  }
  playMusicTrack(getNextMusic());

  if (await caches.has('monaco_editor')) {
    caches.delete('monaco_editor');
  }
  if (await caches.has('secondary_cache')) {
    caches.delete('secondary_cache');
  }

  if(!await caches.has('secondary_cache_v2')) {
    const monacoCache = await caches.open('secondary_cache_v2');

    Promise.all(require('../../monaco-editor-files.json').files.map(x => `/vs/${x}`).concat('/p5.min.js')
      .map(async (url, i, a) => {
        await monacoCache.add(url);
        if (url === '/p5.min.js') {
          const p5tag = document.createElement('script');
          p5tag.src = '/p5.min.js';
          p5tag.async = true;
          document.head.appendChild(p5tag);
        }
      }))
  } else {
    const p5tag = document.createElement('script');
    p5tag.src = '/p5.min.js';
    p5tag.async = true;
    document.head.appendChild(p5tag);
  }
}
async function kill() {
  
}

window['$elemental4'] = boot;
