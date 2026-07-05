/**
 * fingerprint.js — PRODUCTION HARDENED v3
 *
 * إصلاحات v3:
 *   - noiseSeed حتمي مبني على sessionId (كان عشوائياً كل restart → بصمة متغيرة = بوت واضح)
 *   - حالة الشحن (charging) ثابتة per-session (كانت عشوائية مع كل page load)
 *   - buildFingerprintScript(profile, sessionId) — يستقبل sessionId الآن
 *
 * يغطي كل ناقل تفتيشه WhatsApp Web:
 *   canvas noise, WebGL vendor/renderer, Audio context, Screen geometry,
 *   hardware concurrency, device memory, battery, network info, WebRTC,
 *   media devices, permissions, speech synthesis, timezone, fonts,
 *   navigator overrides, Chrome runtime, connection type.
 */

// ── Device profiles ────────────────────────────────────────────────────────
// حرج: جميع UA strings يجب أن تطابق Chromium المثبت فعلياً.
// البيئة: chromium-138.0.7204.100 → Chrome/138.0.0.0 في كل UAs.
export const DEVICE_PROFILES = [
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2 V@0700.59)",
    memory:      12,
    concurrency: 8,
    screen:      { width: 1080, height: 2340, colorDepth: 24 },
    timezone:    "Asia/Riyadh",
    languages:   ["ar-SA", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         3.0,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Immortalis-G715, OpenGL ES 3.2)",
    memory:      12,
    concurrency: 8,
    screen:      { width: 1344, height: 2992, colorDepth: 24 },
    timezone:    "Asia/Dubai",
    languages:   ["ar-AE", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         2.625,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Mali-G68, OpenGL ES 3.2 v1.r38p1-00pxl0)",
    memory:      8,
    concurrency: 8,
    screen:      { width: 1080, height: 2408, colorDepth: 24 },
    timezone:    "Asia/Kuwait",
    languages:   ["ar-KW", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         2.625,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Xclipse 940, OpenGL ES 3.2)",
    memory:      12,
    concurrency: 8,
    screen:      { width: 1080, height: 2340, colorDepth: 24 },
    timezone:    "Asia/Cairo",
    languages:   ["ar-EG", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         3.0,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; 23129RAA4G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2 V@0700.59)",
    memory:      8,
    concurrency: 8,
    screen:      { width: 1080, height: 2400, colorDepth: 24 },
    timezone:    "Asia/Baghdad",
    languages:   ["ar-IQ", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         2.75,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; CPH2609) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2 V@0700.59)",
    memory:      16,
    concurrency: 8,
    screen:      { width: 1240, height: 2772, colorDepth: 24 },
    timezone:    "Asia/Riyadh",
    languages:   ["ar-SA", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         2.625,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; 2409BN20AG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Mali-G920, OpenGL ES 3.2 v1.r44p1-00eac0.)",
    memory:      12,
    concurrency: 8,
    screen:      { width: 1220, height: 2712, colorDepth: 24 },
    timezone:    "Asia/Muscat",
    languages:   ["ar-OM", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         2.625,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 13; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Xclipse 920, OpenGL ES 3.2 v1.r38p1-00pxl0)",
    memory:      12,
    concurrency: 8,
    screen:      { width: 1812, height: 2176, colorDepth: 24 },
    timezone:    "Asia/Riyadh",
    languages:   ["ar-SA", "ar", "en-US", "en"],
    androidVer:  "13",
    dpr:         2.2,
  },
  // profiles إضافية لتقليل التكرار عند وجود حسابات كثيرة
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Xclipse 530, OpenGL ES 3.2 v1.r38p1-00pxl0)",
    memory:      8,
    concurrency: 8,
    screen:      { width: 1080, height: 2340, colorDepth: 24 },
    timezone:    "Asia/Beirut",
    languages:   ["ar-LB", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         2.625,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; RMX3851) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2 V@0700.59)",
    memory:      12,
    concurrency: 8,
    screen:      { width: 1264, height: 2780, colorDepth: 24 },
    timezone:    "Asia/Amman",
    languages:   ["ar-JO", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         2.625,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 13; Redmi Note 12 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Mali-G99, OpenGL ES 3.2 v1.r38p1-00pxl0)",
    memory:      8,
    concurrency: 8,
    screen:      { width: 1080, height: 2400, colorDepth: 24 },
    timezone:    "Africa/Cairo",
    languages:   ["ar-EG", "ar", "en-US", "en"],
    androidVer:  "13",
    dpr:         2.75,
  },
  {
    ua:          "Mozilla/5.0 (Linux; Android 14; SM-G996B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    platform:    "Linux armv8l",
    vendor:      "Google Inc.",
    renderer:    "ANGLE (ARM, Xclipse 830, OpenGL ES 3.2 v1.r44p1-00eac0.)",
    memory:      8,
    concurrency: 8,
    screen:      { width: 1080, height: 2400, colorDepth: 24 },
    timezone:    "Asia/Bahrain",
    languages:   ["ar-BH", "ar", "en-US", "en"],
    androidVer:  "14",
    dpr:         3.0,
  },
];

export function pickProfile(sessionId) {
  // حتمي per-session: نفس الحساب = نفس الجهاز دائماً
  let hash = 0;
  for (const c of sessionId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return DEVICE_PROFILES[hash % DEVICE_PROFILES.length];
}

// ── توليد hash حتمي من sessionId ──────────────────────────────────────────
// مستخدم لـ noiseSeed وكل القيم "العشوائية" التي يجب أن تكون ثابتة per-session
function sessionHash(sessionId) {
  // djb2 hash — بسيط وحتمي
  let h = 5381;
  for (let i = 0; i < sessionId.length; i++) {
    h = ((h << 5) + h + sessionId.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ── Generate the evaluateOnNewDocument script ──────────────────────────────
// الآن يستقبل sessionId لضمان noiseSeed حتمي per-session
export function buildFingerprintScript(profile, sessionId) {
  // إصلاح حرج: noiseSeed حتمي من sessionId
  // الجهاز الحقيقي ينتج نفس canvas hash في كل مرة — لا يتغير بين restarts
  const noiseSeed = sessionHash(sessionId) & 0xFFFFFF;

  // إصلاح: حالة الشحن ثابتة per-session (لا تتغير بين page loads)
  const isCharging = (sessionHash(sessionId + "_charging") % 2) === 0;
  const batteryLevel = 0.45 + (noiseSeed % 50) * 0.01;
  // وقت الشحن المتبقي — ثابت وواقعي
  const dischargingTime = isCharging ? Infinity : (3600 + (noiseSeed % 7200));

  const dpr = profile.dpr ?? 2.625;

  return `
(function() {
  'use strict';

  // ── 1. navigator.webdriver (الإشارة الأقوى للبوت) ─────────────────────
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // ── 2. إزالة آثار Puppeteer/CDP ─────────────────────────────────────────
  const cdpKeys = [
    'cdc_adoQpoasnfa76pfcZLmcfl_Array',
    'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
    'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
    '__webdriver_script_fn',
    '__driver_unwrapped',
    '__webdriver_evaluate',
    '__selenium_unwrapped',
    '__fxdriver_evaluate',
    '__driver_evaluate',
  ];
  cdpKeys.forEach(k => { try { delete window[k]; } catch {} });

  // ── 3. navigator overrides ───────────────────────────────────────────────
  const _ua = ${JSON.stringify(profile.ua)};
  const _appVersion = _ua.replace(/^Mozilla\\//, '');
  Object.defineProperty(navigator, 'platform',    { get: () => ${JSON.stringify(profile.platform)} });
  Object.defineProperty(navigator, 'vendor',      { get: () => ${JSON.stringify(profile.vendor)} });
  Object.defineProperty(navigator, 'appVersion',  { get: () => _appVersion });
  Object.defineProperty(navigator, 'userAgent',   { get: () => _ua });

  // ── 4. اللغات ──────────────────────────────────────────────────────────
  Object.defineProperty(navigator, 'language',  { get: () => ${JSON.stringify(profile.languages[0])} });
  Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(profile.languages)} });

  // ── 5. الأجهزة ─────────────────────────────────────────────────────────
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${profile.concurrency} });
  Object.defineProperty(navigator, 'deviceMemory',        { get: () => ${profile.memory} });

  // ── 6. Plugins (0 plugins = علامة headless) ─────────────────────────────
  const pluginData = [
    { name: 'Chrome PDF Plugin',      filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer',      filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client',          filename: 'internal-nacl-plugin', description: '' },
  ];
  const plugins = pluginData.map(p => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperty(plugin, 'name',        { value: p.name });
    Object.defineProperty(plugin, 'filename',    { value: p.filename });
    Object.defineProperty(plugin, 'description', { value: p.description });
    Object.defineProperty(plugin, 'length',      { value: 0 });
    return plugin;
  });
  Object.defineProperty(navigator, 'plugins', {
    get: () => { const arr = plugins; arr.__proto__ = PluginArray.prototype; return arr; },
  });
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => { const arr = []; arr.__proto__ = MimeTypeArray.prototype; return arr; },
  });

  // ── 7. Screen geometry ─────────────────────────────────────────────────
  const sc = ${JSON.stringify(profile.screen)};
  const _dpr = ${dpr};
  Object.defineProperty(screen, 'width',       { get: () => sc.width });
  Object.defineProperty(screen, 'height',      { get: () => sc.height });
  Object.defineProperty(screen, 'availWidth',  { get: () => sc.width });
  Object.defineProperty(screen, 'availHeight', { get: () => sc.height - 48 });
  Object.defineProperty(screen, 'colorDepth',  { get: () => sc.colorDepth });
  Object.defineProperty(screen, 'pixelDepth',  { get: () => sc.colorDepth });
  Object.defineProperty(window, 'devicePixelRatio', { get: () => _dpr });
  Object.defineProperty(window, 'innerWidth',  { get: () => sc.width });
  Object.defineProperty(window, 'innerHeight', { get: () => sc.height - 100 });
  Object.defineProperty(window, 'outerWidth',  { get: () => sc.width });
  Object.defineProperty(window, 'outerHeight', { get: () => sc.height });

  // ── 8. Canvas fingerprint noise — حتمي per-session ──────────────────────
  // إصلاح: NOISE_SEED مشتق من sessionId، لا يتغير بين restarts
  const NOISE_SEED = ${noiseSeed};
  const _toDataURL  = HTMLCanvasElement.prototype.toDataURL;
  const _getCtxOrig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
    const ctx = _getCtxOrig.call(this, '2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
      for (let i = 0; i < imgData.data.length; i += 400) {
        imgData.data[i] ^= (NOISE_SEED >> (i % 24)) & 0x01;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    return _toDataURL.call(this, type, quality);
  };

  // ── 9. WebGL vendor + renderer ─────────────────────────────────────────
  const _getParam  = WebGLRenderingContext.prototype.getParameter;
  const _getParam2 = WebGL2RenderingContext && WebGL2RenderingContext.prototype.getParameter;
  const WEBGL_VENDOR   = ${JSON.stringify(profile.vendor)};
  const WEBGL_RENDERER = ${JSON.stringify(profile.renderer)};
  function spoofWebGL(orig) {
    return function(parameter) {
      if (parameter === 37445) return WEBGL_VENDOR;    // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return WEBGL_RENDERER;  // UNMASKED_RENDERER_WEBGL
      if (parameter === 7936)  return 'WebKit';        // VENDOR
      if (parameter === 7937)  return 'WebKit WebGL';  // RENDERER
      return orig.call(this, parameter);
    };
  }
  WebGLRenderingContext.prototype.getParameter = spoofWebGL(_getParam);
  if (_getParam2) WebGL2RenderingContext.prototype.getParameter = spoofWebGL(_getParam2);

  // ── 10. AudioContext fingerprint noise ─────────────────────────────────
  try {
    const _createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function() {
      const analyser = _createAnalyser.call(this);
      const _getFloat32 = analyser.getFloatFrequencyData.bind(analyser);
      analyser.getFloatFrequencyData = function(array) {
        _getFloat32(array);
        for (let i = 0; i < array.length; i++) {
          array[i] += (NOISE_SEED % 100) * 0.0001;
        }
      };
      return analyser;
    };
  } catch {}

  // ── 11. Battery API — ثابت per-session (إصلاح: لا تتغير حالة الشحن) ─────
  // مشتقة من sessionId → نفس القيمة في كل page load
  if ('getBattery' in navigator) {
    const fakeBattery = {
      charging:         ${isCharging},
      chargingTime:     ${isCharging ? 0 : 'Infinity'},
      dischargingTime:  ${dischargingTime},
      level:            ${batteryLevel.toFixed(4)},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent:    () => true,
    };
    navigator.getBattery = () => Promise.resolve(fakeBattery);
  }

  // ── 12. Network Information API ────────────────────────────────────────
  if (navigator.connection) {
    try {
      Object.defineProperties(navigator.connection, {
        type:           { get: () => 'wifi',   configurable: true },
        effectiveType:  { get: () => '4g',     configurable: true },
        rtt:            { get: () => 50 + (NOISE_SEED % 30), configurable: true },
        downlink:       { get: () => 8 + (NOISE_SEED % 15),  configurable: true },
        saveData:       { get: () => false,    configurable: true },
      });
    } catch {}
  }

  // ── 13. WebRTC IP leak prevention ─────────────────────────────────────
  const _RTCPeerConnection = window.RTCPeerConnection
    || window.webkitRTCPeerConnection
    || window.mozRTCPeerConnection;
  if (_RTCPeerConnection) {
    const SafeRTC = function(config, constraints) {
      const safeConfig = config ? { ...config, iceServers: [] } : {};
      return new _RTCPeerConnection(safeConfig, constraints);
    };
    SafeRTC.prototype = _RTCPeerConnection.prototype;
    Object.defineProperty(SafeRTC, 'name', { value: 'RTCPeerConnection' });
    window.RTCPeerConnection       = SafeRTC;
    window.webkitRTCPeerConnection = SafeRTC;
  }

  // ── 14. Media devices ─────────────────────────────────────────────────
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices = async () => [
      { deviceId: 'default', kind: 'audioinput',  label: 'Default Microphone', groupId: 'default' },
      { deviceId: 'default', kind: 'videoinput',  label: 'Back Camera',        groupId: 'camera' },
      { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker',    groupId: 'default' },
    ];
  }

  // ── 15. Permissions API ────────────────────────────────────────────────
  if (navigator.permissions && navigator.permissions.query) {
    const _permQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async (descriptor) => {
      const granted = ['notifications', 'clipboard-read', 'clipboard-write'];
      if (granted.includes(descriptor.name)) {
        return { state: 'granted', onchange: null, addEventListener: () => {}, removeEventListener: () => {} };
      }
      try { return await _permQuery(descriptor); } catch { return { state: 'prompt' }; }
    };
  }

  // ── 16. Chrome runtime ────────────────────────────────────────────────
  if (!window.chrome) {
    window.chrome = {
      runtime: { id: undefined },
      loadTimes: function() { return {}; },
      csi: function() { return {}; },
      app: {},
    };
  }

  // ── 17. Touch support ─────────────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'maxTouchPoints',   { get: () => 5 });
    Object.defineProperty(navigator, 'msMaxTouchPoints', { get: () => 5 });
  } catch {}

  // ── 18. Notification API ─────────────────────────────────────────────
  if (typeof Notification !== 'undefined') {
    try {
      Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    } catch {}
  }

  // ── 19. Timezone consistency ──────────────────────────────────────────
  const _DateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function(locale, options) {
    if (!options || !options.timeZone) {
      options = Object.assign({}, options, { timeZone: ${JSON.stringify(profile.timezone)} });
    }
    return new _DateTimeFormat(locale, options);
  };
  Object.assign(Intl.DateTimeFormat, _DateTimeFormat);

  // ── 20. Speech synthesis voices ───────────────────────────────────────
  if (window.speechSynthesis) {
    const _getVoices = window.speechSynthesis.getVoices.bind(window.speechSynthesis);
    window.speechSynthesis.getVoices = () => {
      const real = _getVoices();
      if (real && real.length > 0) return real;
      return [
        { default: true, lang: ${JSON.stringify(profile.languages[0])}, localService: false,
          name: 'Google Arabic', voiceURI: 'Google Arabic' },
      ];
    };
  }

})();
`;
}
