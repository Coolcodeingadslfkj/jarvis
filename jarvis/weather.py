"""Weather for the HOME briefing: Open-Meteo (no API key) + IP geolocation, cached."""

import json
import time
import urllib.parse
import urllib.request

_cache = {"at": 0, "key": None, "data": None}
TTL = 15 * 60

CODES = {
    0: ("Clear sky", "clear"), 1: ("Mainly clear", "clear"), 2: ("Partly cloudy", "partly"), 3: ("Overcast", "cloud"),
    45: ("Fog", "fog"), 48: ("Rime fog", "fog"), 51: ("Light drizzle", "rain"), 53: ("Drizzle", "rain"),
    55: ("Heavy drizzle", "rain"), 56: ("Freezing drizzle", "rain"), 57: ("Freezing drizzle", "rain"),
    61: ("Light rain", "rain"), 63: ("Rain", "rain"), 65: ("Heavy rain", "rain"), 66: ("Freezing rain", "rain"),
    67: ("Freezing rain", "rain"), 71: ("Light snow", "snow"), 73: ("Snow", "snow"), 75: ("Heavy snow", "snow"),
    77: ("Snow grains", "snow"), 80: ("Rain showers", "rain"), 81: ("Rain showers", "rain"), 82: ("Violent showers", "rain"),
    85: ("Snow showers", "snow"), 86: ("Snow showers", "snow"), 95: ("Thunderstorm", "storm"), 96: ("Thunderstorm, hail", "storm"),
    99: ("Thunderstorm, hail", "storm"),
}


def _get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "JARVIS-HUD/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def locate(query=""):
    """(lat, lon, name, country_code) from a place name, or from the public IP when empty."""
    if query:
        r = _get("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + urllib.parse.quote(query))
        if not r.get("results"):
            raise RuntimeError(f"Unknown location: {query}")
        g = r["results"][0]
        return g["latitude"], g["longitude"], f"{g['name']}, {g.get('admin1') or g.get('country', '')}".strip(", "), g.get("country_code", "")
    r = _get("https://ipinfo.io/json")
    lat, lon = (float(x) for x in r["loc"].split(","))
    return lat, lon, f"{r.get('city', '')}, {r.get('region', '')}".strip(", "), r.get("country", "")


def forecast(location="", unit="auto", force=False):
    key = (location, unit)
    if not force and _cache["data"] and _cache["key"] == key and time.time() - _cache["at"] < TTL:
        return _cache["data"]
    lat, lon, name, cc = locate(location)
    if unit == "auto":
        unit = "fahrenheit" if cc in ("US", "LR", "MM", "BS", "BZ", "KY", "PW") else "celsius"
    wind = "mph" if unit == "fahrenheit" else "kmh"
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "auto", "temperature_unit": unit, "wind_speed_unit": wind,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
        "hourly": "temperature_2m,precipitation_probability,weather_code",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
        "forecast_days": 6,
    })
    r = _get("https://api.open-meteo.com/v1/forecast?" + q)
    cur = r["current"]
    now_idx = 0
    times = r["hourly"]["time"]
    cur_time = cur["time"][:13]
    for i, t in enumerate(times):
        if t[:13] == cur_time:
            now_idx = i
            break
    hours = [{"time": times[i][11:16], "temp": r["hourly"]["temperature_2m"][i],
              "rain": r["hourly"]["precipitation_probability"][i], "kind": CODES.get(r["hourly"]["weather_code"][i], ("", "cloud"))[1]}
             for i in range(now_idx, min(now_idx + 24, len(times)))]
    d = r["daily"]
    days = [{"date": d["time"][i], "code": d["weather_code"][i], "text": CODES.get(d["weather_code"][i], ("Unknown", "cloud"))[0],
             "kind": CODES.get(d["weather_code"][i], ("", "cloud"))[1], "max": d["temperature_2m_max"][i],
             "min": d["temperature_2m_min"][i], "rain": d["precipitation_probability_max"][i]} for i in range(len(d["time"]))]
    text, kind = CODES.get(cur["weather_code"], ("Unknown", "cloud"))
    data = {"location": name, "unit": "°F" if unit == "fahrenheit" else "°C", "wind_unit": wind,
            "temp": cur["temperature_2m"], "feels": cur["apparent_temperature"], "humidity": cur["relative_humidity_2m"],
            "wind": cur["wind_speed_10m"], "text": text, "kind": kind, "is_day": bool(cur["is_day"]),
            "sunrise": d["sunrise"][0][11:16], "sunset": d["sunset"][0][11:16], "hours": hours, "days": days,
            "fetched": time.time()}
    _cache.update(at=time.time(), key=key, data=data)
    return data
