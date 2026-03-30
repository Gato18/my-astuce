/**
 * App.js - Logique UI Principale
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const favoritesSection = document.getElementById('favorites-section');
    const favoritesList = document.getElementById('favorites-list');
    const emptyFavorites = document.getElementById('empty-favorites');
    
    const stopDashboard = document.getElementById('stop-dashboard');
    const dashStopName = document.getElementById('dashboard-stop-name');
    const dashStopDesc = document.getElementById('dashboard-stop-desc');
    const dashDepartures = document.getElementById('dashboard-departures');
    const btnCloseDashboard = document.getElementById('btn-close-dashboard');

    const btnMap = document.getElementById('btn-map');
    const btnCloseMap = document.getElementById('btn-close-map');
    const btnAroundMe = document.getElementById('btn-around-me');
    const themeToggle = document.getElementById('theme-toggle');

    const btnOpenRouteSelector = document.getElementById('btn-open-route-selector');
    const btnCloseRouteSelector = document.getElementById('btn-close-route-selector');
    const routeSelector = document.getElementById('route-selector');
    const routeList = document.getElementById('route-list');
    const routeFilterInput = document.getElementById('route-filter-input');
    const activeRouteInfo = document.getElementById('active-route-info');
    const btnClearRoute = document.getElementById('btn-clear-route');

    // État
    let currentStop = null;
    let pollInterval = null;
    let mapRefreshInterval = null;
    let favoritesInterval = null; // Timer pour le rafraîchissement des favoris
    let stopsData = []; // Stations parents uniquement
    let allRoutes = []; // Cache local des lignes
    const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function getPreferredTheme() {
        const savedTheme = localStorage.getItem('astuce-theme');
        if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
        return themeMediaQuery.matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        document.documentElement.classList.toggle('dark', isDark);
        if (themeToggle) {
            themeToggle.setAttribute('aria-pressed', String(isDark));
            themeToggle.setAttribute('title', isDark ? 'Passer en mode jour' : 'Passer en mode nuit');
            const icon = themeToggle.querySelector('i');
            if (icon) icon.setAttribute('data-lucide', isDark ? 'sun-medium' : 'moon-star');
        }
        lucide.createIcons();
    }

    function toggleTheme() {
        const nextTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        localStorage.setItem('astuce-theme', nextTheme);
        applyTheme(nextTheme);
    }

    function handleSystemThemeChange(event) {
        if (localStorage.getItem('astuce-theme')) return;
        applyTheme(event.matches ? 'dark' : 'light');
    }

    // Mapping type de véhicule -> icône Lucide + label
    function getVehicleIcon(routeType) {
        switch(routeType) {
            case 'metro':     return { icon: 'train-front', label: 'Métro',     emoji: '🚇' };
            case 'teor':      return { icon: 'tram-front',  label: 'TEOR',      emoji: '🚊' };
            case 'fast':      return { icon: 'zap',         label: 'Fast',      emoji: '⚡' };
            case 'ferry':     return { icon: 'ship',        label: 'Ferry',     emoji: '⛴️' };
            case 'noctambus': return { icon: 'moon',        label: 'Noctambus', emoji: '🌙' };
            default:          return { icon: 'bus',          label: 'Bus',       emoji: '🚌' };
        }
    }

    /* --- PHASE 4 : INFO TRAFIC --- */
    async function fetchTraficInfo() {
        const alertes = await api.getAlertes();
        
        if (alertes && alertes.length > 0) {
            const banner = document.createElement('div');
            banner.className = 'w-full bg-orange-100 dark:bg-orange-900/40 border-l-4 border-orange-500 text-orange-800 dark:text-orange-200 p-4 rounded-xl shadow-sm mb-4 animate-fade-in flex gap-3';
            const principale = alertes[0];
            banner.innerHTML = `
                <i data-lucide="triangle-alert" class="w-6 h-6 shrink-0 mt-0.5"></i>
                <div>
                    <h3 class="font-bold text-sm mb-1">${principale.header}</h3>
                    <p class="text-xs opacity-90 leading-relaxed">${principale.description}</p>
                </div>
            `;
            const searchSection = document.querySelector('section.relative.z-40');
            if (searchSection) {
                searchSection.parentNode.insertBefore(banner, searchSection);
                lucide.createIcons();
            }
        }
    }

    /* --- CHARGEMENT DONNÉES --- */
    async function loadStops() {
        try {
            const response = await fetch('/data/gtfs/stops.txt');
            if (response.ok) {
                const text = await response.text();
                const lines = text.split('\n');
                const parseCSVLine = (t) => {
                    const re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;
                    let a = [];
                    t.replace(re_value, function(m0, m1, m2, m3) {
                        if (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"));
                        else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"'));
                        else if (m3 !== undefined) a.push(m3);
                        return '';
                    });
                    return a;
                };
                const normalizeStopName = (str) => {
                    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
                };
                const stopsByName = {};
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const parts = parseCSVLine(line);
                    if (parts && parts.length >= 9) {
                        const id = parts[0];
                        const name = parts[2] || '';
                        const normalized = normalizeStopName(name);
                        const locationType = parseInt(parts[8]) || 0;
                        const stopObj = { id, code: parts[1], name, description: parts[3], latitude: parseFloat(parts[4]), longitude: parseFloat(parts[5]), locationType };
                        if (!stopsByName[normalized] || (locationType === 1 && stopsByName[normalized].locationType !== 1)) {
                            stopsByName[normalized] = stopObj;
                        }
                    }
                }
                stopsData = Object.values(stopsByName);
            }
        } catch (error) { console.error("Erreur de chargement des arrêts", error); }
    }

    /* --- RECHERCHE --- */
    function handleSearch(e) {
        let query = e.target.value.toLowerCase().trim();
        if (query.length < 2) { hideSearchResults(); return; }
        const removeAccents = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        query = removeAccents(query);
        const results = stopsData.filter(s => removeAccents(s.name).includes(query) || removeAccents(s.description).includes(query)).slice(0, 10);
        renderSearchResults(results);
    }

    function renderSearchResults(results) {
        searchResults.innerHTML = '';
        if (results.length === 0) {
            searchResults.innerHTML = `<div class="px-4 py-6 text-center text-gray-500 text-sm">Aucun arrêt trouvé.</div>`;
        } else {
            results.forEach(stop => {
                const btn = document.createElement('button');
                btn.className = 'w-full text-left px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors flex items-center gap-3.5 group';
                btn.innerHTML = `
                    <div class="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 group-hover:bg-astuce-blue/10 group-hover:text-astuce-blue transition-colors">
                        <i data-lucide="map-pin" class="w-5 h-5"></i>
                    </div>
                    <div class="flex-1">
                        <div class="font-semibold text-gray-900 dark:text-gray-100">${stop.name}</div>
                        <div class="text-xs text-gray-500">${stop.description}</div>
                    </div>
                `;
                btn.addEventListener('click', () => showStopDashboard(stop));
                searchResults.appendChild(btn);
            });
            lucide.createIcons();
        }
        searchResults.classList.remove('hidden');
    }

    function hideSearchResults() { searchResults.classList.add('hidden'); }

    /* --- FAVORIS --- */
    async function updateFavoritesTimes(favs) {
        favs.forEach((fav, index) => {
            const timesDiv = document.getElementById(`fav-times-${index}`);
            if (!timesDiv) return;

            api.getHorairesStation(fav.stop.id).then(result => {
                const groups = result.data || [];
                const myGroup = groups.find(g => g.direction === fav.direction && g.routeId === fav.routeId) || groups.find(g => g.direction === fav.direction);
                if (myGroup && myGroup.passages.length > 0) {
                    const now = Math.floor(Date.now() / 1000);
                    let html = '';
                    myGroup.passages.slice(0, 3).forEach(p => {
                        const mins = Math.floor((p.arrival - now) / 60);
                        const label = mins <= 0 ? 'Imm.' : mins < 2 ? `${mins}m` : mins > 60 ? new Date(p.arrival * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : `${mins}m`;
                        html += `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-astuce-blue/10 text-astuce-blue mr-1">${label}</span>`;
                    });
                    timesDiv.innerHTML = html;
                } else {
                    timesDiv.innerHTML = '<span class="text-xs text-gray-400 italic">Aucun passage</span>';
                }
            }).catch(() => {
                timesDiv.innerHTML = '<span class="text-xs text-red-400 italic">Erreur</span>';
            });
        });
    }

    async function renderFavorites() {
        if (favoritesInterval) {
            clearInterval(favoritesInterval);
            favoritesInterval = null;
        }

        const favs = favoritesManager.getFavorites();
        favoritesList.innerHTML = '';
        if (favs.length === 0) {
            emptyFavorites.style.display = 'block';
        } else {
            emptyFavorites.style.display = 'none';
            favs.forEach((fav, index) => {
                const card = document.createElement('div');
                card.className = 'w-full bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden relative';
                card.innerHTML = `
                    <button class="fav-main-btn w-full text-left p-4 hover:bg-gray-50/50 transition-colors flex items-center gap-3.5">
                        <div class="w-12 h-12 rounded-xl flex shrink-0 items-center justify-center font-bold text-white text-sm" style="background-color: #${fav.routeColor}">${fav.routeName}</div>
                        <div class="flex-1 min-w-0">
                            <div class="font-bold text-[15px] truncate">${fav.stop.name}</div>
                            <div class="text-xs text-gray-500 truncate">Vers : ${fav.direction}</div>
                        </div>
                        <button class="fav-remove-btn p-2 text-yellow-400 hover:text-red-500 transition-colors">
                            <i data-lucide="star" class="w-4 h-4 fill-current"></i>
                        </button>
                    </button>
                    <div id="fav-times-${index}" class="border-t border-gray-100 dark:border-gray-800 px-4 py-2.5 flex items-center gap-2">
                        <i data-lucide="loader-2" class="w-4 h-4 animate-spin text-gray-400"></i>
                    </div>
                `;
                card.querySelector('.fav-remove-btn').addEventListener('click', e => {
                    e.stopPropagation();
                    favoritesManager.removeFavorite(fav.id);
                    renderFavorites();
                });
                card.querySelector('.fav-main-btn').addEventListener('click', () => showStopDashboard(fav.stop));
                favoritesList.appendChild(card);
            });
            lucide.createIcons();

            // Mettre à jour immédiatement puis commencer le polling
            updateFavoritesTimes(favs);
            favoritesInterval = setInterval(() => updateFavoritesTimes(favs), 15000);
        }
    }

    function applyStarStyle(svg, isFav) {
        if (!svg) return;
        svg.style.fill = isFav ? '#facc15' : 'none';
        svg.style.stroke = isFav ? '#facc15' : '#d1d5db';
    }

    window.toggleRouteFavorite = function(btnElem, routeDataStr) {
        const routeData = JSON.parse(decodeURIComponent(routeDataStr));
        const favId = `${currentStop.id}_${routeData.routeId}_${encodeURIComponent(routeData.direction)}`;
        const nowFav = !favoritesManager.isFavorite(favId);
        if (nowFav) {
            favoritesManager.addFavorite({ id: favId, stop: currentStop, ...routeData });
        } else {
            favoritesManager.removeFavorite(favId);
        }
        const svg = btnElem.querySelector('svg');
        applyStarStyle(svg, nowFav);
        btnElem.dataset.fav = nowFav ? '1' : '0';
        renderFavorites();
    };

    /* --- DASHBOARD --- */
    function showStopDashboard(stopOrId) {
        let stop = stopOrId;
        if (typeof stopOrId === 'string') stop = stopsData.find(s => s.id === stopOrId);
        if (!stop) return;
        currentStop = stop;
        searchInput.value = '';
        hideSearchResults();
        favoritesSection.classList.add('hidden');
        dashStopName.textContent = stop.name;
        dashStopDesc.innerHTML = `<i data-lucide="map-pin" class="w-3.5 h-3.5"></i> ${stop.description}`;
        
        // Fermer la carte pour voir le dashboard
        if (typeof mapManager !== 'undefined' && mapManager.closeMap) {
            mapManager.closeMap();
        }

        stopDashboard.classList.remove('hidden');
        fetchDepartures();
        
        // Arrêter le polling des favoris si on est sur le dashboard détaillé
        if (favoritesInterval) {
            clearInterval(favoritesInterval);
            favoritesInterval = null;
        }

        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(fetchDepartures, 15000);
    }

    function hideStopDashboard() {
        currentStop = null;
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
        stopDashboard.classList.add('hidden');
        favoritesSection.classList.remove('hidden');
        
        // Relancer le rafraîchissement des favoris en regénérant l'affichage
        renderFavorites();
    }

    async function fetchDepartures() {
        if (!currentStop) return;
        if (dashDepartures.children.length === 0 || dashDepartures.innerHTML.includes('loader')) {
            dashDepartures.innerHTML = '<div class="py-10 text-center"><i data-lucide="loader-2" class="w-8 h-8 text-astuce-blue animate-spin mx-auto"></i></div>';
            lucide.createIcons();
        }
        const result = await api.getHorairesStation(currentStop.id);
        const groupedPassages = result.data || [];
        const staticRoutes = result.staticRoutes || [];
        
        dashDepartures.innerHTML = '';
        if (groupedPassages.length === 0) {
            if (staticRoutes.length > 0) {
                let html = '<div class="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">';
                html += '<p class="text-xs text-gray-500 mb-3 text-center italic">Aucun passage immédiat. Lignes desservant cet arrêt :</p>';
                html += '<div class="grid grid-cols-2 gap-2">';
                staticRoutes.forEach(r => {
                    html += `
                        <div class="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded-xl shadow-sm">
                            <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-[10px]" style="background-color: #${r.color}">${r.shortName}</div>
                            <div class="text-[10px] font-semibold text-gray-700 dark:text-gray-300 truncate">${r.shortName}</div>
                        </div>
                    `;
                });
                html += '</div></div>';
                dashDepartures.innerHTML = html;
            } else {
                dashDepartures.innerHTML = '<p class="text-center py-8 text-gray-500">Aucune information de ligne disponible.</p>';
            }
        } else {
            const now = Math.floor(Date.now()/1000);
            groupedPassages.forEach(group => {
                const vType = getVehicleIcon(group.routeType || 'bus');
                const isFav = favoritesManager.isFavorite(`${currentStop.id}_${group.routeId}_${encodeURIComponent(group.direction)}`);
                const routeDataStr = encodeURIComponent(JSON.stringify({
                    routeId: group.routeId, routeName: group.routeName, routeColor: group.routeColor, 
                    routeType: group.routeType, directionId: group.directionId, direction: group.direction
                }));
                const card = document.createElement('div');
                card.className = "bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-4 rounded-3xl relative overflow-hidden mb-3 shadow-sm";
                let passagesHTML = group.passages.slice(0, 3).map((p, i) => {
                    const mins = Math.floor((p.arrival - now)/60);
                    const label = mins <= 0 ? "Imm." : `${mins} min`;
                    return `<div class="bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-gray-700">
                        <span class="font-bold ${mins < 2 ? 'text-astuce-red animate-pulse' : ''}">${label}</span>
                    </div>`;
                }).join(' ');

                card.innerHTML = `
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-xs" style="background-color: #${group.routeColor}">${group.routeName}</div>
                            <div>
                                <div class="text-[10px] text-gray-400 font-bold uppercase"><i data-lucide="${vType.icon}" class="inline w-3 h-3 mr-1"></i> ${vType.label}</div>
                                <div class="font-extrabold text-sm truncate max-w-[150px]">${group.direction}</div>
                            </div>
                        </div>
                        <button onclick="toggleRouteFavorite(this, '${routeDataStr}')" data-fav="${isFav?'1':'0'}" class="fav-star-btn p-2 rounded-full bg-gray-50">
                            <i data-lucide="star" class="w-5 h-5"></i>
                        </button>
                    </div>
                    <div class="flex gap-2">${passagesHTML}</div>
                `;
                dashDepartures.appendChild(card);
            });
            lucide.createIcons();
            dashDepartures.querySelectorAll('.fav-star-btn').forEach(btn => applyStarStyle(btn.querySelector('svg'), btn.dataset.fav === '1'));
        }
    }

    /* --- MAP --- */
    async function handleAroundMe() {
        const originalText = btnAroundMe.innerHTML;
        btnAroundMe.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>'; lucide.createIcons();
        try {
            const userLoc = await mapManager.getUserLocation();
            stopsData.forEach(s => s.distance = mapManager.calculateDistance(userLoc.lat, userLoc.lon, s.latitude, s.longitude));
            const nearest = stopsData.filter(s => s.distance < 2000).sort((a,b) => a.distance - b.distance).slice(0, 3);
            if (nearest.length > 0) {
                renderSearchResults(nearest);
                searchInput.value = "📍 À proximité";
            }
        } catch (e) { alert("Géolocalisation impossible"); }
        finally { btnAroundMe.innerHTML = originalText; lucide.createIcons(); }
    }

    function openLiveMap() {
        mapManager.openMap();
        setTimeout(() => { if (Object.keys(mapManager.allMarkers).length === 0) mapManager.addAllStops(stopsData, (sId) => showStopDashboard(sId)); }, 300);
    }

    async function openRouteSelector() {
        routeSelector.classList.remove('translate-y-[120%]', 'opacity-0', 'invisible');
        routeSelector.classList.add('translate-y-0', 'opacity-100');
        if (allRoutes.length === 0) {
            routeList.innerHTML = '<div class="p-4 text-center text-xs text-gray-400">Chargement...</div>';
            allRoutes = await api.getRoutes();
            renderRouteList();
        }
    }

    function closeRouteSelector() {
        routeSelector.classList.add('translate-y-[120%]', 'opacity-0', 'invisible');
        routeSelector.classList.remove('translate-y-0', 'opacity-100');
    }

    function renderRouteList(query = '') {
        const filtered = allRoutes.filter(r => r.shortName.toLowerCase().includes(query.toLowerCase()) || (r.longName && r.longName.toLowerCase().includes(query.toLowerCase())));
        routeList.innerHTML = filtered.map(r => `
            <button class="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-100 btn-select-route" data-id="${r.id}">
                <div class="flex items-center gap-3">
                    <div class="px-2 py-0.5 rounded-md text-white font-bold text-xs" style="background-color: #${r.color || '0055A4'}">${r.shortName}</div>
                    <div class="text-xs truncate max-w-[180px]">${r.longName || r.shortName}</div>
                </div>
            </button>
        `).join('');
        routeList.querySelectorAll('.btn-select-route').forEach(btn => btn.addEventListener('click', () => selectRoute(btn.dataset.id)));
    }

    async function selectRoute(routeId) {
        const route = allRoutes.find(r => r.id === routeId);
        if (!route) return;
        closeRouteSelector();
        document.getElementById('active-route-badge').innerText = route.shortName;
        document.getElementById('active-route-badge').style.backgroundColor = '#' + (route.color || '0055A4');
        document.getElementById('active-route-name').innerText = route.longName || route.shortName;
        activeRouteInfo.classList.remove('hidden');
        const trace = await api.getRouteTrace(routeId);
        if (trace) mapManager.drawRouteTrace(trace, route.color);
    }

    function clearRouteSelection() { mapManager.clearRouteTrace(); activeRouteInfo.classList.add('hidden'); }

    /* --- INIT --- */
    async function init() {
        applyTheme(getPreferredTheme());
        renderFavorites();
        await loadStops();
        fetchTraficInfo();
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
        
        searchInput.addEventListener('input', handleSearch);
        document.addEventListener('click', (e) => { if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) hideSearchResults(); });
        
        btnMap.addEventListener('click', openLiveMap);
        btnCloseMap.addEventListener('click', () => mapManager.closeMap());
        btnAroundMe.addEventListener('click', handleAroundMe);
        btnCloseDashboard.addEventListener('click', hideStopDashboard);
        if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
        
        btnOpenRouteSelector.addEventListener('click', openRouteSelector);
        btnCloseRouteSelector.addEventListener('click', closeRouteSelector);
        routeFilterInput.addEventListener('input', (e) => renderRouteList(e.target.value));
        btnClearRoute.addEventListener('click', clearRouteSelection);
        if (themeMediaQuery.addEventListener) {
            themeMediaQuery.addEventListener('change', handleSystemThemeChange);
        } else if (themeMediaQuery.addListener) {
            themeMediaQuery.addListener(handleSystemThemeChange);
        }
        
        lucide.createIcons();
    }

    init();
});
