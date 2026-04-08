// ── Google Maps globals (referenced by API callback) ─────────────────────
let googleMap    = null;
let mapMarker   = null;
let pendingCoords = null;  // coords set before API loaded

// Called automatically by the Maps JS API once loaded (see callback=initMap)
function initMap() {
    if (pendingCoords) {
        renderMap(pendingCoords.lat, pendingCoords.lng);
        pendingCoords = null;
    }
}

function renderMap(lat, lng) {
    const position = { lat: parseFloat(lat), lng: parseFloat(lng) };
    const mapDiv   = document.getElementById('googleMap');
    if (!mapDiv) return;
    if (!googleMap) {
        googleMap = new google.maps.Map(mapDiv, {
            center:            position,
            zoom:              14,
            mapTypeId:         'roadmap',
            disableDefaultUI:  false,
            zoomControl:       true,
            mapTypeControl:    false,
            streetViewControl: false,
            fullscreenControl: true,
        });
        mapMarker = new google.maps.Marker({
            position,
            map:       googleMap,
            title:     'Analyzed Location',
            animation: google.maps.Animation.DROP,
        });
    } else {
        googleMap.panTo(position);
        mapMarker.setPosition(position);
    }
}

document.addEventListener('DOMContentLoaded', () => {

    // ── Core Elements ────────────────────────────────────────────────
    const detectBtn    = document.getElementById('detectLocationBtn');
    const loader       = document.getElementById('loader');
    const dashboard    = document.getElementById('dashboard');

    // Output Elements
    const riskLevelOutput        = document.getElementById('riskLevelOutput');
    const safetyGuidelinesOutput = document.getElementById('safetyGuidelinesOutput');
    const alertBanner            = document.getElementById('alertBanner');
    const alertIconWrapper       = document.getElementById('alertIconWrapper');
    const alertIconSymbol        = document.getElementById('alertIconSymbol');
    const locationLabel          = document.getElementById('locationLabel');

    // Metric Elements
    const tempVal      = document.getElementById('tempVal');
    const humidityVal  = document.getElementById('humidityVal');
    const uvVal        = document.getElementById('uvVal');
    const heatIndexVal = document.getElementById('heatIndexVal');

    // Search Elements
    const searchBtn   = document.getElementById('searchLocationBtn');
    const searchInput = document.getElementById('locationSearchInput');
    const dropdown    = document.getElementById('autocompleteDropdown');

    // Toast Elements
    const alertToast   = document.getElementById('alertToast');
    const toastMessage = document.getElementById('toastMessage');

    // ── Helper: show / hide loader ────────────────────────────────────
    function showLoader()  { dashboard.classList.add('hidden'); loader.classList.remove('hidden'); }
    function hideLoader()  { loader.classList.add('hidden'); }

    // ── Helper: call /api/predict with lat/lng ────────────────────────
    async function analyzeCoords(lat, lng, label) {
        showLoader();
        try {
            const res  = await fetch('/api/predict', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ lat, lng })
            });
            const data = await res.json();
            if (data.status === 'success') {
                updateDashboard(data, label);
            } else {
                alert(`Analysis error: ${data.error}`);
                hideLoader();
            }
        } catch (err) {
            alert('Network error. Unable to reach the telemetry server.');
            hideLoader();
            console.error(err);
        }
    }

    // ── GPS auto-detect ───────────────────────────────────────────────
    detectBtn.addEventListener('click', () => {
        if (!navigator.geolocation) { alert('Geolocation is not supported by your system.'); return; }
        showLoader();
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => analyzeCoords(coords.latitude, coords.longitude, 'Your Location'),
            (err) => {
                const msgs = {
                    [err.PERMISSION_DENIED]:    'Location access denied.',
                    [err.POSITION_UNAVAILABLE]: 'Location information unavailable.',
                    [err.TIMEOUT]:              'Location request timed out.'
                };
                alert(msgs[err.code] || 'An unknown error occurred.');
                hideLoader();
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });

    // ── Autocomplete Engine ───────────────────────────────────────────
    let debounceTimer = null;
    let selectedLat   = null;
    let selectedLng   = null;
    let selectedLabel = null;

    function closeDropdown() {
        dropdown.innerHTML = '';
        dropdown.classList.add('hidden');
    }

    function buildSuggestion(item) {
        const parts  = [item.admin1, item.country].filter(Boolean);
        const region = parts.join(', ');
        const el = document.createElement('div');
        el.className = 'autocomplete-item';
        el.innerHTML = `
            <i class="location-icon fa-solid fa-location-dot"></i>
            <div>
                <div class="location-name">${item.name}</div>
                ${region ? `<div class="location-region">${region}</div>` : ''}
            </div>
        `;
        el.addEventListener('mousedown', () => {
            searchInput.value = region ? `${item.name}, ${region}` : item.name;
            selectedLat   = item.latitude;
            selectedLng   = item.longitude;
            selectedLabel = searchInput.value;
            closeDropdown();
            analyzeCoords(selectedLat, selectedLng, selectedLabel);
        });
        return el;
    }

    async function fetchSuggestions(query) {
        if (query.length < 2) { closeDropdown(); return; }
        try {
            const res  = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`
            );
            const data = await res.json();
            const results = data.results || [];
            if (!results.length) { closeDropdown(); return; }
            dropdown.innerHTML = '';
            results.forEach(item => dropdown.appendChild(buildSuggestion(item)));
            dropdown.classList.remove('hidden');
        } catch (e) { console.error('Autocomplete fetch failed:', e); }
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        debounceTimer = setTimeout(() => fetchSuggestions(q), 260);
    });
    searchInput.addEventListener('blur', () => { setTimeout(closeDropdown, 200); });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeDropdown(); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = searchInput.value.trim();
            if (!q) return;
            closeDropdown();
            if (selectedLabel === q && selectedLat !== null) {
                analyzeCoords(selectedLat, selectedLng, selectedLabel);
            } else { runTextSearch(q); }
        }
    });
    searchBtn.addEventListener('click', () => {
        const q = searchInput.value.trim();
        if (!q) return;
        closeDropdown();
        if (selectedLabel === q && selectedLat !== null) {
            analyzeCoords(selectedLat, selectedLng, selectedLabel);
        } else { runTextSearch(q); }
    });

    async function runTextSearch(query) {
        showLoader();
        try {
            // Priority: Use client-side geocoding to avoid server-side rate limits on Render
            const geoRes = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
            );
            const geoData = await geoRes.json();
            
            if (geoData.results && geoData.results.length > 0) {
                const item = geoData.results[0];
                const parts  = [item.admin1, item.country].filter(Boolean);
                const label  = parts.join(', ') ? `${item.name}, ${parts.join(', ')}` : item.name;
                analyzeCoords(item.latitude, item.longitude, label);
            } else {
                // Fallback to server search only if client-side fails
                const res = await fetch('/api/predict', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ query })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    updateDashboard(data, query);
                } else {
                    alert(`Error: ${data.error}`);
                    hideLoader();
                }
            }
        } catch (err) {
            console.error('Client-side search failed, falling back to server:', err);
            // Absolute last resort: server search
            try {
                const res = await fetch('/api/predict', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    updateDashboard(data, query);
                } else {
                    alert('Location not found or service unavailable.');
                    hideLoader();
                }
            } catch (e) {
                alert('Network error. Unable to reach the telemetry server.');
                hideLoader();
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // DASHBOARD RENDERER
    // ════════════════════════════════════════════════════════════════════
    function updateDashboard(data, label) {
        const { weather, prediction, location_name } = data;

        // Metrics with Pulse Animation
        const triggerPulse = (el, val) => {
            el.innerText = val;
            el.classList.remove('value-update-anim');
            void el.offsetWidth; // trigger reflow
            el.classList.add('value-update-anim');
        };
        
        triggerPulse(tempVal, weather.temperature);
        triggerPulse(humidityVal, weather.humidity);
        triggerPulse(uvVal, weather.uv_index);
        triggerPulse(heatIndexVal, weather.heat_index);

        // Risk
        riskLevelOutput.innerText        = prediction.risk_level;
        safetyGuidelinesOutput.innerText = prediction.safety_guidelines;

        const finalLabel = location_name || label;
        if (locationLabel) locationLabel.innerText = finalLabel ? `📍 ${finalLabel}` : '';

        // Google Maps
        const lat = data.location.lat;
        const lng = data.location.lng;
        if (typeof google !== 'undefined' && google.maps) {
            renderMap(lat, lng);
        } else {
            pendingCoords = { lat, lng };
        }

        // Alert banner styling
        alertIconWrapper.className = 'px-10 py-8 flex items-center justify-center transition-all duration-500 min-w-[120px] ';
        const risk = prediction.risk_level.toLowerCase();
        const riskMap = {
            'low':           { wrap: 'bg-green-900/80 border-l-4 border-green-500',   icon: 'fa-solid fa-shield-check text-4xl text-green-300 drop-shadow-lg',          text: 'font-bold text-green-400' },
            'moderate':      { wrap: 'bg-yellow-900/80 border-l-4 border-yellow-500', icon: 'fa-solid fa-triangle-exclamation text-4xl text-yellow-300 drop-shadow-lg',  text: 'font-bold text-yellow-400' },
            'high':          { wrap: 'bg-orange-900/80 border-l-4 border-orange-500', icon: 'fa-solid fa-triangle-exclamation text-4xl text-orange-300 drop-shadow-lg',  text: 'font-bold text-orange-400' },
            'extreme':       { wrap: 'bg-red-900/80 border-l-4 border-red-500',       icon: 'fa-solid fa-skull text-4xl text-red-300 drop-shadow-lg animate-pulse',      text: 'font-bold text-red-500' },
            'moderate cold': { wrap: 'bg-blue-900/80 border-l-4 border-blue-400',     icon: 'fa-solid fa-snowflake text-4xl text-blue-300 drop-shadow-lg',               text: 'font-bold text-blue-400' },
            'high cold':     { wrap: 'bg-blue-900/80 border-l-4 border-blue-500',     icon: 'fa-solid fa-snowflake text-4xl text-blue-200 drop-shadow-lg animate-pulse', text: 'font-bold text-blue-300' },
            'extreme cold':  { wrap: 'bg-indigo-900/80 border-l-4 border-indigo-400', icon: 'fa-solid fa-skull text-4xl text-indigo-300 drop-shadow-lg animate-pulse',   text: 'font-bold text-indigo-300' }
        };
        const style = riskMap[risk] || riskMap['low'];
        alertIconWrapper.className  += style.wrap;
        alertIconSymbol.className    = style.icon;
        riskLevelOutput.className    = style.text;

        // Hospitals
        const hospitalsSection = document.getElementById('hospitalsSection');
        const hospitalsList    = document.getElementById('hospitalsList');
        if (data.hospitals && data.hospitals.length > 0) {
            hospitalsSection.classList.remove('hidden');
            hospitalsList.innerHTML = '';
            data.hospitals.forEach(h => {
                const mapLink = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
                const li = document.createElement('li');
                li.className = 'resource-card hospital';
                li.innerHTML = `
                    <div>
                        <div class="font-serif text-base text-white mb-1">${h.name}</div>
                        <div class="text-xs uppercase tracking-widest text-gray-600"><i class="fa-solid fa-location-dot mr-1"></i>Nearby</div>
                    </div>
                    <a href="${mapLink}" target="_blank"
                       class="ml-4 flex-shrink-0 px-5 py-2.5 border border-rose-900/60 hover:bg-rose-900 text-rose-400 hover:text-white transition-all duration-300 text-xs font-bold tracking-widest uppercase rounded-sm">
                        <i class="fa-solid fa-map mr-1"></i>Navigate
                    </a>`;
                hospitalsList.appendChild(li);
            });
        } else {
            hospitalsSection.classList.add('hidden');
        }

        // Transit
        const transitSection = document.getElementById('transitSection');
        const transitList    = document.getElementById('transitList');
        if (data.transit && data.transit.length > 0) {
            transitSection.classList.remove('hidden');
            transitList.innerHTML = '';
            data.transit.forEach(s => {
                const isBus   = s.type === 'bus_station' || s.type === 'bus_stop';
                const icon    = isBus ? 'fa-bus' : 'fa-train';
                const mapLink = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
                const li = document.createElement('li');
                li.className = 'resource-card transit';
                li.innerHTML = `
                    <div>
                        <div class="font-serif text-base text-white mb-1">
                            <i class="fa-solid ${icon} opacity-50 mr-2"></i>${s.name}
                        </div>
                        <div class="text-xs uppercase tracking-widest text-gray-600"><i class="fa-solid fa-location-dot mr-1"></i>Nearby</div>
                    </div>
                    <a href="${mapLink}" target="_blank"
                       class="ml-4 flex-shrink-0 px-5 py-2.5 border border-luxury-gold/30 hover:bg-luxury-gold hover:text-black text-luxury-gold transition-all duration-300 text-xs font-bold tracking-widest uppercase rounded-sm">
                        <i class="fa-solid fa-map mr-1"></i>Navigate
                    </a>`;
                transitList.appendChild(li);
            });
        } else {
            transitSection.classList.add('hidden');
        }

        // ── AI Features ──────────────────────────────────────────────
        if (data.forecast_trend && data.forecast_trend.length) {
            renderForecastTrend(data.forecast_trend);
        }
        if (data.xai_explanation) {
            renderXAI(data.xai_explanation);
        }
        if (data.safety_engine) {
            renderSafetyEngine(data.safety_engine);
        }

        // Store coords globally for chart-data API
        window._lastLat = data.location.lat;
        window._lastLng = data.location.lng;
        window._lastLocationName = location_name || label;
        window._lastWeather = weather;
        window._lastRisk = prediction.risk_level;

        initVizDashboard();

        // Store base risk level globally for personal risk form
        window._baseRiskLevel = prediction.risk_level;

        hideLoader();
        dashboard.classList.remove('hidden');

        // Send alert email if severity is non-Low
        triggerAtmosphericAlert(data, prediction, weather);
    }

    // ════════════════════════════════════════════════════════════════════
    // AI FEATURE 1: 72-Hour Forecast Trend Renderer
    // ════════════════════════════════════════════════════════════════════
    function renderForecastTrend(trend) {
        const grid = document.getElementById('forecastGrid');
        if (!grid) return;
        grid.innerHTML = '';

        const riskColors = {
            'low':           'text-green-400',
            'moderate':      'text-yellow-400',
            'high':          'text-orange-400',
            'extreme':       'text-red-400',
            'moderate cold': 'text-blue-400',
            'high cold':     'text-blue-300',
            'extreme cold':  'text-indigo-300'
        };
        const riskIcons = {
            'low':           'fa-shield-check text-green-400',
            'moderate':      'fa-triangle-exclamation text-yellow-400',
            'high':          'fa-triangle-exclamation text-orange-400',
            'extreme':       'fa-skull text-red-400',
            'moderate cold': 'fa-snowflake text-blue-400',
            'high cold':     'fa-snowflake text-blue-300',
            'extreme cold':  'fa-skull text-indigo-300'
        };

        const getTrendArrow = (curr, next) => {
            if (!next) return '';
            const order = ['low','moderate cold','moderate','high cold','high','extreme cold','extreme'];
            const ci = order.indexOf(curr.toLowerCase());
            const ni = order.indexOf(next.toLowerCase());
            if (ni > ci) return '<i class="fa-solid fa-arrow-trend-up text-orange-400 mr-2"></i><span class="text-orange-400 text-xs uppercase tracking-widest font-semibold">Worsening</span>';
            if (ni < ci) return '<i class="fa-solid fa-arrow-trend-down text-green-400 mr-2"></i><span class="text-green-400 text-xs uppercase tracking-widest font-semibold">Improving</span>';
            return '<i class="fa-solid fa-minus text-gray-600 mr-2"></i><span class="text-gray-600 text-xs uppercase tracking-widest font-semibold">Stable</span>';
        };

        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-3 w-full';

        trend.forEach((w, i) => {
            const riskKey    = w.risk_level.toLowerCase();
            const cssClass   = `risk-${riskKey.replace(/\s+/g, '-')}`;
            const colorClass = riskColors[riskKey] || 'text-gray-300';
            const iconClass  = riskIcons[riskKey]  || 'fa-circle-exclamation text-gray-400';

            const card = document.createElement('div');
            card.className = `forecast-card ${cssClass}`;
            card.innerHTML = `
                <div class="forecast-card-left">
                    <p class="text-xs uppercase tracking-widest text-gray-500 font-semibold">${w.window}</p>
                    <div class="flex items-center gap-2 mt-1">
                        <i class="fa-solid ${iconClass} text-lg"></i>
                        <span class="font-serif text-xl font-bold ${colorClass}">${w.risk_level}</span>
                    </div>
                </div>
                <div class="forecast-card-stats">
                    <div class="forecast-stat">
                        <i class="fa-solid fa-temperature-half text-gray-600 mb-1"></i>
                        <span class="text-white font-serif font-semibold">${w.avg_temp}°C</span>
                        <span class="text-gray-600 text-[10px] uppercase tracking-widest">Avg Temp</span>
                    </div>
                    <div class="forecast-stat">
                        <i class="fa-solid fa-droplet text-gray-600 mb-1"></i>
                        <span class="text-white font-serif font-semibold">${w.avg_humidity}%</span>
                        <span class="text-gray-600 text-[10px] uppercase tracking-widest">Humidity</span>
                    </div>
                    <div class="forecast-stat">
                        <i class="fa-solid fa-sun text-gray-600 mb-1"></i>
                        <span class="text-white font-serif font-semibold">${w.avg_uv}</span>
                        <span class="text-gray-600 text-[10px] uppercase tracking-widest">Peak UV</span>
                    </div>
                </div>
            `;
            wrapper.appendChild(card);

            if (i < trend.length - 1) {
                const arrow = document.createElement('div');
                arrow.className = 'forecast-trend-arrow flex justify-center items-center py-1 -my-1';
                arrow.innerHTML = getTrendArrow(w.risk_level, trend[i+1].risk_level);
                wrapper.appendChild(arrow);
            }
        });

        grid.appendChild(wrapper);
    }

    // ════════════════════════════════════════════════════════════════════
    // AI FEATURE 2: Explainable AI Renderer
    // ════════════════════════════════════════════════════════════════════
    function renderXAI(xai) {
        const container = document.getElementById('xaiFactors');
        const summary   = document.getElementById('xaiSummary');
        if (!container) return;

        if (summary) summary.innerText = xai.summary || '';
        container.innerHTML = '';

        const getBarClass = (weight) => {
            if (weight >= 80) return 'extreme';
            if (weight >= 55) return 'high';
            if (weight >= 35) return 'moderate';
            return 'low';
        };

        xai.factors.forEach(f => {
            const row = document.createElement('div');
            row.className = 'xai-factor-row';
            row.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="text-xl">${f.icon}</span>
                    <span class="text-sm text-gray-300 font-medium">${f.label}</span>
                </div>
                <div class="xai-bar-track">
                    <div class="xai-bar-fill ${getBarClass(f.weight)}" data-width="${f.weight}"></div>
                </div>
                <span class="text-xs text-gray-400 leading-snug">${f.contribution}</span>
            `;
            container.appendChild(row);
        });

        // Animate bars after a brief delay
        requestAnimationFrame(() => {
            setTimeout(() => {
                container.querySelectorAll('.xai-bar-fill').forEach(bar => {
                    bar.style.width = bar.dataset.width + '%';
                });
            }, 120);
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // AI FEATURE 3: Personalized Risk Score
    // ════════════════════════════════════════════════════════════════════

    // Condition pill toggle
    document.querySelectorAll('.condition-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            pill.classList.toggle('active');
        });
    });

    const scoreColors = {
        'Low':       '#22c55e',
        'Moderate':  '#eab308',
        'High':      '#f97316',
        'Very High': '#ef4444',
        'Critical':  '#dc2626'
    };
    const scoreLabelColors = {
        'Low':       'text-green-400',
        'Moderate':  'text-yellow-400',
        'High':      'text-orange-400',
        'Very High': 'text-red-400',
        'Critical':  'text-red-500'
    };

    const calcBtn = document.getElementById('calcPersonalRiskBtn');
    if (calcBtn) {
        calcBtn.addEventListener('click', async () => {
            const age        = document.getElementById('pr-age').value || 30;
            const occupation = document.getElementById('pr-occupation').value;
            const conditions = [...document.querySelectorAll('.condition-pill.active')]
                                .map(p => p.dataset.cond);
            const baseLevel  = window._baseRiskLevel || 'Low';

            calcBtn.disabled = true;
            calcBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Computing...';

            try {
                const res  = await fetch('/api/personal-risk', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ base_level: baseLevel, age, occupation, conditions })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    renderPersonalRisk(data);
                } else {
                    alert('Could not compute personal risk.');
                }
            } catch (e) {
                alert('Network error computing personal risk.');
            }

            calcBtn.disabled = false;
            calcBtn.innerHTML = '<i class="fa-solid fa-calculator mr-2"></i>Calculate My Risk';
        });
    }

    function renderPersonalRisk(data) {
        const resultPanel = document.getElementById('personalRiskResult');
        const scoreCircle = document.getElementById('scoreCircle');
        const scoreNumber = document.getElementById('scoreNumber');
        const riskLabel   = document.getElementById('personalRiskLabel');
        const notesList   = document.getElementById('personalRiskNotes');

        if (!resultPanel) return;
        resultPanel.classList.remove('hidden');

        const score      = data.risk_score;
        const level      = data.personal_risk_level;
        const circumference = 314.16;
        const offset     = circumference - (score / 100) * circumference;
        const ringColor  = scoreColors[level] || '#a855f7';

        scoreCircle.style.stroke           = ringColor;
        scoreCircle.style.strokeDashoffset = offset;

        // Animated counter
        let current = 0;
        const step  = Math.ceil(score / 40);
        scoreNumber.innerText = 0;
        const counter = setInterval(() => {
            current = Math.min(current + step, score);
            scoreNumber.innerText = current;
            if (current >= score) clearInterval(counter);
        }, 25);

        riskLabel.className = `font-serif text-2xl font-bold mb-2 ${scoreLabelColors[level] || 'text-dusk-400'}`;
        riskLabel.innerText = level;

        notesList.innerHTML = '';
        (data.detail_notes || []).forEach(note => {
            const li = document.createElement('li');
            li.className = 'personal-note-item';
            li.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>${note}</span>`;
            notesList.appendChild(li);
        });

        if (!data.detail_notes || !data.detail_notes.length) {
            notesList.innerHTML = '<li class="personal-note-item"><i class="fa-solid fa-circle-check"></i><span>No additional vulnerability factors detected for your profile.</span></li>';
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // AI FEATURE 4: Safety Recommendation Engine
    // ════════════════════════════════════════════════════════════════════
    function renderSafetyEngine(engineData) {
        const section = document.getElementById('safetyEngineSection');
        const alertsList = document.getElementById('dynamicAlertsList');
        const timeline = document.getElementById('dailyPlanTimeline');
        
        if (!section || !alertsList || !timeline) return;
        section.classList.remove('hidden');

        // Render Dynamic Alerts
        alertsList.innerHTML = '';
        (engineData.recommendations || []).forEach(rec => {
            const el = document.createElement('div');
            el.className = `dynamic-alert ${rec.type}`;
            el.innerHTML = `
                <i class="fa-solid ${rec.icon} text-lg flex-shrink-0 mt-0.5"></i>
                <div class="flex flex-col">
                    <span class="text-xs uppercase tracking-widest font-semibold opacity-70 mb-0.5">${rec.type} ALERT</span>
                    <span class="text-sm text-gray-200 font-medium leading-snug">${rec.message}</span>
                </div>
            `;
            alertsList.appendChild(el);
        });

        // Render Daily Plan Timeline
        // Clear all except the background line
        const bgLine = timeline.querySelector('.absolute');
        timeline.innerHTML = '';
        if (bgLine) timeline.appendChild(bgLine);

        const planColors = {
            'Low':           'text-green-400',
            'Moderate':      'text-yellow-400',
            'High':          'text-orange-400',
            'Extreme':       'text-red-500',
            'Moderate Cold': 'text-blue-400',
            'High Cold':     'text-blue-300',
            'Extreme Cold':  'text-indigo-300'
        };
        const planBgColors = {
            'Low':           'bg-green-500',
            'Moderate':      'bg-yellow-500',
            'High':          'bg-orange-500',
            'Extreme':       'bg-red-600',
            'Moderate Cold': 'bg-blue-500',
            'High Cold':     'bg-blue-400',
            'Extreme Cold':  'bg-indigo-500'
        };

        const icons = {
            'Morning':   'fa-sun-haze',
            'Afternoon': 'fa-sun',
            'Evening':   'fa-moon'
        };

        (engineData.daily_plan || []).forEach(block => {
            const riskKey = block.risk_level;
            const colorClass = planColors[riskKey] || 'text-gray-400';
            const bgClass = planBgColors[riskKey] || 'bg-gray-600';
            const icon = icons[block.period] || 'fa-clock';

            const node = document.createElement('div');
            node.className = 'timeline-node';
            node.innerHTML = `
                <div class="timeline-dot ${bgClass}">
                    <i class="fa-solid ${icon}"></i>
                </div>
                <div class="flex flex-col pt-1 w-full relative">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-white font-serif font-bold text-lg">${block.period}</span>
                        <span class="text-xs text-gray-500 font-mono">${block.time}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-sm font-semibold text-gray-300"><i class="fa-solid fa-temperature-half mr-1 opacity-50"></i>${block.avg_temp}°C</span>
                        <span class="text-xs uppercase tracking-widest font-bold ${colorClass}">${block.risk_level}</span>
                    </div>
                </div>
            `;
            timeline.appendChild(node);
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // DATA VISUALIZATION DASHBOARD
    // ════════════════════════════════════════════════════════════════════

    // Chart instances (destroyed and recreated on new location)
    let chartTempInst      = null;
    let chartHeatIdxInst   = null;
    let chartHistoryInst   = null;
    let vizInitialized     = false;

    // Chart.js shared dark theme defaults
    const CHART_DEFAULTS = {
        color:  'rgba(200,200,220,0.7)',
        grid:   'rgba(255,255,255,0.04)',
        tick:   'rgba(200,200,220,0.45)',
        font:   { family: 'Inter, sans-serif', size: 10 }
    };

    function buildLineOpts(label, lineColor, fillColor, yLabel) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,10,20,0.9)',
                    titleColor: '#a855f7',
                    bodyColor: '#e5e7eb',
                    borderColor: 'rgba(139,92,246,0.3)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: { label: ctx => `  ${ctx.parsed.y} ${yLabel}` }
                }
            },
            scales: {
                x: {
                    ticks: { color: CHART_DEFAULTS.tick, font: CHART_DEFAULTS.font, maxTicksLimit: 8 },
                    grid:  { color: CHART_DEFAULTS.grid }
                },
                y: {
                    ticks: { color: CHART_DEFAULTS.tick, font: CHART_DEFAULTS.font },
                    grid:  { color: CHART_DEFAULTS.grid }
                }
            }
        };
    }

    function initVizDashboard() {
        const section = document.getElementById('vizDashboard');
        if (section) section.classList.remove('hidden');

        // Tab switching
        document.querySelectorAll('.viz-tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.viz-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.viz-panel').forEach(p => p.classList.add('hidden'));
                document.getElementById('panel-' + tab.dataset.tab).classList.remove('hidden');

                // Lazy-load historical data on first click
                if (tab.dataset.tab === 'history' && !chartHistoryInst) {
                    fetchAndRenderHistory();
                }
            };
        });

        // PDF Download
        const dlBtn = document.getElementById('downloadReportBtn');
        if (dlBtn) {
            dlBtn.onclick = downloadPDFReport;
        }

        // Destroy old chart instances
        if (chartTempInst)    { chartTempInst.destroy();    chartTempInst    = null; }
        if (chartHeatIdxInst) { chartHeatIdxInst.destroy(); chartHeatIdxInst = null; }
        if (chartHistoryInst) { chartHistoryInst.destroy(); chartHistoryInst = null; }

        const localDate = new Date().toISOString().split('T')[0];
        // Fetch today's data and render default charts
        fetch('/api/chart-data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                lat: window._lastLat, 
                lng: window._lastLng,
                local_date: localDate 
            })
        })
        .then(r => r.json())
        .then(d => {
            if (d.status !== 'success') return;
            window._chartData = d;
            renderTempChart(d);
            renderHeatIndexChart(d);
        })
        .catch(err => console.warn('Chart data fetch failed:', err));
    }

    function renderTempChart(d) {
        const ctx = document.getElementById('chartTemp');
        if (!ctx) return;
        if (chartTempInst) chartTempInst.destroy();

        chartTempInst = new Chart(ctx, {
            type: 'line',
            data: {
                labels: d.hours,
                datasets: [{
                    label: 'Temperature (°C)',
                    data: d.today.temps,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168,85,247,0.12)',
                    borderWidth: 2,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#a855f7',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: buildLineOpts('Temperature', '#a855f7', 'rgba(168,85,247,0.12)', '°C')
        });
    }

    function renderHeatIndexChart(d) {
        const ctx = document.getElementById('chartHeatIndex');
        if (!ctx) return;
        if (chartHeatIdxInst) chartHeatIdxInst.destroy();

        chartHeatIdxInst = new Chart(ctx, {
            type: 'line',
            data: {
                labels: d.hours,
                datasets: [{
                    label: 'Heat Index (°C)',
                    data: d.today.heat_index,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249,115,22,0.10)',
                    borderWidth: 2,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#f97316',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: buildLineOpts('Heat Index', '#f97316', 'rgba(249,115,22,0.10)', '°C')
        });
    }

    async function fetchAndRenderHistory() {
        const loading = document.getElementById('histLoading');
        if (loading) loading.classList.remove('hidden');

        let d = window._chartData;
        if (!d) {
            try {
                const r = await fetch('/api/chart-data', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat: window._lastLat, lng: window._lastLng })
                });
                d = await r.json();
                window._chartData = d;
            } catch(e) {
                if (loading) loading.classList.add('hidden');
                return;
            }
        }

        if (loading) loading.classList.add('hidden');

        const ctx = document.getElementById('chartHistory');
        if (!ctx || d.status !== 'success') return;
        if (chartHistoryInst) chartHistoryInst.destroy();

        chartHistoryInst = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: d.hours,
                datasets: [
                    {
                        label: `Today (${d.dates.today})`,
                        data: d.today.temps,
                        backgroundColor: 'rgba(168,85,247,0.55)',
                        borderColor: '#a855f7',
                        borderWidth: 1,
                        borderRadius: 2
                    },
                    {
                        label: `Yesterday (${d.dates.yesterday})`,
                        data: d.yesterday.temps,
                        backgroundColor: 'rgba(234,179,8,0.45)',
                        borderColor: '#eab308',
                        borderWidth: 1,
                        borderRadius: 2
                    },
                    {
                        label: `Last Week (${d.dates.lastweek})`,
                        data: d.lastweek.temps,
                        backgroundColor: 'rgba(59,130,246,0.40)',
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        borderRadius: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: 'rgba(200,200,220,0.7)', font: { size: 10, family: 'Inter, sans-serif' }, boxWidth: 12 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10,10,20,0.9)',
                        titleColor: '#a855f7',
                        bodyColor: '#e5e7eb',
                        borderColor: 'rgba(139,92,246,0.3)',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        ticks: { color: CHART_DEFAULTS.tick, font: CHART_DEFAULTS.font, maxTicksLimit: 8 },
                        grid:  { color: CHART_DEFAULTS.grid }
                    },
                    y: {
                        ticks: { color: CHART_DEFAULTS.tick, font: CHART_DEFAULTS.font },
                        grid:  { color: CHART_DEFAULTS.grid }
                    }
                }
            }
        });
    }

    async function downloadPDFReport() {
        const btn = document.getElementById('downloadReportBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Generating...'; }

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const W = doc.internal.pageSize.getWidth();
            const w = W;

            // ── Header ──
            doc.setFillColor(14, 10, 26);
            doc.rect(0, 0, W, 40, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(20);
            doc.setTextColor(212, 175, 55);
            doc.text('HeatwaveGuard', 14, 18);
            doc.setFontSize(9);
            doc.setTextColor(139, 92, 246);
            doc.text('ATMOSPHERIC INTELLIGENCE REPORT', 14, 26);
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 120);
            doc.text(`Location: ${window._lastLocationName || 'Unknown'}`, 14, 33);
            doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, 33, { align: 'right' });

            // ── Current Conditions ──
            let y = 50;
            doc.setFillColor(20, 15, 35);
            doc.roundedRect(10, y, W - 20, 38, 3, 3, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(212, 175, 55);
            doc.text('CURRENT CONDITIONS', 16, y + 9);

            const wx = window._lastWeather || {};
            const metrics = [
                ['Temperature', `${wx.temperature || '--'}°C`],
                ['Humidity',    `${wx.humidity    || '--'}%`],
                ['UV Index',    `${wx.uv_index    || '--'}`],
                ['Heat Index',  `${wx.heat_index  || '--'}°C`],
                ['Risk Level',  `${window._lastRisk || '--'}`]
            ];
            doc.setFontSize(9);
            metrics.forEach(([k, v], i) => {
                const col = i < 3 ? 0 : 1;
                const row = i < 3 ? i : i - 3;
                const bx = 16 + col * (W / 2 - 12);
                const by = y + 18 + row * 8;
                doc.setTextColor(120, 120, 150);
                doc.text(k + ':', bx, by);
                doc.setTextColor(230, 230, 240);
                doc.text(v, bx + 32, by);
            });

            y += 46;

            // ── Chart snapshot (visible chart) ──
            const activePanel = document.querySelector('.viz-panel:not(.hidden) canvas');
            if (activePanel && typeof html2canvas !== 'undefined') {
                doc.setFontSize(10);
                doc.setTextColor(139, 92, 246);
                doc.setFont('helvetica', 'bold');
                doc.text('WEATHER CHART', 14, y + 7);
                y += 12;

                const canvas = await html2canvas(activePanel, { backgroundColor: '#0d1117', scale: 1.5 });
                const imgData = canvas.toDataURL('image/png');
                const imgH = (canvas.height / canvas.width) * (W - 20);
                doc.addImage(imgData, 'PNG', 10, y, W - 20, Math.min(imgH, 80));
                y += Math.min(imgH, 80) + 8;
            }

            // ── Footer ──
            doc.setFillColor(14, 10, 26);
            doc.rect(0, 280, W, 17, 'F');
            doc.setFontSize(7);
            doc.setTextColor(60, 60, 80);
            doc.text('HeatwaveGuard | AI & ML Division — Excellence Without Compromise', W / 2, 289, { align: 'center' });

            doc.save(`heatwaveguard_report_${(window._lastLocationName || 'loc').replace(/[^a-z0-9]/gi, '_')}.pdf`);
        } catch(e) {
            console.error('PDF generation failed:', e);
            alert('PDF generation failed. Please try again.');
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-pdf mr-2"></i>Download Report'; }
    }

    // ── Alert Notification logic ──────────────────────────────────────
    function triggerAtmosphericAlert(data, prediction, weather) {
        const severeRisks = ['moderate', 'high', 'extreme', 'moderate cold', 'high cold', 'extreme cold'];
        if (severeRisks.includes(prediction.risk_level.toLowerCase())) {
            fetch('/api/send-alert', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    risk_level: prediction.risk_level,
                    guidelines: prediction.safety_guidelines,
                    temp:       weather.temperature,
                    heat_index: weather.heat_index,
                    hospitals:  data.hospitals,
                    transit:    data.transit
                })
            })
            .then(res => res.json())
            .then(resData => {
                if (resData.status === 'sent') {
                    showToast(`Alert dispatched to ${resData.email}`);
                }
            })
            .catch(() => {});
        }
    }

    function showToast(msg) {
        if (!alertToast) return;
        toastMessage.innerText = msg;
        alertToast.classList.remove('translate-x-[120%]');
        alertToast.classList.add('translate-x-0');
        setTimeout(() => {
            alertToast.classList.remove('translate-x-0');
            alertToast.classList.add('translate-x-[120%]');
        }, 5000);
    }

    // ════════════════════════════════════════════════════════════════════
    // CHATBOT ASSISTANT
    // ════════════════════════════════════════════════════════════════════
    
    const chatbotToggleBtn = document.getElementById('chatbotToggleBtn');
    const closeChatBtn = document.getElementById('closeChatBtn');
    const chatPanel = document.getElementById('chatPanel');
    const chatInput = document.getElementById('chatInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    const chatMessages = document.getElementById('chatMessages');

    if (chatbotToggleBtn && chatPanel) {
        chatbotToggleBtn.addEventListener('click', () => {
            chatPanel.classList.toggle('hidden');
            if (!chatPanel.classList.contains('hidden')) {
                chatInput.focus();
            }
        });

        closeChatBtn.addEventListener('click', () => {
            chatPanel.classList.add('hidden');
        });

        const appendMessage = (text, sender) => {
            const div = document.createElement('div');
            div.className = `chat-bubble ${sender}`;
            div.innerText = text;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        };

        const processChatbotInput = () => {
            const val = chatInput.value.trim();
            if(!val) return;
            
            appendMessage(val, 'user');
            chatInput.value = '';
            
            // Artificial delay for realism
            setTimeout(() => {
                const response = generateChatbotResponse(val);
                appendMessage(response, 'bot');
            }, 600);
        };

        sendMessageBtn.addEventListener('click', processChatbotInput);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') processChatbotInput();
        });

        // Simple Rule-Based NLP Logic
        function generateChatbotResponse(msg) {
            const lowerMsg = msg.toLowerCase();
            const temp = window._lastWeather?.temperature || null;
            const risk = window._lastRisk?.toLowerCase() || 'unknown';

            // Custom Temperature Rule (e.g. "What should I do in 42C?")
            const tempMatch = lowerMsg.match(/(\d{2,3})\s*(?:c|degrees)?/);
            if (tempMatch && lowerMsg.includes('what')) {
                const degrees = parseInt(tempMatch[1]);
                if (degrees > 38) return `At ${degrees}°C, you are at extreme risk of heat stroke. Stay indoors, seek air conditioning immediately, avoid exertion, and hydrate continuously.`;
                if (degrees > 32) return `At ${degrees}°C, take caution. Limit outdoor activities to early morning, wear UPF-rated clothing, and drink plenty of fluids.`;
                if (degrees < 5) return `At ${degrees}°C, you are facing severe cold exposure. Dress in heavy layers immediately, guard extremities, and stay indoors if possible.`;
                return `At ${degrees}°C, conditions are relatively stable. Just exercise common sense and stay hydrated.`;
            }

            // General "Safe to go outside" Rule
            if (lowerMsg.includes('safe') || lowerMsg.includes('outside')) {
                if (!temp) return "Please search for a location or use GPS first so I can analyze the current conditions.";
                if (risk.includes('extreme') || risk.includes('high')) {
                    if (risk.includes('cold')) return "No, it is highly inadvisable to go outside. There is a high risk of frostbite or hypothermia.";
                    return `No, it is not safe. The current risk level is ${risk} (${temp}°C). Outdoor exposure should be strictly limited to emergencies.`;
                }
                if (risk === 'moderate') {
                    return `It's acceptable, but the risk is Moderate (${temp}°C). Take precautions: wear a hat, use sunscreen, and limit exertion.`;
                }
                return `Yes, it is entirely safe! The current conditions are calm (${temp}°C). Enjoy your time outdoors.`;
            }

            // Keywords
            if (lowerMsg.includes('hello') || lowerMsg.includes('hi ')) return 'Greetings! I am the HeatGuard AI. Ask me if it is safe outside, or what precautions to take for certain temperatures.';
            if (lowerMsg.includes('water') || lowerMsg.includes('hydrate')) return 'Hydration is critical. Avoid caffeine or alcohol during high heat events, and consume water proactively.';
            if (lowerMsg.includes('uv') || lowerMsg.includes('sun')) return 'If the UV index is higher than 3, you should wear SPF 30+ sunscreen, sunglasses, and protective clothing.';
            if (lowerMsg.includes('cold') || lowerMsg.includes('freeze')) return 'In extreme cold, frostbite can occur in minutes. Wrap all exposed skin, wear insulated boots, and stay dry.';

            // Fallback
            if (temp) {
                return `Currently, your location is at ${temp}°C with a ${risk} risk profile. Ask me specific questions like "Is it safe to go outside?"`;
            }
            return "I am an atmospheric safety AI. Let me know what location you are analyzing and I can provide tailored safety advice.";
        }
    }

});
