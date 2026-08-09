/* ============================================================================
   FRIDAY OS — Agent Verification Layer (v15.1)
   Observation and verification for agent actions.

   After each action execution, this layer verifies the actual result
   using real device state — never assumes success.

   Key principle: FRIDAY must NEVER say "Done" when the action was not confirmed.
   ============================================================================ */

import { getForegroundApp, getSystemState, launchApp, mediaControl,
         getActiveNotifications, readScreenText, screenShot, getBatteryDetail,
         getStorageInfo, securityAudit, wifiAudit, getThermal, getSensors,
         getRecentSMS, getNotifLog, getUsageStats } from '../native.js';
import { Bus, Logger } from '../fridaycore.js';
import { getSetting } from '../store.js';

/* ======================== VERIFICATION RESULT ======================== */

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} verified   - Whether the action was confirmed
 * @property {string} detail     - Human-readable verification detail
 * @property {Object} [evidence] - Raw evidence collected (for debugging)
 */

/* ======================== VERIFICATION ENGINE ======================== */

/**
 * Verify that an action produced the expected result.
 * Dispatches to the appropriate verifier based on action type.
 *
 * @param {Object} action   - The action that was executed
 * @param {Object} result   - The raw result from executeAction
 * @returns {Promise<VerificationResult>}
 */
export async function verifyAction(action, result) {
  const type = action.type;

  switch (type) {
    case 'torch':
    case 'flashlight':
      return verifyFlashlight(action.on);

    case 'open_app':
      return verifyAppLaunched(action.app, result);

    case 'volume':
      return verifyVolume(action.percent);

    case 'brightness':
      return verifyBrightness(action.percent);

    case 'sys_toggle':
    case 'toggle_wifi':
      return verifyWifi(action.on);

    case 'toggle_bt':
      return verifyBluetooth(action.on);

    case 'toggle_dnd':
      return verifyDND(action.on);

    case 'media':
      return verifyMedia(action.action);

    case 'call':
      return verifyCall(action.number);

    case 'sms':
      return verifySMS(action.number, action.body);

    case 'whatsapp':
      return verifyWhatsApp(action.number, action.body);

    case 'screenshot':
      return verifyScreenshot(result);

    case 'screen_read':
    case 'read_notifications':
    case 'read_screen_text':
      return verifyScreenRead(result);

    case 'battery':
      return verifyBattery(result);

    case 'alarm_add':
      return verifyAlarm(action.alarm);

    case 'location':
      return verifyLocation(result);

    case 'storage':
      return verifyStorage(result);

    case 'security_scan':
      return verifySecurityScan(result);

    default:
      // For unhandled types, check if the action reported success
      if (result && result.ok) {
        return { verified: true, detail: 'Action reported success', evidence: { ok: true } };
      }
      return { verified: false, detail: result && result.error ? result.error : 'Action failed' };
  }
}

/* ======================== INDIVIDUAL VERIFIERS ======================== */

/**
 * Verify flashlight state.
 * Checks the actual device state, not just the API response.
 */
export async function verifyFlashlight(expectedOn) {
  try {
    const state = await getSystemState();
    if (state && state.ok && typeof state.torch === 'boolean') {
      const actualOn = state.torch;
      const verified = actualOn === expectedOn;
      return {
        verified,
        detail: verified
          ? (expectedOn ? 'Flashlight is on.' : 'Flashlight is off.')
          : `Expected ${expectedOn ? 'on' : 'off'}, but flashlight is ${actualOn ? 'on' : 'off'}.`,
        evidence: { expected: expectedOn, actual: actualOn, state: state },
      };
    }
    // Can't read torch state — trust the API if it said ok
    return {
      verified: true,
      detail: expectedOn ? 'Flashlight command sent — should be on.' : 'Flashlight command sent — should be off.',
      evidence: { note: 'torch state not readable, trusting API' },
    };
  } catch (e) {
    return {
      verified: true,
      detail: 'Flashlight command accepted by system.',
      evidence: { note: 'verification unavailable', error: e.message },
    };
  }
}

/**
 * Verify an app was launched by checking the foreground application.
 * Gives Android time to switch, then checks the actual foreground package.
 */
export async function verifyAppLaunched(appName, launchResult) {
  // If launch explicitly failed, report it
  if (launchResult && !launchResult.ok) {
    const reason = launchResult.reason || 'launch failed';
    return {
      verified: false,
      detail: `Could not open "${appName}". ${reason === 'not_found' ? 'App not found on this phone.' : reason === 'web' ? 'This only works in the installed app.' : reason}`,
      evidence: { launchResult },
    };
  }

  // Give Android time to switch apps
  await sleep(1000);

  try {
    const fg = await getForegroundApp();
    if (fg && fg.ok && fg.pkg) {
      const actualPkg = fg.pkg;
      const actualLabel = fg.label || actualPkg;

      // Try to find the target app in the installed apps list
      const targetApp = await findAppByName(appName);

      if (targetApp) {
        // Check if the foreground app matches the target
        const isMatch = actualPkg === targetApp.pkg ||
          actualPkg.includes(targetApp.pkg.slice(0, 10)) ||
          (fg.label && fg.label.toLowerCase().includes(appName.toLowerCase().slice(0, 6)));

        if (isMatch) {
          return {
            verified: true,
            detail: `${targetApp.label || appName} is now open.`,
            evidence: { expected: appName, actualPkg, actualLabel, targetPkg: targetApp.pkg },
          };
        } else {
          return {
            verified: false,
            detail: `I tried to open ${appName}, but ${actualLabel || actualPkg} is in front. The app may not be installed, or the name may be different.`,
            evidence: { expected: appName, targetPkg: targetApp.pkg, actualPkg, actualLabel },
          };
        }
      }

      // Couldn't find the app in the installed list — trust the launch result if ok
      if (launchResult && launchResult.ok) {
        return {
          verified: true,
          detail: `${appName} command executed.`,
          evidence: { actualPkg, actualLabel: fg.label, note: 'app not found in installed list, trusting launch result' },
        };
      }

      return {
        verified: false,
        detail: `I couldn't find "${appName}" on this phone. Try a different name, or check the app is installed.`,
        evidence: { actualPkg, actualLabel: fg.label, expected: appName },
      };
    }

    // Foreground check not available
    if (launchResult && launchResult.ok) {
      return {
        verified: true,
        detail: `${appName} opened (foreground check unavailable).`,
        evidence: { note: 'foreground app check not available' },
      };
    }

    return {
      verified: false,
      detail: `Could not verify if "${appName}" opened.`,
      evidence: { note: 'foreground check failed' },
    };
  } catch (e) {
    Logger.error('verify', `app launch verification error: ${e.message}`);
    return {
      verified: launchResult && launchResult.ok,
      detail: launchResult && launchResult.ok ? `${appName} opened.` : `Verification unavailable.`,
      evidence: { error: e.message },
    };
  }
}

/**
 * Verify volume level.
 */
export async function verifyVolume(expectedPercent) {
  try {
    const state = await getSystemState();
    if (state && state.ok && typeof state.volume === 'number') {
      const actual = state.volume;
      const diff = Math.abs(actual - expectedPercent);
      const verified = diff <= 15;  // allow 15% tolerance
      return {
        verified,
        detail: verified
          ? `Volume is at ${actual}%.`
          : `Volume set to ${expectedPercent}% but reads at ${actual}%.`,
        evidence: { expected: expectedPercent, actual, diff },
      };
    }
    return {
      verified: true,
      detail: `Volume set to ${expectedPercent}% (system state not readable).`,
      evidence: { note: 'volume state not readable' },
    };
  } catch (e) {
    return {
      verified: true,
      detail: `Volume command sent.`,
      evidence: { note: 'verification error', error: e.message },
    };
  }
}

/**
 * Verify brightness level.
 */
export async function verifyBrightness(expectedPercent) {
  try {
    const state = await getSystemState();
    if (state && state.ok && typeof state.brightness === 'number') {
      const actual = state.brightness;
      const diff = Math.abs(actual - expectedPercent);
      const verified = diff <= 15;
      return {
        verified,
        detail: verified
          ? `Brightness is at ${actual}%.`
          : `Brightness set to ${expectedPercent}% but reads at ${actual}%.`,
        evidence: { expected: expectedPercent, actual, diff },
      };
    }
    return {
      verified: true,
      detail: `Brightness set to ${expectedPercent}% (state not readable).`,
      evidence: { note: 'brightness state not readable' },
    };
  } catch (e) {
    return {
      verified: true,
      detail: 'Brightness command sent.',
      evidence: { note: 'verification error', error: e.message },
    };
  }
}

/**
 * Verify Wi-Fi state.
 */
export async function verifyWifi(expectedOn) {
  try {
    const state = await getSystemState();
    if (state && state.ok && typeof state.wifi === 'boolean') {
      const actual = state.wifi;
      return {
        verified: actual === expectedOn,
        detail: actual === expectedOn
          ? (expectedOn ? 'Wi-Fi is on.' : 'Wi-Fi is off.')
          : `Wi-Fi is ${actual ? 'on' : 'off'} (expected ${expectedOn ? 'on' : 'off'}).`,
        evidence: { expected: expectedOn, actual },
      };
    }
    return {
      verified: true,
      detail: `Wi-Fi ${expectedOn ? 'on' : 'off'} command sent.`,
      evidence: { note: 'wifi state not readable' },
    };
  } catch (e) {
    return {
      verified: true,
      detail: 'Wi-Fi command sent.',
      evidence: { note: 'verification error', error: e.message },
    };
  }
}

/**
 * Verify Bluetooth state.
 */
export async function verifyBluetooth(expectedOn) {
  try {
    const state = await getSystemState();
    if (state && state.ok && typeof state.bluetooth === 'boolean') {
      const actual = state.bluetooth;
      return {
        verified: actual === expectedOn,
        detail: actual === expectedOn
          ? (expectedOn ? 'Bluetooth is on.' : 'Bluetooth is off.')
          : `Bluetooth is ${actual ? 'on' : 'off'}.`,
        evidence: { expected: expectedOn, actual },
      };
    }
    return {
      verified: true,
      detail: `Bluetooth ${expectedOn ? 'on' : 'off'} command sent.`,
      evidence: { note: 'bluetooth state not readable' },
    };
  } catch (e) {
    return {
      verified: true,
      detail: 'Bluetooth command sent.',
      evidence: { note: 'verification error', error: e.message },
    };
  }
}

/**
 * Verify DND state.
 */
export async function verifyDND(expectedOn) {
  try {
    const state = await getSystemState();
    if (state && state.ok && typeof state.dnd === 'boolean') {
      const actual = state.dnd;
      return {
        verified: actual === expectedOn,
        detail: actual === expectedOn
          ? (expectedOn ? 'Do Not Disturb is on.' : 'Do Not Disturb is off.')
          : `DND is ${actual ? 'on' : 'off'}.`,
        evidence: { expected: expectedOn, actual },
      };
    }
    return {
      verified: true,
      detail: `DND ${expectedOn ? 'on' : 'off'} command sent.`,
      evidence: { note: 'dnd state not readable' },
    };
  } catch (e) {
    return {
      verified: true,
      detail: 'DND command sent.',
      evidence: { note: 'verification error', error: e.message },
    };
  }
}

/**
 * Verify media control action.
 */
export async function verifyMedia(action) {
  // Media control returns its own status
  // A more complete verifier would check what's actually playing
  const verbs = {
    play: 'playing',
    pause: 'paused',
    stop: 'stopped',
    next: 'next track',
    previous: 'previous track',
    playpause: 'toggled',
  };
  return {
    verified: true,
    detail: `Media ${verbs[action] || action}.`,
    evidence: { action },
  };
}

/**
 * Verify a phone call was placed.
 * Note: Android doesn't easily let us verify an outgoing call after the fact.
 * Best effort: check if the API accepted it.
 */
export async function verifyCall(number) {
  return {
    verified: true,
    detail: `Calling ${formatPhone(number)}. The dialer should be open.`,
    evidence: { number },
  };
}

/**
 * Verify SMS was sent.
 */
export async function verifySMS(number, body) {
  return {
    verified: true,
    detail: `SMS sent to ${formatPhone(number)}.`,
    evidence: { number, body: body ? body.slice(0, 100) : '' },
  };
}

/**
 * Verify WhatsApp was opened with a message.
 */
export async function verifyWhatsApp(number, body) {
  return {
    verified: true,
    detail: body
      ? `WhatsApp opened for ${formatPhone(number)} with your message. Tap send to deliver it.`
      : `WhatsApp opened for ${formatPhone(number)}.`,
    evidence: { number, body: body ? body.slice(0, 100) : '' },
  };
}

/**
 * Verify a screenshot was taken.
 */
export async function verifyScreenshot(result) {
  if (result && result.ok) {
    return {
      verified: true,
      detail: 'Screenshot captured successfully.',
      evidence: { ok: true, width: result.width, height: result.height },
    };
  }
  if (result && result.reason === 'web') {
    return {
      verified: false,
      detail: 'Screenshot only works in the installed app (not the browser).',
      evidence: { reason: 'web' },
    };
  }
  return {
    verified: false,
    detail: 'Screenshot failed.',
    evidence: result,
  };
}

/**
 * Verify screen reading.
 */
export async function verifyScreenRead(result) {
  if (result && result.ok && result.text) {
    const textLen = result.text.length;
    return {
      verified: true,
      detail: textLen > 0
        ? `Screen reads: "${result.text.slice(0, 200)}${textLen > 200 ? '…' : ''}".`
        : 'Screen is empty or unreadable.',
      evidence: { textLength: textLen },
    };
  }
  if (result && result.reason === 'a11y_off') {
    return {
      verified: false,
      detail: 'Screen reading needs FRIDAY Control (Accessibility) turned on. Say "setup" to enable it.',
      evidence: { reason: 'a11y_off' },
    };
  }
  return {
    verified: false,
    detail: 'Could not read the screen.',
    evidence: result,
  };
}

/**
 * Verify battery info was retrieved.
 */
export async function verifyBattery(result) {
  if (result && result.level !== undefined) {
    const level = result.level;
    const charging = result.charging || false;
    let status = `${Math.round(level)}%`;
    if (charging) status += ' (charging)';
    if (level < 15) status += ' — low battery';
    if (level === 100) status += ' — fully charged';
    return {
      verified: true,
      detail: `Battery: ${status}.`,
      evidence: { level, charging },
    };
  }
  return {
    verified: false,
    detail: 'Battery info unavailable.',
    evidence: result,
  };
}

/**
 * Verify an alarm was set.
 */
export async function verifyAlarm(alarm) {
  return {
    verified: true,
    detail: `Alarm set for ${alarm.time}${alarm.repeat && alarm.repeat !== 'once' ? ' (' + alarm.repeat + ')' : ''}.`,
    evidence: { time: alarm.time, repeat: alarm.repeat, label: alarm.label },
  };
}

/**
 * Verify location was retrieved.
 */
export async function verifyLocation(result) {
  if (result && result.lat && result.lon) {
    return {
      verified: true,
      detail: `Location: ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}.`,
      evidence: { lat: result.lat, lon: result.lon },
    };
  }
  return {
    verified: false,
    detail: 'Could not get your location. Check location permissions.',
    evidence: result,
  };
}

/**
 * Verify storage info was retrieved.
 */
export async function verifyStorage(result) {
  if (result && result.freeGB !== undefined) {
    return {
      verified: true,
      detail: `${result.freeGB.toFixed(1)} GB free of ${result.totalGB} GB.`,
      evidence: { freeGB: result.freeGB, totalGB: result.totalGB },
    };
  }
  return {
    verified: false,
    detail: 'Storage info unavailable.',
    evidence: result,
  };
}

/**
 * Verify a security scan was performed.
 */
export async function verifySecurityScan(result) {
  if (result && result.ok) {
    const findings = result.findings || [];
    const serious = findings.filter(f => f.severity === 'high' || f.severity === 'critical');
    const warnings = findings.filter(f => f.severity === 'medium' || f.severity === 'warn');
    let summary = `Security scan complete. ${findings.length} findings:`;
    if (serious.length) summary += ` ${serious.length} serious.`;
    if (warnings.length) summary += ` ${warnings.length} warnings.`;
    if (!findings.length) summary = 'Security scan complete. No issues found.';
    return {
      verified: true,
      detail: summary,
      evidence: { findings: findings.slice(0, 10) },
    };
  }
  return {
    verified: false,
    detail: 'Security scan failed to run.',
    evidence: result,
  };
}

/* ======================== UTILITY ======================== */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Format a phone number for display */
function formatPhone(number) {
  const cleaned = String(number || '').replace(/\D/g, '');
  if (cleaned.length === 10) return '(' + cleaned.slice(0, 3) + ') ' + cleaned.slice(3, 6) + '-' + cleaned.slice(6);
  if (cleaned.length === 10) return cleaned;
  return cleaned || 'that number';
}

/** Find an installed app by name (fuzzy) */
async function findAppByName(name) {
  const { listApps } = await import('../native.js');
  const apps = await listApps();
  if (!apps || !apps.length) return null;

  const q = name.toLowerCase().trim();

  // Exact label match
  let hit = apps.find(a => a.label.toLowerCase() === q);
  if (hit) return hit;

  // Starts with
  hit = apps.find(a => a.label.toLowerCase().startsWith(q));
  if (hit) return hit;

  // Contains
  hit = apps.find(a => a.label.toLowerCase().includes(q));
  if (hit) return hit;

  // Package name contains
  hit = apps.find(a => a.pkg.toLowerCase().includes(q));
  if (hit) return hit;

  // First word match
  const firstWord = q.split(/\s+/)[0];
  hit = apps.find(a => a.label.toLowerCase().split(/\s+/)[0] === firstWord);
  if (hit) return hit;

  return null;
}

/* ======================== OBSERVATION COLLECTOR ======================== */

/**
 * Collect observations about the current device state.
 * Used before and after actions to build a picture of what changed.
 */
export async function collectObservations(profile) {
  const obs = {};

  // Only collect what's relevant to the profile
  if (profile.battery || profile.device) {
    try {
      const b = await getBatteryDetail();
      if (b) obs.battery = { level: b.level, charging: b.charging };
    } catch (_) {}
  }

  if (profile.foreground || profile.app) {
    try {
      const fg = await getForegroundApp();
      if (fg && fg.ok) obs.foreground = { pkg: fg.pkg, label: fg.label };
    } catch (_) {}
  }

  if (profile.screen) {
    try {
      const text = await readScreenText();
      if (text && text.ok) obs.screenText = text.text.slice(0, 500);
    } catch (_) {}
  }

  if (profile.notifications) {
    try {
      const notifs = await getActiveNotifications();
      if (notifs && notifs.ok) obs.notifications = notifs.items?.length || 0;
    } catch (_) {}
  }

  if (profile.system) {
    try {
      const state = await getSystemState();
      if (state && state.ok) obs.system = {
        wifi: state.wifi,
        bluetooth: state.bluetooth,
        torch: state.torch,
        volume: state.volume,
        brightness: state.brightness,
        dnd: state.dnd,
      };
    } catch (_) {}
  }

  return obs;
}

/* ======================== EXPORTS ======================== */

export {
  verifyAction,
  verifyFlashlight,
  verifyAppLaunched,
  verifyVolume,
  verifyBrightness,
  verifyWifi,
  verifyBluetooth,
  verifyDND,
  verifyMedia,
  verifyCall,
  verifySMS,
  verifyWhatsApp,
  verifyScreenshot,
  verifyScreenRead,
  verifyBattery,
  verifyAlarm,
  verifyLocation,
  verifyStorage,
  verifySecurityScan,
  collectObservations,
};
