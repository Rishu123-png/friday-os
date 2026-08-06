
/* FRIDAY OS v20.0 HUD Data Populator */
import { $ } from './ui.js';

export function updateHUDV20(data = {}) {
  if ($('#statusBattery')) $('#statusBattery').textContent = (data.battery || 70) + '%';
  if ($('#statusCharging')) $('#statusCharging').style.display = data.charging ? 'block' : 'none';
  
  if ($('#locCity')) $('#locCity').textContent = data.city || 'GREATER NOIDA';
  if ($('#locRegion')) $('#locRegion').textContent = data.region || 'UTTAR PRADESH, INDIA';
  if ($('#locCoords')) $('#locCoords').textContent = data.coords || '28.47° N, 77.50° E';
  
  if ($('#compassValue')) $('#compassValue').textContent = (data.heading || 135) + '° ' + (data.dir || 'SE');
  
  if ($('#netSsid')) $('#netSsid').textContent = data.ssid || 'FRIDAY_HOME_5G';
  if ($('#netSignal')) $('#netSignal').textContent = (data.signal || -42) + ' dBm';
  if ($('#netIp')) $('#netIp').textContent = data.ip || '192.168.1.105';
  
  // Update telemetry circles
  const cpu = data.cpu || 22;
  const ram = data.ram || 48;
  const storage = data.storage || 62;
  
  const telCircles = document.querySelectorAll('.tel-circle');
  if (telCircles[0]) {
    telCircles[0].style.setProperty('--p', cpu);
    telCircles[0].querySelector('span').textContent = cpu + '%';
  }
  if (telCircles[1]) {
    telCircles[1].style.setProperty('--p', ram);
    telCircles[1].querySelector('span').textContent = ram + '%';
  }
  if (telCircles[2]) {
    telCircles[2].style.setProperty('--p', storage);
    telCircles[2].querySelector('span').textContent = storage + '%';
  }
}

// Auto-run a mock update for preview purposes
setTimeout(() => {
  updateHUDV20();
}, 2000);
