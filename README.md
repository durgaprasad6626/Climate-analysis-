# 🔥 HeatwaveGuard — Environmental Intelligence Platform

> **Real-time heatwave severity assessment, geo-aware risk profiling, and emergency resource mapping — powered by live meteorological telemetry.**

![Python](https://img.shields.io/badge/Python-3.10+-blue?style=flat-square&logo=python)
![Flask](https://img.shields.io/badge/Flask-3.0.0-black?style=flat-square&logo=flask)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active-brightgreen?style=flat-square)

---

## 📌 Overview

**HeatwaveGuard** is a premium, geo-aware web application that provides:
- 🌡️ Real-time heatwave & cold wave risk assessment for any location on Earth
- 📍 Automatic GPS-based location detection with reverse geocoding
- 🗺️ Interactive Google Maps integration with precise marker pinpointing
- 🏥 Nearby hospital & emergency resource discovery (within 5 km)
- 🚌 Nearest transit station mapping for evacuation planning
- 📧 Automated severe weather email alert system

Built as part of the **AI & ML Division** at *Kommuri Pratap Reddy Institute of Technology*.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔍 **Location Search** | Search any city, region, or landmark with live autocomplete |
| 📡 **GPS Detection** | One-click geolocation using browser Geolocation API |
| 🌡️ **Heat Index Calculation** | Rothfusz regression formula for accurate heat index |
| ❄️ **Cold Wave Detection** | Risk levels for freezing and extreme cold conditions |
| 🗺️ **Google Maps** | Embedded interactive map centered on the analyzed location |
| 🏥 **Hospital Finder** | Discovers nearest hospitals & clinics via OpenStreetMap Overpass API |
| 🚌 **Transit Finder** | Finds nearby bus stops & train stations for emergency routing |
| 📧 **Email Alerts** | Branded HTML email alerts sent via Gmail SMTP for severe conditions |
| 🌍 **Reverse Geocoding** | Converts GPS coordinates into human-readable city/country names |

---

## 🏗️ Project Structure

```
HeatwaveGuard/
│
├── app.py                  # Flask backend — routes, weather logic, email alerts
├── requirements.txt        # Python dependencies
├── users.db                # SQLite user database
│
├── templates/
│   ├── index.html          # Main dashboard (Tailwind CSS + custom styles)
│   └── login.html          # Authentication page (OTP-based)
│
└── static/
    ├── css/
    │   └── style.css       # Premium custom styles & animations
    ├── js/
    │   └── app.js          # Dashboard logic, Google Maps, autocomplete
    ├── lavender_dusk_main_bg_png_*.png   # Dashboard background
    └── emerald_depth_login_bg_png_*.png  # Login background
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- pip
- A Google Maps JavaScript API Key *(for the interactive map)*

### 1. Clone the Repository

```bash
git clone https://github.com/durgaprasad6626/Climate-analysis-.git
cd Climate-analysis-
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Google Maps API Key

In `templates/index.html`, find and replace the API key:

```html
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=initMap" async defer></script>
```

> 🔑 Get your free key at [Google Cloud Console](https://console.cloud.google.com/) → Enable **Maps JavaScript API**.

### 4. Configure Email Alerts *(Optional)*

In `app.py`, update the SMTP credentials to enable live email alerts:

```python
SMTP_EMAIL        = "your-email@gmail.com"
SMTP_APP_PASSWORD = "your-gmail-app-password"
```

> 💡 Use a [Gmail App Password](https://myaccount.google.com/apppasswords), not your regular Gmail password.

### 5. Run the Application

```bash
python app.py
```

Open your browser and navigate to **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Main dashboard |
| `POST` | `/api/predict` | Get weather data & risk level for a location |
| `POST` | `/api/send-otp` | Send OTP to email (for auth flow) |
| `POST` | `/api/verify-otp` | Verify OTP and log in / register |
| `POST` | `/api/send-alert` | Trigger severe weather alert email |

### Example `/api/predict` Request

```json
POST /api/predict
{
  "lat": 17.3850,
  "lng": 78.4867
}
```

### Example Response

```json
{
  "status": "success",
  "location_name": "Hyderabad, India",
  "weather": {
    "temperature": 38.2,
    "humidity": 55.0,
    "heat_index": 42.1,
    "uv_index": 9.5
  },
  "prediction": {
    "risk_level": "High",
    "safety_guidelines": "Dangerous conditions. Heat cramps and heat exhaustion are likely. Limit outdoor activities."
  },
  "hospitals": [...],
  "transit": [...]
}
```

---

## 🌡️ Risk Level Classification

| Risk Level | Heat Index / Temp | Description |
|---|---|---|
| 🟢 **Low** | < 32°C | Normal conditions |
| 🟡 **Moderate** | 32°C – 41°C | Use extreme caution |
| 🟠 **High** | 41°C – 54°C | Dangerous heat conditions |
| 🔴 **Extreme** | ≥ 54°C | Heatstroke imminent |
| 🔵 **Moderate Cold** | 0°C – (−10°C) | Risk of frostbite |
| 🧊 **High Cold** | −10°C – (−30°C) | Dangerous cold |
| ⚪ **Extreme Cold** | ≤ −30°C | Life-threatening cold |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python, Flask, Flask-CORS |
| **Database** | SQLite (via `sqlite3`) |
| **Weather Data** | [Open-Meteo API](https://open-meteo.com/) *(free, no key)* |
| **Geocoding** | [Open-Meteo Geocoding](https://geocoding-api.open-meteo.com/) |
| **Reverse Geocoding** | [BigDataCloud API](https://www.bigdatacloud.com/) *(free, no key)* |
| **Hospitals & Transit** | [OpenStreetMap Overpass API](https://overpass-api.de/) |
| **Maps** | Google Maps JavaScript API |
| **Email** | Gmail SMTP (smtplib) |
| **Frontend** | HTML5, Tailwind CSS, Vanilla JS |
| **Fonts** | Google Fonts (Cinzel, Inter) |
| **Icons** | Font Awesome 6 |

---

## 📦 Dependencies

```
Flask==3.0.0
requests==2.31.0
flask-cors==4.0.0
pandas==2.1.3
openpyxl==3.1.2
```

---

## 🔒 Security Notes

- Restrict your Google Maps API key in [Google Cloud Console](https://console.cloud.google.com/) to your domain only.
- Use Gmail **App Passwords**, never your main Gmail password.
- For production deployment, use a WSGI server like **Gunicorn** instead of Flask's built-in dev server.

---

## 📬 Contact

**Durga Prasad Kemidi**
AI & ML Division — Kommuri Pratap Reddy Institute of Technology

[![GitHub](https://img.shields.io/badge/GitHub-durgaprasad6626-black?style=flat-square&logo=github)](https://github.com/durgaprasad6626)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Durga%20Prasad%20Kemidi-blue?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/durga-prasad-kemidi-603633295)

---

## 📄 License

This project is licensed under the **MIT License** — feel free to use, modify, and distribute with attribution.

---

<p align="center">
  <i>Excellence Without Compromise. — HeatwaveGuard © 2026</i>
</p>
