// ── Google Maps globals (referenced by API callback) ─────────────────────
let googleMap    = null;
let mapMarker   = null;
let pendingCoords = null;  // coords set before API loaded

// Called automatically by the Maps JS API once loaded (see callback=initMap)
function initMap() {
    // If updateDashboard ran before the API loaded, draw the map now
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
        // First call — create the map
        googleMap = new google.maps.Map(mapDiv, {
            center:            position,
            zoom:              14,
            mapTypeId:         'roadmap',
            disableDefaultUI:  false,
            // Minimal control set for a premium feel
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
        // Subsequent calls — just pan & move marker
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
    const riskLevelOutput      = document.getElementById('riskLevelOutput');
    const safetyGuidelinesOutput = document.getElementById('safetyGuidelinesOutput');
    const alertBanner          = document.getElementById('alertBanner');
    const alertIconWrapper     = document.getElementById('alertIconWrapper');
    const alertIconSymbol      = document.getElementById('alertIconSymbol');
    const locationLabel        = document.getElementById('locationLabel');

    // Metric Elements
    const tempVal      = document.getElementById('tempVal');
    const humidityVal  = document.getElementById('humidityVal');
    const uvVal        = document.getElementById('uvVal');
    const heatIndexVal = document.getElementById('heatIndexVal');

    // Search Elements
    const searchBtn    = document.getElementById('searchLocationBtn');
    const searchInput  = document.getElementById('locationSearchInput');
    const dropdown     = document.getElementById('autocompleteDropdown');
    
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
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your system.');
            return;
        }
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
        const parts = [item.admin1, item.country].filter(Boolean);
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
            // Use mousedown (fires before blur) so we can capture click
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
        } catch (e) {
            console.error('Autocomplete fetch failed:', e);
        }
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        debounceTimer = setTimeout(() => fetchSuggestions(q), 260);
    });

    searchInput.addEventListener('blur', () => {
        // Short delay lets mousedown on item fire first
        setTimeout(closeDropdown, 200);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeDropdown(); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = searchInput.value.trim();
            if (!q) return;
            closeDropdown();
            // If user selected from dropdown, coords already set
            if (selectedLabel === q && selectedLat !== null) {
                analyzeCoords(selectedLat, selectedLng, selectedLabel);
            } else {
                // Fallback: let backend geocode
                runTextSearch(q);
            }
        }
    });

    searchBtn.addEventListener('click', () => {
        const q = searchInput.value.trim();
        if (!q) return;
        closeDropdown();
        if (selectedLabel === q && selectedLat !== null) {
            analyzeCoords(selectedLat, selectedLng, selectedLabel);
        } else {
            runTextSearch(q);
        }
    });

    async function runTextSearch(query) {
        showLoader();
        try {
            const res  = await fetch('/api/predict', {
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
        } catch (err) {
            alert('Network error. Unable to reach the telemetry server.');
            hideLoader();
        }
    }

    // ── Dashboard Renderer ────────────────────────────────────────────
    function updateDashboard(data, label) {
        const { weather, prediction, location_name } = data;

        // Metrics
        tempVal.innerText      = weather.temperature;
        humidityVal.innerText  = weather.humidity;
        uvVal.innerText        = weather.uv_index;
        heatIndexVal.innerText = weather.heat_index;

        // Risk
        riskLevelOutput.innerText        = prediction.risk_level;
        safetyGuidelinesOutput.innerText = prediction.safety_guidelines;
        
        const finalLabel = location_name || label;
        if (locationLabel) locationLabel.innerText = finalLabel ? `📍 ${finalLabel}` : '';

        // ── Google Maps: center on the returned coordinates ────────────
        const lat = data.location.lat;
        const lng = data.location.lng;
        if (typeof google !== 'undefined' && google.maps) {
            renderMap(lat, lng);
        } else {
            // API not loaded yet — store coords and let initMap() pick them up
            pendingCoords = { lat, lng };
        }

        // Reset icon wrapper classes
        alertIconWrapper.className = 'px-10 py-8 flex items-center justify-center transition-all duration-500 min-w-[120px] ';

        const risk = prediction.risk_level.toLowerCase();
        const riskMap = {
            low:      { wrap: 'bg-green-900/80 border-l-4 border-green-500',  icon: 'fa-solid fa-shield-check text-4xl text-green-300 drop-shadow-lg',   text: 'font-bold text-green-400' },
            moderate: { wrap: 'bg-yellow-900/80 border-l-4 border-yellow-500', icon: 'fa-solid fa-triangle-exclamation text-4xl text-yellow-300 drop-shadow-lg', text: 'font-bold text-yellow-400' },
            high:     { wrap: 'bg-orange-900/80 border-l-4 border-orange-500', icon: 'fa-solid fa-triangle-exclamation text-4xl text-orange-300 drop-shadow-lg', text: 'font-bold text-orange-400' },
            extreme:  { wrap: 'bg-red-900/80 border-l-4 border-red-500',       icon: 'fa-solid fa-skull text-4xl text-red-300 drop-shadow-lg animate-pulse', text: 'font-bold text-red-500' }
        };
        const style = riskMap[risk] || riskMap.low;
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
                const isBus = s.type === 'bus_station' || s.type === 'bus_stop';
                const icon  = isBus ? 'fa-bus' : 'fa-train';
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

        hideLoader();
        dashboard.classList.remove('hidden');

        // Send alert email if severity is non-Low
        triggerAtmosphericAlert(data, prediction, weather);
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
            .catch(() => {}); // Fire and forget
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

});
