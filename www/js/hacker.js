/* ===== FRIDAY OS — Ethical Hacker toolkit (v7.4 REDTEAM) =====
   Pure logic, no native deps: password-lab scoring, phishing URL heuristics,
   MAC-vendor lookup, port risk map, report composer.
   THE RULE: only your own network, your own accounts, your own device. */

/* ================= PASSWORD LAB ================= */

const COMMON = ['password','pass123','123456','12345678','qwerty','letmein','iloveyou',
  'admin','welcome','monkey','dragon','sunshine','master','football','abc123','111111',
  '123123','india123','password1','pooja','rahul','priya','amit','rohit','sachin'];

const LEET = { '@':'a','4':'a','8':'b','3':'e','1':'i','0':'o','$':'s','5':'s','7':'t','!':'i' };

function deleet(pw) {
  return pw.toLowerCase().split('').map(c => LEET[c] || c).join('');
}

/** Score a password like a real auditor. -> { bits, grade, notes[] } */
export function entropyScore(pwRaw) {
  const pw = String(pwRaw || '');
  const notes = [];
  if (!pw) return { bits: 0, grade: 'empty', notes: ['Nothing to score.'] };

  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;

  let bits = pw.length ? Math.round(pw.length * Math.log2(pool || 1)) : 0;

  const low = pw.toLowerCase(), flat = deleet(pw);
  if (COMMON.includes(low) || COMMON.includes(flat)) {
    notes.push('It is in the top-25 most-guessed passwords on Earth — cracked instantly.');
    bits = Math.min(bits, 12);
  }
  if (/^(.)\1+$/.test(pw)) { notes.push('All one character — no effort for a cracker.'); bits = Math.min(bits, 10); }
  const SEQ_RE = /^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/i;
  if (SEQ_RE.test(low) || SEQ_RE.test(flat)) {   // raw + leet-flattened (digits-as-digits AND leet)
    notes.push('Starts with a keyboard sequence (1234/qwer...) — dictionary rule fodder.');
    bits = Math.min(bits, 18);
  }
  if (/(19|20)\d{2}/.test(pw)) { notes.push('Contains a year — birthdays/years are guessed in the first minute.'); bits -= 10; }
  if (/([a-z])\1{2,}/i.test(pw)) { notes.push('Triple repeated letters weaken it.'); bits -= 8; }
  if (pw.length < 8) notes.push('Under 8 characters — brute-force territory.');
  if (pw.length >= 14 && pool >= 62) notes.push('Length + mixed charset — this is how pros do it.');
  if (bits < 28) notes.push('Tip: a 4-word passphrase beats a short complex word.');

  bits = Math.max(4, Math.round(bits));
  const grade = bits < 28 ? 'TERRIBLE' : bits < 36 ? 'WEAK' : bits < 60 ? 'DECENT'
              : bits < 76 ? 'STRONG' : 'FORTRESS';
  return { bits, grade, notes };
}

/* ================= PHISHING URL HEURISTICS ================= */

const BAD_TLDS = ['tk','ml','ga','cf','gq','xyz','top','club','online','site','live','icu','cam'];
const LURES = ['verify','verification','suspended','blocked','urgent','winner','prize','gift',
  'free','claim','reward','lottery','refund','cashback','kyc','update-kyc','penalty','challan',
  ' security','secure-login','login-verify','account-restore','otp'];
const BRANDS = ['paypal','paytm','phonepe','gpay','googlepay','amazon','flipkart','sbi','hdfc',
  'icici','axisbank','kotak','irctc','facebook','instagram','whatsapp','netflix','microsoft',
  'appleid','incometax','epfo','aadhaar','uidai','electricity'];
const SHORTENERS = ['bit.ly','tinyurl','t.co','goo.gl','cutt.ly','rb.gy','shorturl','is.gd'];

function levish(a, b) {   // tiny edit distance for brand lookalikes
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++)
      cur[j + 1] = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/* Leet-class brand regex: "paypal" -> p[a4@]yp[a4@][li1!|] so "paypa1",
   "paypaI", "paypa|" all hit. The compare-regex escape trick  */
const CLASS = { a: 'a4@', e: 'e3', i: 'i1!|l', l: 'li1!|', o: 'o0', s: 's5$z2', t: 't7', b: 'b8', g: 'g69', z: 'z2s5$' };
function brandRegex(b) {
  const esc = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(b.split('').map(c => (CLASS[c] ? '[' + CLASS[c] + ']' : esc(c))).join(''), 'i');
}

/** Score an URL for phishing risk. -> { score 0..100, level, flags[] } */
export function phishScore(urlRaw) {
  const flags = [];
  let score = 0;
  let url = String(urlRaw || '').trim();
  if (!url) return { score: 0, level: 'CLEAN', flags: ['No link given.'] };
  if (!/^[a-z]+:\/\//i.test(url)) url = 'http://' + url;

  let u;
  try { u = new URL(url); } catch (_) {
    return { score: 40, level: 'SUS', flags: ["I can't even parse that link — suspicious by itself."] };
  }
  const host = (u.hostname || '').toLowerCase();
  const full = url.toLowerCase();

  if (u.protocol === 'http:') { score += 15; flags.push('Plain HTTP — no encryption, logins on it are visible.'); }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { score += 35; flags.push('Host is a raw IP, not a domain — classic phishing move.'); }
  if (url.includes('@')) { score += 30; flags.push('Contains "@" — browsers ignore everything before it (your-bank.com@evil.com trick).'); }
  if (host.startsWith('xn--') || host.includes('.xn--')) { score += 25; flags.push('Punycode domain — may imitate a real brand with lookalike letters.'); }
  const tld = host.split('.').pop();
  if (BAD_TLDS.includes(tld)) { score += 20; flags.push(`Free/cheap ".${tld}" domain — heavily abused by scammers.`); }
  if (SHORTENERS.some(s => host === s)) { score += 18; flags.push('URL shortener hides the real destination — expand it before trusting.'); }
  if ((host.split('.').length - 1) > 3) { score += 10; flags.push('Very long chain of subdomains (secure.login.auth.x.y.z...) — misdirection.'); }

  // brand impersonation: brand present/lookalike but not the real domain
  const label = host.split('.').slice(-2)[0] || host;
  for (const b of BRANDS) {
    const br = brandRegex(b);
    const hit = br.test(host);
    if (hit && !(br.test(label) && (host === label + '.com' || host === label + '.in'
        || host === label + '.co.in' || host === label + '.org' || host === label + '.net'))) {
      score += 40; flags.push(`Imitates "${b}" but this is NOT their real domain (${host}) — classic spoof.`);
      break;
    }
    const d = levish(label, b);
    if (d === 1) {
      score += 40; flags.push(`"${label}" is one typo away from "${b}" — paypa1-style spoof.`);
      break;
    }
  }

  const lure = LURES.find(w => full.includes(w.trim()));
  if (lure) { score += 15; flags.push(`Pressure word "${lure.trim()}" — phishing runs on urgency and greed.`); }

  score = Math.min(100, score);
  const level = score >= 70 ? 'PHISHING' : score >= 40 ? 'SUS' : score >= 20 ? 'CAUTION' : 'CLEAN';
  if (!flags.length) flags.push('No classic phishing markers found. Still — only trust what you asked for.');
  return { score, level, flags };
}

/* ================= MAC VENDOR LOOKUP (OUI) ================= */

const OUI = {
  '3c5a37': 'Samsung', '8c77e1': 'Samsung', 'f47b5e': 'Samsung',
  'f0ee10': 'Samsung', 'a04278': 'Samsung',
  'ac3743': 'Apple', 'f0d1a9': 'Apple', 'a4b197': 'Apple', '6849fd': 'Apple',
  '3ce072': 'Apple', '147dda': 'Apple',
  'f8a45f': 'Xiaomi', '64cc2e': 'Xiaomi', '50ec50': 'Xiaomi', '7c1dd9': 'Xiaomi',
  'e0553d': 'OnePlus', '94e70b': 'OnePlus', 'c0eefb': 'OnePlus',
  'ac1e92': 'Oppo', 'dcb0c5': 'Oppo', '40b89a': 'Oppo',
  '5ccf7f': 'Espressif (IoT chip)', '84f3eb': 'Espressif (IoT chip)',
  '24a160': 'Espressif (IoT chip)', '3c71bf': 'Espressif (IoT chip)', 'd8132a': 'Espressif (IoT chip)',
  '001a2b': 'TP-Link', '50c7bf': 'TP-Link', 'b0487a': 'TP-Link', 'd857ef': 'TP-Link',
  '9ced20': 'D-Link', '1c7ee5': 'D-Link', '783b5a': 'Netgear', '744401': 'Netgear',
  'b03956': 'Cisco', 'd8b190': 'Cisco', 'e0db55': 'Cisco',
  'b827eb': 'Raspberry Pi', 'dca632': 'Raspberry Pi', 'e45f01': 'Raspberry Pi',
  'd4a33d': 'Amazon (Echo/Fire)', '68d925': 'Amazon (Echo/Fire)', '747548': 'Amazon (Echo/Fire)',
  'f4032a': 'Google', '546009': 'Google', 'd850e6': 'Google', '38f479': 'Google',
  '001c56': 'Sony', '78c881': 'Sony', '10a4da': 'LG', '34feda': 'LG',
  '340804': 'HP', 'a0d3c1': 'HP', '9440c9': 'Dell', 'b0d59c': 'Dell',
  '4cedfb': 'Huawei', 'c84dc6': 'Huawei', '20ab37': 'Huawei',
  '38bc01': 'Vivo', 'e86c38': 'Vivo', '2c9d1e': 'Realme', 'c86f1d': 'Realme',
  '5c4979': 'Realme'
};

function normOui(mac) {
  return String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6);
}

/** Best-effort vendor guess from a MAC address. */
export function vendorOf(mac) {
  const oui = normOui(mac);
  if (!oui) return 'unknown';
  if (OUI[oui]) return OUI[oui];
  // cloud/VM ranges
  if (/^(0242|0642|0a42)/.test(oui)) return 'VM/container';
  if (/^(0200|0601|080027|001c14)/.test(oui)) return 'Virtual machine';
  // locally-administered bit -> randomized MAC (privacy feature of modern phones)
  const first = parseInt(oui.slice(0, 2), 16);
  if ((first & 0x02) === 0x02) return 'phone (randomized MAC)';
  return 'unknown';
}

/* ================= PORT RISK MAP ================= */

const PORT_NOTES = {
  21:   { name: 'FTP', risk: 'high',   why: 'cleartext file transfer' },
  22:   { name: 'SSH', risk: 'note',   why: 'remote shell — fine if you use it' },
  23:   { name: 'Telnet', risk: 'crit', why: 'cleartext everything — botnets scan for this' },
  53:   { name: 'DNS', risk: 'note',   why: 'normal on routers' },
  80:   { name: 'HTTP panel', risk: 'note', why: 'router/device web panel — protect with a strong admin password' },
  111:  { name: 'rpcbind', risk: 'high', why: 'old Unix service, no business on a phone/home net' },
  135:  { name: 'MS-RPC', risk: 'high', why: 'Windows RPC exposed' },
  139:  { name: 'NetBIOS', risk: 'high', why: 'old file sharing' },
  445:  { name: 'SMB', risk: 'high',   why: 'Windows shares — WannaCry loved this' },
  554:  { name: 'RTSP', risk: 'warn',  why: 'usually a CCTV/IP camera — change its default password' },
  631:  { name: 'IPP printer', risk: 'note', why: 'printer service, usually fine' },
  1723: { name: 'PPTP VPN', risk: 'warn', why: 'outdated VPN protocol' },
  1900: { name: 'UPnP', risk: 'warn',  why: 'lets devices open ports — disable on the router if unused' },
  2323: { name: 'Telnet alt', risk: 'crit', why: 'mirai botnet bait' },
  3306: { name: 'MySQL', risk: 'high', why: 'database exposed to the network' },
  5000: { name: 'UPnP/Flask', risk: 'warn', why: 'dev servers and UPnP share it' },
  5353: { name: 'mDNS', risk: 'note',  why: 'Chromecast/AirPrint chatter, normal' },
  5900: { name: 'VNC', risk: 'high',   why: 'remote desktop' },
  7547: { name: 'TR-069', risk: 'warn', why: 'ISP remote-manages your router — always open from the ISP side' },
  8080: { name: 'web-alt', risk: 'warn', why: 'proxy/admin panel — check what it is' },
  8291: { name: 'Winbox', risk: 'crit', why: 'MikroTik router admin — big target' },
  8443: { name: 'https-alt', risk: 'note', why: 'alternate admin panel' },
  9100: { name: 'printer raw', risk: 'note', why: 'network printer, usually fine' }
};

export function describePort(p) {
  return PORT_NOTES[p] || { name: 'port ' + p, risk: 'note', why: '' };
}

/* ================= REPORT COMPOSER ================= */

export function netReport(audit, hosts) {
  const lines = ['**RECON — your network**'];
  if (audit && audit.ok) {
    const sec = String(audit.security || 'unknown');
    const secBad = /open|wep/.test(sec);
    lines.push(`WiFi: **${audit.ssid || '(name hidden — grant location)'}** · ${sec} ${secBad ? '🚨' : '✅'}`);
    if (secBad) lines.push('🚨 Your WiFi encryption is weak — change it to WPA2/WPA3 in the router right now.');
    lines.push(`Gateway: ${audit.gateway || '?'} · You: ${audit.ip || '?'}`);
  }
  lines.push('', `**${hosts.length} device${hosts.length === 1 ? '' : 's'} online:**`);
  hosts.slice(0, 25).forEach(h => {
    const tag = h.isSelf ? ' ⬅ you' : h.isGateway ? ' [router]' : '';
    const vend = vendorOf(h.mac);
    lines.push(`▸ ${h.ip}${tag} — ${vend}${h.mac ? ` (${h.mac})` : ''}`);
  });
  const unknown = hosts.filter(h => vendorOf(h.mac) === 'unknown' && !h.isSelf && !h.isGateway);
  lines.push('');
  if (hostIsCrowded(hosts, unknown)) {
    lines.push(`⚠ ${unknown.length} device(s) I don't recognize: ${unknown.map(h => h.ip).join(', ')}`);
    lines.push('If one is not yours → someone is on your WiFi. Change the WiFi password NOW.');
  } else {
    lines.push('✅ No mystery devices. If the count looks bigger than your household, tell me.');
  }
  return lines.join('\n');
}

function hostIsCrowded(hosts, unknown) { return unknown.length > 0; }
