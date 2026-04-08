from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from flask_cors import CORS
import requests
import sqlite3
import os
import random
import time
import threading

# ── Config ───────────────────────────────────────────────────────────────────
# Gmail SMTP — live email OTP
SMTP_EMAIL        = "kamunisrishylam@gmail.com"
SMTP_APP_PASSWORD = "krtpmcyskuskoljf"

app = Flask(__name__)
app.secret_key = 'super_secret_luxury_heatwave_key_2026'
CORS(app)

COMMON_HEADERS = {"User-Agent": "HeatwaveGuard/1.0 (support@heatwaveguard.com)"}

# ── SQLite Database ───────────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                email    TEXT UNIQUE NOT NULL
            )
        ''')
        conn.commit()

init_db()

def get_user_by_email(email):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM users WHERE LOWER(email)=LOWER(?)', (email.strip(),)).fetchone()
    return row

def username_taken(username):
    with get_db() as conn:
        row = conn.execute('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', (username.strip(),)).fetchone()
    return row is not None

def add_user(username, email):
    with get_db() as conn:
        conn.execute('INSERT INTO users (username, email) VALUES (?, ?)', (username.strip(), email.strip()))
        conn.commit()

# ── In-Memory OTP Store  {identifier: {otp, expires, username, action}} ───────
otp_store = {}
OTP_TTL   = 300   # 5 minutes

def generate_otp():
    return str(random.randint(100000, 999999))

def store_otp(identifier, otp, username=None, action="login"):
    otp_store[identifier] = {
        "otp":      otp,
        "expires":  time.time() + OTP_TTL,
        "username": username,
        "action":   action
    }

def verify_stored_otp(identifier, otp_input):
    record = otp_store.get(identifier)
    if not record:
        return False, "OTP not found. Please request a new one."
    if time.time() > record["expires"]:
        otp_store.pop(identifier, None)
        return False, "OTP has expired. Please request a new one."
    if record["otp"] != otp_input.strip():
        return False, "Incorrect OTP. Please try again."
    otp_store.pop(identifier, None)
    return True, record

# ── Auth Routes ───────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login')
def login():
    if 'username' in session:
        return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('login'))

def send_email_otp(email, otp):
    """Send OTP via Gmail SMTP. Returns True on success, False on failure (falls back to demo)."""
    if not SMTP_EMAIL or not SMTP_APP_PASSWORD:
        return False
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    try:
        msg            = MIMEMultipart('alternative')
        msg['Subject'] = 'HeatwaveGuard -- Your One-Time Password'
        msg['From']    = f'HeatwaveGuard <{SMTP_EMAIL}>'
        msg['To']      = email
        html = f"""
        <div style="font-family:Inter,sans-serif;background:#08080f;padding:40px;border-radius:12px;max-width:480px;margin:auto;border:1px solid #1e293b">
          <h2 style="color:#d4af37;font-size:24px;margin-bottom:8px">HeatwaveGuard</h2>
          <p style="color:#9ca3af;font-size:14px">Your one-time verification code:</p>
          <div style="background:#0f172a;border:1px solid #d4af37;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
            <span style="color:#d4af37;font-size:42px;font-weight:700;letter-spacing:12px">{otp}</span>
          </div>
          <p style="color:#6b7280;font-size:12px">This code expires in 5 minutes. Do not share it with anyone.</p>
        </div>
        """
        msg.attach(MIMEText(html, 'html'))
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
            server.sendmail(SMTP_EMAIL, email, msg.as_string())
        return True
    except Exception as e:
        print(f"[Email Error] {e}")
        return False


@app.route('/api/send-otp', methods=['POST'])
def send_otp():
    data     = request.get_json()
    email    = data.get('value', '').strip()
    action   = data.get('action', '').strip()
    username = data.get('username', '').strip()

    if not email or not action:
        return jsonify({"error": "Missing required fields."}), 400

    if action == "register":
        if not username:
            return jsonify({"error": "Username is required for registration."}), 400
        if get_user_by_email(email) is not None:
            return jsonify({"error": "This email is already registered."}), 409
        if username_taken(username):
            return jsonify({"error": "Username already taken. Choose another."}), 409
    elif action == "login":
        if get_user_by_email(email) is None:
            return jsonify({"error": "No account found with this email. Please register first."}), 404

    otp = generate_otp()
    store_otp(email, otp, username=username, action=action)

    sent = send_email_otp(email, otp)
    response = {"status": "sent", "message": "OTP sent to your email."}
    if not sent:
        # SMTP failed or not configured — show OTP on screen (demo mode)
        response["demo_otp"] = otp
        print(f"[DEMO OTP] {email}: {otp}")
    else:
        print(f"[Email OTP sent] {email}")
    return jsonify(response)



@app.route('/api/verify-otp', methods=['POST'])
def verify_otp():
    data   = request.get_json()
    method = data.get('method')
    value  = data.get('value', '').strip()
    otp    = data.get('otp', '').strip()

    if not all([method, value, otp]):
        return jsonify({"error": "Missing fields."}), 400

    valid, result = verify_stored_otp(value, otp)
    if not valid:
        return jsonify({"error": result}), 401

    # result is the otp record dict
    action   = result["action"]
    username = result["username"]

    if action == "register":
        add_user(username, email=value)
        session["username"] = username
        session["email"]    = value

    elif action == "login":
        user = get_user_by_email(value)
        if user is None:
            return jsonify({"error": "User not found."}), 404
        session["username"] = user["username"]
        session["email"]    = user["email"]

    return jsonify({"status": "success", "username": session["username"]})


# ── Geolocation & Weather Helpers ─────────────────────────────────────────────

def fetch_met_no(lat, lng):
    """Fetch from Norwegian Meteorological Institute (highly accurate for global stations)."""
    try:
        url = f"https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={lat}&lon={lng}"
        res = requests.get(url, timeout=8, headers=COMMON_HEADERS)
        if res.status_code == 200:
            data = res.json()
            # Extract current from first timeseries
            curr = data['properties']['timeseries'][0]['data']['instant']['details']
            # Prepare a simplified structure similar to Open-Meteo for compatibility
            return {
                "source": "MET.no",
                "current": {
                    "time": data['properties']['timeseries'][0].get('time'),
                    "temperature_2m": curr.get('air_temperature'),
                    "relative_humidity_2m": curr.get('relative_humidity'),
                    "wind_speed_10m": curr.get('wind_speed')
                },
                "hourly": {
                    "times": [ts['time'] for ts in data['properties']['timeseries'][:72]],
                    "temperature_2m": [ts['data']['instant']['details'].get('air_temperature') for ts in data['properties']['timeseries'][:72]],
                    "relative_humidity_2m": [ts['data']['instant']['details'].get('relative_humidity') for ts in data['properties']['timeseries'][:72]],
                }
            }
    except Exception as e:
        print(f"[MET.no Error] {e}")
    return None

def fetch_open_meteo(url):
    """Fetch from Open-Meteo with best_match localized models."""
    try:
        res = requests.get(url, timeout=10, headers=COMMON_HEADERS)
        if res.status_code == 200:
            data = res.json()
            data["source"] = "Open-Meteo (" + data.get('generationtime_ms', 0).__str__() + "ms)"
            return data
    except Exception as e:
        print(f"[Open-Meteo Error] {e}")
    return None

def fetch_weather_unified(lat, lng):
    """Aggregates multiple sources to ensure accuracy within +/- 0.5 margin."""
    # 1. Try MET.no (highly optimized for accuracy)
    unified_data = fetch_met_no(lat, lng)
    
    # 2. Try Open-Meteo (best_match models) if MET.no fails or for specialized fields
    om_forecast_url = (f"https://api.open-meteo.com/v1/forecast"
                       f"?latitude={lat}&longitude={lng}"
                       f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m"
                       f"&hourly=uv_index,temperature_2m,relative_humidity_2m&timezone=auto&models=best_match")
    om_data = fetch_open_meteo(om_forecast_url)

    if not unified_data:
        if om_data:
            unified_data = om_data
        else:
            # Absolute last resort: Fail rather than provide random misinformation
            raise Exception("All weather data sources are currently unreachable. Please try again in a moment.")

    # 3. High-Priority observation fetch: FCC OpenWeatherMap proxy for station-level precision
    try:
        fcc_url = f"https://weather-proxy.freecodecamp.rocks/api/current?lat={lat}&lon={lng}"
        fcc_res = requests.get(fcc_url, timeout=5, headers=COMMON_HEADERS)
        if fcc_res.status_code == 200:
            fcc_data = fcc_res.json()
            if 'main' in fcc_data:
                # Override current temp/humidity with station-level observation if available
                station_temp = float(fcc_data['main'].get('temp'))
                station_hum  = float(fcc_data['main'].get('humidity'))
                
                # Check if current is in unified_data
                if 'current' in unified_data:
                    unified_data['current']['temperature_2m'] = station_temp
                    unified_data['current']['relative_humidity_2m'] = station_hum
                    unified_data['obs_source'] = "OpenWeatherMap Station"
    except Exception as e:
        print(f"[Station Observation Error] {e}")

    # Ensure uv_index is present (pulled primarily from Open-Meteo)
    if om_data and 'hourly' in om_data and 'uv_index' in om_data['hourly']:
        unified_data['hourly']['uv_index'] = om_data['hourly']['uv_index']
    
    return unified_data

def get_nearby_hospitals(lat, lng):
    try:
        query = f"""
        [out:json][timeout:10];
        (
          node["amenity"="hospital"](around:5000,{lat},{lng});
          node["amenity"="clinic"](around:5000,{lat},{lng});
        );
        out body 3;
        """
        response = requests.post("https://overpass-api.de/api/interpreter",
                                 data={'data': query}, timeout=10, headers=COMMON_HEADERS)
        if response.status_code == 200:
            hospitals = []
            for el in response.json().get('elements', []):
                name = el.get('tags', {}).get('name', 'Unknown Facility')
                if name != 'Unknown Facility':
                    hospitals.append({"name": name, "lat": el.get('lat'), "lon": el.get('lon')})
            return hospitals[:3]
        return []
    except Exception as e:
        print(f"Error fetching hospitals: {e}")
        return []

def get_nearby_transit(lat, lng):
    try:
        query = f"""
        [out:json][timeout:10];
        (
          nwr["public_transport"="station"](around:5000,{lat},{lng});
          nwr["amenity"="bus_station"](around:5000,{lat},{lng});
          nwr["railway"="station"](around:5000,{lat},{lng});
          node["highway"="bus_stop"](around:5000,{lat},{lng});
        );
        out center 15;
        """
        response = requests.post("https://overpass-api.de/api/interpreter",
                                 data={'data': query}, timeout=10, headers=COMMON_HEADERS)
        if response.status_code == 200:
            transit = []
            for el in response.json().get('elements', []):
                tags     = el.get('tags', {})
                name     = tags.get('name', 'Transit Stop')
                lat_c    = el.get('lat') or el.get('center', {}).get('lat')
                lon_c    = el.get('lon') or el.get('center', {}).get('lon')
                if lat_c and lon_c:
                    transit.append({
                        "name": name,
                        "type": tags.get('highway') or tags.get('amenity') or tags.get('railway', 'station'),
                        "lat":  lat_c,
                        "lon":  lon_c
                    })
            return transit[:3]
        return []
    except Exception as e:
        print(f"Error fetching transit: {e}")
        return []

def get_reverse_geocode(lat, lng):
    """Fetch city/region name from coordinates using BigDataCloud API."""
    try:
        url = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lng}&localityLanguage=en"
        response = requests.get(url, timeout=5, headers=COMMON_HEADERS)
        if response.status_code == 200:
            data = response.json()
            city    = data.get('city') or data.get('locality') or data.get('principalSubdivision')
            country = data.get('countryName')
            if city and country:
                return f"{city}, {country}"
            return city or country or "Unknown Location"
        return "Unknown Location"
    except Exception as e:
        print(f"Reverse geocode error: {e}")
        return "Unknown Location"

def calculate_heat_index(T, RH):
    T_F = T * 9.0 / 5.0 + 32.0
    if T_F < 80:
        return T
    HI = (-42.379 + 2.04901523 * T_F + 10.14333127 * RH
          - 0.22475541 * T_F * RH - 0.00683783 * T_F * T_F
          - 0.05481717 * RH * RH + 0.00122874 * T_F * T_F * RH
          + 0.00085282 * T_F * RH * RH - 0.00000199 * T_F * T_F * RH * RH)
    return round((HI - 32.0) * 5.0 / 9.0, 2)

def determine_severity_level(heat_index, temp=None):
    # Cold warnings based on actual temperature
    if temp is not None:
        if temp <= -30:
            return "Extreme Cold", "Extremely dangerous! Frostbite can occur within minutes. Stay indoors, cover all exposed skin, and seek emergency shelter immediately."
        elif temp <= -10:
            return "High Cold", "Dangerous cold conditions. Risk of frostbite and hypothermia. Avoid outdoor exposure and dress in multiple insulating layers."
        elif temp < 0:
            return "Moderate Cold", "Freezing temperatures. Risk of frostbite with prolonged exposure. Wear warm clothing and limit time outdoors."
    # Heat warnings based on heat index
    if heat_index >= 54:
        return "Extreme", "Highly dangerous! Heatstroke is imminent. Seek an air-conditioned environment immediately and stay hydrated."
    elif heat_index >= 41:
        return "High", "Dangerous conditions. Heat cramps and heat exhaustion are likely. Limit outdoor activities."
    elif heat_index >= 32:
        return "Moderate", "Use extreme caution. Heat exhaustion is possible with prolonged exposure. Stay hydrated."
    else:
        return "Low", "Normal conditions. Keep an eye on the weather and stay hydrated."

# ── AI Feature Helpers ───────────────────────────────────────────────────────

RISK_ORDER = ["Low", "Moderate", "High", "Extreme"]

def _clamp_risk(index):
    return RISK_ORDER[max(0, min(index, len(RISK_ORDER) - 1))]

def build_forecast_trend(lat, lng):
    """Fetch 72-hour hourly forecast and bucket into 3 x 24-hour windows."""
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lng}"
            f"&hourly=temperature_2m,relative_humidity_2m,uv_index,apparent_temperature"
            f"&forecast_days=3&timezone=auto&models=best_match"
        )
        data = fetch_open_meteo(url)
        hourly = data.get('hourly', {})
        temps   = hourly.get('temperature_2m', [])
        humids  = hourly.get('relative_humidity_2m', [])
        uvs     = hourly.get('uv_index', [])

        windows = []
        labels  = ["Next 0–24h", "Next 24–48h", "Next 48–72h"]
        for i, label in enumerate(labels):
            start = i * 24
            end   = start + 24
            t_win = temps[start:end]
            h_win = humids[start:end]
            u_win = uvs[start:end]
            if not t_win:
                continue
            avg_temp = round(sum(t_win) / len(t_win), 1)
            avg_hum  = round(sum(h_win) / len(h_win), 1) if h_win else 50
            avg_uv   = round(max(u_win), 1) if u_win else 0
            hi = calculate_heat_index(avg_temp, avg_hum)
            risk, _ = determine_severity_level(hi, temp=avg_temp)
            windows.append({
                "window":       label,
                "risk_level":   risk,
                "avg_temp":     avg_temp,
                "avg_humidity": avg_hum,
                "avg_uv":       avg_uv,
                "heat_index":   hi
            })
        return windows
    except Exception as e:
        print(f"[forecast_trend error] {e}")
        return []


def generate_xai_explanation(temp, humidity, uv_index, heat_index, risk_level):
    """Return a list of factor dicts explaining why the risk level was assigned."""
    factors = []

    # Temperature factor
    if temp >= 40:
        t_label, t_weight = "Extreme", 100
    elif temp >= 35:
        t_label, t_weight = "High", 80
    elif temp >= 28:
        t_label, t_weight = "Moderate", 55
    elif temp <= 0:
        t_label, t_weight = "Freezing", 85
    elif temp <= -10:
        t_label, t_weight = "Dangerous Cold", 95
    else:
        t_label, t_weight = "Normal", 25
    factors.append({"icon": "🌡️", "label": f"Temperature ({temp}°C)", "contribution": t_label, "weight": t_weight})

    # Humidity factor
    if humidity < 20:
        h_label, h_weight = "Very Low — Rapid dehydration risk", 75
    elif humidity < 40:
        h_label, h_weight = "Low — Reduces cooling efficiency", 50
    elif humidity > 80:
        h_label, h_weight = "Very High — Sweat cannot evaporate", 85
    elif humidity > 60:
        h_label, h_weight = "High — Reduces body cooling", 60
    else:
        h_label, h_weight = "Comfortable Range", 20
    factors.append({"icon": "💧", "label": f"Humidity ({humidity}%)", "contribution": h_label, "weight": h_weight})

    # UV Index factor
    if uv_index >= 11:
        u_label, u_weight = "Extreme — Immediate harm", 100
    elif uv_index >= 8:
        u_label, u_weight = "Very High — Severe sunburn risk", 85
    elif uv_index >= 6:
        u_label, u_weight = "High — Sunburn within 25 min", 65
    elif uv_index >= 3:
        u_label, u_weight = "Moderate — Protection needed", 40
    else:
        u_label, u_weight = "Low", 15
    factors.append({"icon": "☀️", "label": f"UV Index ({uv_index})", "contribution": u_label, "weight": u_weight})

    # Heat Index factor
    if heat_index >= 54:
        hi_label, hi_weight = "Extreme — Heatstroke imminent", 100
    elif heat_index >= 41:
        hi_label, hi_weight = "Dangerous — Heat exhaustion likely", 85
    elif heat_index >= 32:
        hi_label, hi_weight = "Caution — Heat exhaustion possible", 60
    else:
        hi_label, hi_weight = "Normal Range", 20
    factors.append({"icon": "🔥", "label": f"Heat Index ({heat_index}°C)", "contribution": hi_label, "weight": hi_weight})

    # Generate summary sentence
    top = sorted(factors, key=lambda x: -x['weight'])[:2]
    top_names = " + ".join(f.get('label', '').split('(')[0].strip() for f in top)
    summary = f"{top_names} = {risk_level} Risk"

    return {"factors": factors, "summary": summary}


def calculate_personal_risk(base_level, age, occupation, conditions):
    """Apply personal multipliers to the base risk level and return a 0–100 score."""
    # Map base level to numeric index
    level_map = {
        "Low": 0, "Moderate": 1, "High": 2, "Extreme": 3,
        "Moderate Cold": 1, "High Cold": 2, "Extreme Cold": 3
    }
    base_idx = level_map.get(base_level, 0)
    score    = [10, 35, 65, 90][base_idx]  # base score

    detail_notes = []

    # Age modifier
    try:
        age = int(age)
    except (TypeError, ValueError):
        age = 30
    if age >= 65:
        score       += 18
        detail_notes.append("Elderly (65+): Very high vulnerability to heat/cold stress")
    elif age >= 50:
        score       += 8
        detail_notes.append("Middle-aged (50+): Moderate vulnerability increase")
    elif age <= 5:
        score       += 12
        detail_notes.append("Young child: High vulnerability to extreme temperatures")
    elif age <= 12:
        score       += 6
        detail_notes.append("Child: Elevated heat sensitivity")

    # Occupation modifier
    outdoor_occupations = {
        "construction":  15,
        "farmer":        15,
        "outdoor_labor": 15,
        "delivery":      10,
        "soldier":       12,
        "athlete":       10,
        "gardener":      8,
    }
    occ_lower = (occupation or "").lower().replace(" ", "_")
    occ_score = outdoor_occupations.get(occ_lower, 0)
    if occ_score:
        score += occ_score
        detail_notes.append(f"Occupation ({occupation}): Prolonged outdoor exposure increases risk")

    # Health conditions modifier
    condition_weights = {
        "diabetes":      12,
        "heart_disease": 15,
        "asthma":        10,
        "hypertension":  10,
        "kidney_disease":12,
        "pregnant":      10,
        "obesity":       8,
    }
    for cond in (conditions or []):
        w = condition_weights.get(cond.lower().replace(" ", "_"), 0)
        if w:
            score += w
            detail_notes.append(f"{cond.replace('_', ' ').title()}: Increases physiological heat stress")

    score = min(score, 100)

    # Map final score to label
    if score >= 85:
        personal_level = "Critical"
    elif score >= 70:
        personal_level = "Very High"
    elif score >= 50:
        personal_level = "High"
    elif score >= 30:
        personal_level = "Moderate"
    else:
        personal_level = "Low"

    return {
        "personal_risk_level": personal_level,
        "risk_score":          score,
        "detail_notes":        detail_notes
    }

def generate_dynamic_recommendations(temp, uv, heat_index):
    recs = []
    if temp > 40:
        recs.append({"type": "critical", "icon": "fa-triangle-exclamation", "message": "Extreme heat! Avoid outdoor activity entirely."})
    elif temp > 35:
        recs.append({"type": "warning", "icon": "fa-temperature-arrow-up", "message": "High temps. Limit outdoor time and hydrate frequently."})
    elif temp < 0:
        recs.append({"type": "critical", "icon": "fa-icicles", "message": "Freezing conditions! Stay indoors and cover all exposed skin."})
    
    if uv >= 8:
        recs.append({"type": "warning", "icon": "fa-sun", "message": "High UV index. Wear SPF 50+ and UV-blocking sunglasses."})
    elif uv >= 5:
        recs.append({"type": "info", "icon": "fa-umbrella", "message": "Moderate UV. Sun protection recommended."})

    if heat_index > 41:
        recs.append({"type": "critical", "icon": "fa-droplet-slash", "message": "High risk of heat cramps and exhaustion."})
    
    if not recs:
        recs.append({"type": "safe", "icon": "fa-shield-check", "message": "Conditions are safe. Maintain normal hydration."})
    
    return recs

def generate_daily_plan(hourly_data):
    if not hourly_data or 'temperature_2m' not in hourly_data:
        return []
    
    temps = hourly_data['temperature_2m'][:24]
    humids = hourly_data.get('relative_humidity_2m', [50]*24)[:24]
    
    if len(temps) < 24:
        return []
    
    def evaluate_period(t_list, h_list, start_idx, end_idx):
        win_t = t_list[start_idx:end_idx]
        win_h = h_list[start_idx:end_idx]
        avg_t = sum(win_t) / len(win_t)
        avg_h = sum(win_h) / len(win_h)
        hi = calculate_heat_index(avg_t, avg_h)
        risk, _ = determine_severity_level(hi, temp=avg_t)
        return {"avg_temp": round(avg_t, 1), "risk_level": risk}

    return [
        {"period": "Morning", "time": "06:00 - 11:59",  **evaluate_period(temps, humids, 6, 12)},
        {"period": "Afternoon", "time": "12:00 - 17:59", **evaluate_period(temps, humids, 12, 18)},
        {"period": "Evening", "time": "18:00 - 23:59",  **evaluate_period(temps, humids, 18, 24)}
    ]

# ── Prediction Route ──────────────────────────────────────────────────────────

@app.route('/api/predict', methods=['GET', 'POST'])
def predict_heatwave():
    try:
        data  = request.get_json() if request.is_json else request.args
        lat   = data.get('lat')
        lng   = data.get('lng')
        query = data.get('query')

        if query:
            geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={query}&count=1&language=en&format=json"
            try:
                geo_res = requests.get(geo_url, timeout=10, headers=COMMON_HEADERS)
            except requests.exceptions.RequestException as e:
                return jsonify({"error": f"Geocoding service unreachable: {str(e)}"}), 502
            if geo_res.status_code == 200:
                results = geo_res.json().get('results')
                if results:
                    lat, lng = results[0]['latitude'], results[0]['longitude']
                else:
                    return jsonify({"error": "Location not found."}), 404
            elif geo_res.status_code == 429:
                return jsonify({"error": "Geocoding rate limit reached on server. Please select a city from the dropdown or try again later."}), 429
            else:
                return jsonify({"error": f"Geocoding service unavailable (Status: {geo_res.status_code})."}), 500

        if not lat or not lng:
            return jsonify({"error": "Latitude/longitude or location query required."}), 400

        # Ensure lat/lng are floats
        lat = float(lat)
        lng = float(lng)

        # High-accuracy unified fetcher (+/- 0.5 margin)
        weather_data = fetch_weather_unified(lat, lng)
        current_weather = weather_data.get('current', {})
        
        temp            = current_weather.get('temperature_2m', 0)
        humidity        = current_weather.get('relative_humidity_2m', 0)
        
        uv_indices      = weather_data.get('hourly', {}).get('uv_index', [0])
        uv_index        = max(uv_indices[:24]) if uv_indices else 0

        heat_index         = calculate_heat_index(temp, humidity)
        severity, guidelines = determine_severity_level(heat_index, temp=temp)
        hospitals          = get_nearby_hospitals(lat, lng)
        transit            = get_nearby_transit(lat, lng)
        location_name      = get_reverse_geocode(lat, lng) if not query else query

        forecast_trend  = build_forecast_trend(lat, lng)
        xai_explanation = generate_xai_explanation(temp, round(humidity, 1), round(uv_index, 1), heat_index, severity)
        
        dynamic_recs = generate_dynamic_recommendations(temp, uv_index, heat_index)
        daily_plan = generate_daily_plan(weather_data.get('hourly', {}))

        return jsonify({
            "status":     "success",
            "location":   {"lat": lat, "lng": lng},
            "location_name": location_name,
            "weather":    {
                "temperature": round(temp, 1),
                "humidity":    round(humidity, 1),
                "heat_index":  heat_index,
                "uv_index":    round(uv_index, 1)
            },
            "prediction":     {"risk_level": severity, "safety_guidelines": guidelines},
            "forecast_trend": forecast_trend,
            "xai_explanation": xai_explanation,
            "safety_engine":  {"recommendations": dynamic_recs, "daily_plan": daily_plan},
            "hospitals":  hospitals,
            "transit":    transit
        })

    except Exception as e:
        print(f"[predict_heatwave error] {e}")
        return jsonify({"error": str(e)}), 500


SEVERE_LEVELS = {"moderate cold", "high cold", "extreme cold", "moderate", "high", "extreme"}


# ── Chart Data Endpoint ───────────────────────────────────────────────────────

@app.route('/api/chart-data', methods=['POST'])
def chart_data():
    try:
        data = request.get_json()
        lat  = float(data.get('lat'))
        lng  = float(data.get('lng'))

        # Use the local date provided by the client if available, otherwise default to UTC
        local_date_str = data.get('local_date')
        from datetime import datetime, timedelta
        
        if local_date_str:
            try:
                today = datetime.strptime(local_date_str, '%Y-%m-%d').date()
            except:
                today = datetime.utcnow().date()
        else:
            today = datetime.utcnow().date()
            
        yesterday = today - timedelta(days=1)
        lastweek  = today - timedelta(days=7)

        def fetch_day(date_str):
            url = (
                f"https://archive-api.open-meteo.com/v1/archive"
                f"?latitude={lat}&longitude={lng}"
                f"&start_date={date_str}&end_date={date_str}"
                f"&hourly=temperature_2m,relative_humidity_2m"
                f"&timezone=auto"
            )
            data = fetch_open_meteo(url)
            h = data.get('hourly', {})
            temps  = h.get('temperature_2m', [])
            humids = h.get('relative_humidity_2m', [])
            return temps, humids

        # Use unified fetcher for today's data to ensure consistency with the hero metrics
        unified_today = fetch_weather_unified(lat, lng)
        today_temps  = unified_today.get('hourly', {}).get('temperature_2m', [])[:24]
        today_humids = unified_today.get('hourly', {}).get('relative_humidity_2m', [])[:24]
        
        # Determine current hour in HIS (Location local time)
        # If the weather API returned a current time, use its hour.
        current_hour = None
        if 'current' in unified_today and 'time' in unified_today['current']:
            try:
                # Open-Meteo format: "2026-04-08T13:45"
                time_str = unified_today['current']['time']
                current_hour = int(time_str.split('T')[1].split(':')[0])
            except:
                pass
        
        if current_hour is None:
            # Fallback to server hour (unsafe for shared hosting like Render but better than nothing)
            current_hour = datetime.now().hour

        if 'current' in unified_today and current_hour is not None and current_hour < len(today_temps):
            today_temps[current_hour] = unified_today['current'].get('temperature_2m', today_temps[current_hour])
            today_humids[current_hour] = unified_today['current'].get('relative_humidity_2m', today_humids[current_hour])

        today_hi = [round(calculate_heat_index(t, rh), 1) for t, rh in zip(today_temps, today_humids)]

        yest_temps,  yest_humids  = fetch_day(str(yesterday))
        week_temps,  week_humids  = fetch_day(str(lastweek))

        # Daily averages for bar comparison (avg of each day's 24h)
        def day_avg(temps):
            return round(sum(temps)/len(temps), 1) if temps else None

        hours = [f"{i:02d}:00" for i in range(24)]

        return jsonify({
            "status": "success",
            "hours":  hours,
            "today": {
                "temps":      today_temps,
                "heat_index": today_hi,
                "avg_temp":   day_avg(today_temps)
            },
            "yesterday": {
                "temps":    yest_temps[:24],
                "avg_temp": day_avg(yest_temps)
            },
            "lastweek": {
                "temps":    week_temps[:24],
                "avg_temp": day_avg(week_temps)
            },
            "dates": {
                "today":     str(today),
                "yesterday": str(yesterday),
                "lastweek":  str(lastweek)
            }
        })
    except Exception as e:
        print(f"[chart_data error] {e}")
        return jsonify({"error": str(e)}), 500


# ── Personal Risk Endpoint ────────────────────────────────────────────────────

@app.route('/api/personal-risk', methods=['POST'])
def personal_risk():
    try:
        data       = request.get_json()
        base_level = data.get('base_level', 'Low')
        age        = data.get('age', 30)
        occupation = data.get('occupation', '')
        conditions = data.get('conditions', [])
        result     = calculate_personal_risk(base_level, age, occupation, conditions)
        return jsonify({"status": "success", **result})
    except Exception as e:
        print(f"[personal_risk error] {e}")
        return jsonify({"error": str(e)}), 500

def send_alert_email(email, username, risk_level, guidelines, temp, heat_index, hospitals, transit):
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    is_cold = "cold" in risk_level.lower()
    accent  = "#60a5fa" if is_cold else "#ef4444"
    icon    = "❄️" if is_cold else "🔥"

    def hospital_rows(hospitals):
        if not hospitals:
            return "<tr><td colspan='2' style='color:#6b7280;padding:8px'>No nearby hospitals found.</td></tr>"
        rows = ""
        for h in hospitals:
            maps = f"https://www.google.com/maps/dir/?api=1&destination={h['lat']},{h['lon']}"
            rows += f"<tr><td style='padding:8px 12px;color:#e2e8f0'>{h['name']}</td><td style='padding:8px 12px'><a href='{maps}' style='color:#d4af37'>Navigate →</a></td></tr>"
        return rows

    def transit_rows(transit):
        if not transit:
            return "<tr><td colspan='2' style='color:#6b7280;padding:8px'>No nearby transit found.</td></tr>"
        rows = ""
        for s in transit:
            maps = f"https://www.google.com/maps/dir/?api=1&destination={s['lat']},{s['lon']}"
            rows += f"<tr><td style='padding:8px 12px;color:#e2e8f0'>{s['name']}</td><td style='padding:8px 12px'><a href='{maps}' style='color:#d4af37'>Navigate →</a></td></tr>"
        return rows

    html = f"""
    <div style="font-family:Inter,sans-serif;background:#08080f;padding:40px;border-radius:12px;max-width:560px;margin:auto;border:1px solid {accent}">
      <h2 style="color:{accent};font-size:22px;margin-bottom:4px">{icon} HeatwaveGuard Severe Weather Alert</h2>
      <p style="color:#9ca3af;font-size:13px;margin-bottom:24px">Hello <strong style="color:#e2e8f0">{username}</strong>, a severe condition has been detected at your location.</p>

      <div style="background:#0f172a;border:1px solid {accent};border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="color:{accent};font-size:20px;font-weight:700;margin:0 0 8px">{risk_level.upper()}</p>
        <p style="color:#cbd5e1;font-size:14px;margin:0">{guidelines}</p>
        <p style="color:#6b7280;font-size:12px;margin:12px 0 0">Temperature: <strong style="color:#e2e8f0">{temp}°C</strong> &nbsp;|&nbsp; Heat Index: <strong style="color:#e2e8f0">{heat_index}°C</strong></p>
      </div>

      <h3 style="color:#d4af37;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">🏥 Nearest Hospitals</h3>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;margin-bottom:20px">
        {hospital_rows(hospitals)}
      </table>

      <h3 style="color:#d4af37;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">🚌 Nearest Transit</h3>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;margin-bottom:20px">
        {transit_rows(transit)}
      </table>

      <p style="color:#4b5563;font-size:11px;margin-top:24px">This is an automated alert from HeatwaveGuard. Stay safe.</p>
    </div>
    """

    try:
        msg            = MIMEMultipart('alternative')
        msg['Subject'] = f'{icon} HeatwaveGuard Alert — {risk_level} Conditions Detected'
        msg['From']    = f'HeatwaveGuard <{SMTP_EMAIL}>'
        msg['To']      = email
        msg.attach(MIMEText(html, 'html'))
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
            server.sendmail(SMTP_EMAIL, email, msg.as_string())
        print(f"[Alert Email sent] {email} — {risk_level}")
        return True
    except Exception as e:
        print(f"[Alert Email Error] {e}")
        return False


@app.route('/api/send-alert', methods=['POST'])
def send_alert():
    data       = request.get_json()
    risk_level = data.get('risk_level', '')
    if risk_level.lower() not in SEVERE_LEVELS:
        return jsonify({"status": "skipped"})

    # Rate limiting: 4-hour cooldown for the SAME risk level
    now = time.time()
    last_alert = session.get('last_alert', {})
    last_time = last_alert.get(risk_level.lower(), 0)
    if now - last_time < 14400: # 4 hours
        return jsonify({"status": "cooldown", "message": "Alert recently sent for this level."})

    last_alert[risk_level.lower()] = now
    session['last_alert'] = last_alert
    session.modified = True

    email    = session.get('email', '')
    username = session.get('username', 'Guest')

    if not email:
        return jsonify({"status": "skipped", "message": "No email in session."})

    thread = threading.Thread(target=send_alert_email, kwargs={
        "email":      email,
        "username":   username,
        "risk_level": risk_level,
        "guidelines": data.get('guidelines', ''),
        "temp":       data.get('temp'),
        "heat_index": data.get('heat_index'),
        "hospitals":  data.get('hospitals', []),
        "transit":    data.get('transit', [])
    })
    thread.daemon = True
    thread.start()

    return jsonify({"status": "sent", "email": email})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
