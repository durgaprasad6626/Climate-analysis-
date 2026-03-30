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
                                 data={'data': query}, timeout=10)
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
                                 data={'data': query}, timeout=10)
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
        response = requests.get(url, timeout=5)
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
            geo_res = requests.get(geo_url)
            if geo_res.status_code == 200:
                results = geo_res.json().get('results')
                if results:
                    lat, lng = results[0]['latitude'], results[0]['longitude']
                else:
                    return jsonify({"error": "Location not found."}), 404
            else:
                return jsonify({"error": "Geocoding service unavailable."}), 500

        if not lat or not lng:
            return jsonify({"error": "Latitude/longitude or location query required."}), 400

        weather_url = (f"https://api.open-meteo.com/v1/forecast"
                       f"?latitude={lat}&longitude={lng}"
                       f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m"
                       f"&hourly=uv_index&timezone=auto")
        res = requests.get(weather_url)
        if res.status_code != 200:
            return jsonify({"error": "Failed to fetch weather data."}), 500

        weather_data    = res.json()
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
            "prediction": {"risk_level": severity, "safety_guidelines": guidelines},
            "hospitals":  hospitals,
            "transit":    transit
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


SEVERE_LEVELS = {"moderate cold", "high cold", "extreme cold", "moderate", "high", "extreme"}

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
