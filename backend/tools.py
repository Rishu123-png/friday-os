# FRIDAY OS — Server-side tools the LLM can call.
# Each tool returns a plain string the model summarizes (mirrors the
# on-device tool loop in www/js/app.js runToolByName).
import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

WMO = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "foggy", 48: "icy fog", 51: "light drizzle", 53: "drizzle",
    55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers",
    81: "showers", 82: "violent showers", 85: "snow showers", 86: "snow showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm",
}

CLIENT_TIMEOUT = httpx.Timeout(20.0)
MAX_FETCH_BYTES = 2_000_000
MAX_REDIRECTS = 4


def _validate_public_url_sync(url: str) -> str:
    """Reject local/private/link-local targets before every network hop.

    The check covers literal IPs and all addresses returned by DNS. Redirects are
    revalidated by ``_safe_get`` so a public URL cannot bounce into localhost or
    cloud metadata endpoints.
    """
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http/https URLs are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Credentials in URLs are not allowed")
    host = (parsed.hostname or "").rstrip(".")
    if not host:
        raise ValueError("URL host is required")
    if parsed.port not in (None, 80, 443):
        raise ValueError("Only standard web ports are allowed")

    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise ValueError("URL host did not resolve") from exc
        addresses = {ipaddress.ip_address(item[4][0]) for item in infos}

    if not addresses or any(not addr.is_global for addr in addresses):
        raise ValueError("Private, local, reserved, and link-local hosts are blocked")
    return parsed.geturl()


async def validate_public_url(url: str) -> str:
    return await asyncio.to_thread(_validate_public_url_sync, url)


async def _safe_get(url: str, max_bytes: int = MAX_FETCH_BYTES) -> tuple[bytes, str]:
    """Bounded server-side GET with per-hop SSRF validation."""
    current = url
    async with httpx.AsyncClient(timeout=CLIENT_TIMEOUT, follow_redirects=False) as client:
        for hop in range(MAX_REDIRECTS + 1):
            current = await validate_public_url(current)
            async with client.stream(
                "GET", current, headers={"User-Agent": "FRIDAY-OS/1.3"}
            ) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location or hop >= MAX_REDIRECTS:
                        raise ValueError("Too many or invalid redirects")
                    current = urljoin(current, location)
                    continue
                response.raise_for_status()
                announced = int(response.headers.get("content-length") or 0)
                if announced > max_bytes:
                    raise ValueError("Remote response is too large")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > max_bytes:
                        raise ValueError("Remote response exceeded the size limit")
                encoding = response.encoding or "utf-8"
                return bytes(data), encoding
    raise ValueError("Fetch failed")


async def get_weather(args: dict) -> str:
    lat = args.get("lat") or 28.6139
    lon = args.get("lon") or 77.2090
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           f"&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
           f"&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3")
    try:
        async with httpx.AsyncClient(timeout=CLIENT_TIMEOUT) as c:
            d = (await c.get(url)).json()
        cur = d.get("current", {})
        desc = WMO.get(cur.get("weather_code"), "unknown")
        day = d.get("daily", {})
        return (f"Now: {cur.get('temperature_2m')}°C, {desc}, feels like "
                f"{cur.get('apparent_temperature')}°, humidity {cur.get('relative_humidity_2m')}%, "
                f"wind {cur.get('wind_speed_10m')} km/h. Today's range "
                f"{day.get('temperature_2m_min', [None])[0]}° to {day.get('temperature_2m_max', [None])[0]}°, "
                f"rain chance {day.get('precipitation_probability_max', [None])[0]}%.")
    except Exception as e:
        return f"Weather unavailable: {e}"


async def wiki_summary(args: dict) -> str:
    q = str(args.get("query") or "").strip()
    if not q:
        return "No query given."
    try:
        async with httpx.AsyncClient(timeout=CLIENT_TIMEOUT) as c:
            r = await c.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{q.replace(' ', '_')}")
            if r.status_code == 200:
                d = r.json()
                if d.get("extract"):
                    return f"{d.get('title')}: {d.get('extract')[:500]}"
            # fall back to search
            s = await c.get("https://en.wikipedia.org/w/api.php",
                            params={"action": "query", "list": "search", "srsearch": q,
                                    "format": "json", "origin": "*", "srlimit": 1})
            hits = s.json().get("query", {}).get("search", [])
            return f"Search result: {hits[0]['title']} — {hits[0]['snippet'][:300]}" if hits else "No result."
    except Exception as e:
        return f"Knowledge lookup failed: {e}"


async def tell_time(args: dict) -> str:
    from datetime import datetime
    return datetime.now().strftime("%A %d %B %Y, %I:%M %p")


async def translate_text(args: dict) -> str:
    text = str(args.get("text") or "")[:450]
    to = args.get("to") or "hi"
    if not text:
        return "No text given."
    src = "hi" if any("\u0900" <= ch <= "\u097F" for ch in text) else "en"
    if src == to:
        return text
    try:
        async with httpx.AsyncClient(timeout=CLIENT_TIMEOUT) as c:
            r = await c.get("https://api.mymemory.translated.net/get",
                            params={"q": text, "langpair": f"{src}|{to}"})
        out = r.json().get("responseData", {}).get("translatedText")
        return out or "Translation failed."
    except Exception as e:
        return f"Translation failed: {e}"


async def fetch_web(args: dict) -> str:
    """Server-side page reader with SSRF and response-size protection."""
    url = str(args.get("url") or "").strip()
    try:
        body, encoding = await _safe_get(url)
        txt = body.decode(encoding, errors="replace")
        # Lightweight HTML→text; this is a reader, not a browser.
        import re
        txt = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", txt, flags=re.I)
        txt = re.sub(r"<[^>]+>", " ", txt)
        txt = re.sub(r"\s+", " ", txt).strip()
        return txt[:2000] or "Page had no readable text."
    except Exception as e:
        return f"Fetch failed: {e}"


async def fetch_raw(args: dict) -> str:
    """Bounded raw page body (for RSS feeds the app parses itself)."""
    url = str(args.get("url") or "").strip()
    try:
        body, encoding = await _safe_get(url)
        return body.decode(encoding, errors="replace")[:20000]
    except Exception as e:
        return f"Fetch failed: {e}"


async def smart_home(args: dict) -> str:
    """Publish a command to MQTT (Home Assistant / ESPHome / Tasmota...).
       e.g. {"device": "light", "command": "on"} → friday/light/set = on"""
    from config import settings
    if not settings.MQTT_HOST:
        return "Smart home not configured on the server (set MQTT_HOST in .env)."
    device = str(args.get("device") or "").strip().lower()
    command = str(args.get("command") or "").strip().lower()
    if not device or command not in ("on", "off", "toggle"):
        return "Give a device and on/off/toggle, e.g. smart_home(light, on)."
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        return "MQTT client not installed on server — run: pip install paho-mqtt"
    topic = f"{settings.MQTT_PREFIX}/{device}/set"
    payload = {"on": "ON", "off": "OFF", "toggle": "TOGGLE"}[command]
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if settings.MQTT_USER:
            client.username_pw_set(settings.MQTT_USER, settings.MQTT_PASS)
        client.connect(settings.MQTT_HOST, settings.MQTT_PORT, 10)
        client.publish(topic, payload, qos=1)
        client.disconnect()
        return f"Sent '{payload}' to {topic}."
    except Exception as e:
        return f"MQTT publish failed: {e}"


# OpenAI-style function schemas advertised to the LLM
TOOL_SCHEMAS = [
    {"type": "function", "function": {"name": "get_weather",
     "description": "Current weather + 3-day forecast at lat/lon (default: Delhi).",
     "parameters": {"type": "object", "properties": {
         "lat": {"type": "number"}, "lon": {"type": "number"}}, "required": []}}},
    {"type": "function", "function": {"name": "search_knowledge",
     "description": "Look up facts/people/places (Wikipedia).",
     "parameters": {"type": "object", "properties": {
         "query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "tell_time",
     "description": "Current date and time.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "translate_text",
     "description": "Translate text to a target language code (hi, en, es...).",
     "parameters": {"type": "object", "properties": {
         "text": {"type": "string"}, "to": {"type": "string"}}, "required": ["text"]}}},
    {"type": "function", "function": {"name": "fetch_web",
     "description": "Read a web page's text content by URL.",
     "parameters": {"type": "object", "properties": {
         "url": {"type": "string"}}, "required": ["url"]}}},
    {"type": "function", "function": {"name": "smart_home",
     "description": "Control smart-home devices via MQTT (Home Assistant/ESPHome/Tasmota). device is e.g. 'light', 'fan', 'ac'; command is on/off/toggle.",
     "parameters": {"type": "object", "properties": {
         "device": {"type": "string"}, "command": {"type": "string", "enum": ["on", "off", "toggle"]}},
         "required": ["device", "command"]}}},
]

TOOL_RUNNERS = {
    "get_weather": get_weather,
    "search_knowledge": wiki_summary,
    "tell_time": tell_time,
    "translate_text": translate_text,
    "fetch_web": fetch_web,
    "smart_home": smart_home,
}
