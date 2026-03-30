/**
 * map.js - Gestion de la carte Leaflet avec clustering des arrêts
 */

const mapManager = {
    map: null,
    clusterGroup: null,  // MarkerClusterGroup pour les arrêts
    routeLayers: L.layerGroup(), // Calque pour les tracés de ligne et arrêts filtrés
    allMarkers: {},      // stopId -> marker (pour filtrage)
    userMarker: null,
    isInitialized: false,
    onStopClick: null,   // Callback défini par app.js

    init() {
        if (this.isInitialized) return;

        // Centre sur Rouen
        this.map = L.map('map-container', { zoomControl: true }).setView([49.4431, 1.0993], 13);

        // Fond de carte CartoDB (plus propre visuellement)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 19
        }).addTo(this.map);

        // Cluster group pour les arrêts
        this.clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 40,
            disableClusteringAtZoom: 16,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            iconCreateFunction(cluster) {
                const count = cluster.getChildCount();
                return L.divIcon({
                    className: 'custom-cluster',
                    html: `<div style="
                        background: #0055A4;
                        color: white;
                        border-radius: 50%;
                        width: 36px;
                        height: 36px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: 700;
                        font-size: 13px;
                        border: 3px solid white;
                        box-shadow: 0 2px 8px rgba(0,85,164,0.4);
                    ">${count}</div>`,
                    iconSize: [36, 36],
                    iconAnchor: [18, 18]
                });
            }
        });
        this.map.addLayer(this.clusterGroup);
        this.routeLayers.addTo(this.map);

        // Gérer les clics sur les boutons "Voir tous les horaires" dans les popups
        this.map.on('popupopen', (e) => {
            const popupNode = e.popup.getElement();
            const btn = popupNode.querySelector('[id^="popup-open-"]');
            if (btn) {
                btn.addEventListener('click', () => {
                    const stopId = btn.id.replace('popup-open-', '');
                    this.map.closePopup();
                    if (this.onStopClick) this.onStopClick(stopId);
                });
            }
        });

        // Arrêter le rafraîchissement des horaires quand on ferme un popup
        this.map.on('popupclose', () => {
            if (this.popupInterval) {
                clearInterval(this.popupInterval);
                this.popupInterval = null;
            }
        });

        this.isInitialized = true;
    },

    openMap() {
        const mapView = document.getElementById('map-view');
        mapView.classList.remove('translate-y-full');
        if (!this.isInitialized) this.init();
        setTimeout(() => this.map.invalidateSize(), 500);
    },

    closeMap() {
        document.getElementById('map-view').classList.add('translate-y-full');
    },

    clearStops() {
        if (this.clusterGroup) this.clusterGroup.clearLayers();
    },

    /**
     * Ajoute tous les arrêts sur la carte avec clustering
     * @param {Array} stops - tableau d'objets stop {id, name, latitude, longitude}
     * @param {Function} onClickStop - callback(stop) quand un arrêt est cliqué
     */
    addAllStops(stops, onClickStop) {
        this.clearStops();
        this.allMarkers = {};
        this.onStopClick = onClickStop;

        stops.forEach(stop => {
            if (!stop.latitude || !stop.longitude || isNaN(stop.latitude)) return;

            // Icône arrêt personnalisée
            const icon = L.divIcon({
                className: 'stop-icon',
                html: `<div style="
                    background: white;
                    border: 2.5px solid #0055A4;
                    border-radius: 50%;
                    width: 14px;
                    height: 14px;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
                    transition: transform 0.15s;
                "></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            const marker = L.marker([stop.latitude, stop.longitude], { icon });

            marker.on('click', (e) => {
                // Ouvrir un popup chargé dynamiquement
                L.DomEvent.stopPropagation(e);
                this._openStopPopup(marker, stop, onClickStop);
            });

            this.allMarkers[stop.id] = marker;
            this.clusterGroup.addLayer(marker);
        });
    },

    /**
     * Dessine le tracé d'une ligne et filtre les arrêts
     */
    drawRouteTrace(routeData, color) {
        this.clearRouteTrace();
        
        // 1. Dessiner les polylines
        routeData.shapes.forEach(shape => {
            if (!shape.points || shape.points.length === 0) return;
            const latlngs = shape.points.map(p => [p.lat, p.lon]);
            const polyline = L.polyline(latlngs, {
                color: '#' + (color || '0055A4'),
                weight: 5,
                opacity: 0.8,
                lineJoin: 'round'
            }).addTo(this.routeLayers);
            
            // Zoomer sur le tracé
            this.map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
        });

        // 2. Filtrer les arrêts : n'afficher que ceux de la ligne (en utilisant les IDs parents)
        const parentIds = routeData.parentIds || [];
        // On retire tout du clusterGroup
        this.clusterGroup.clearLayers();

        // On ne rajoute que les marqueurs correspondant aux IDs parents de la ligne
        parentIds.forEach(id => {
            const marker = this.allMarkers[id];
            if (marker) {
                this.clusterGroup.addLayer(marker);
            }
        });
    },

    /**
     * Efface le tracé et remet tous les arrêts
     */
    clearRouteTrace() {
        this.routeLayers.clearLayers();
        // Remettre tous les arrêts
        this.clusterGroup.clearLayers();
        Object.values(this.allMarkers).forEach(m => {
            this.clusterGroup.addLayer(m);
        });
    },

    /**
     * Ouvre un popup sur l'arrêt avec les prochains passages chargés depuis l'API
     */
    _openStopPopup(marker, stop, onClickStop) {
        const popup = L.popup({ maxWidth: 280, className: 'stop-popup' })
            .setLatLng(marker.getLatLng())
            .setContent(`
                <div style="font-family: Inter, sans-serif; min-width: 220px;">
                    <div style="font-weight: 700; font-size: 15px; color: #111; margin-bottom: 2px;">${stop.name}</div>
                    <div style="font-size: 11px; color: #888; margin-bottom: 10px;">${stop.description || ''}</div>
                    <div id="popup-content-${stop.id}" style="color:#555; font-size:12px;">
                        <div style="display:flex; align-items:center; gap:6px; color:#aaa;">
                            <div style="width:12px;height:12px;border-radius:50%;border:2px solid #aaa;"></div>
                            Chargement des passages...
                        </div>
                    </div>
                    <button id="popup-open-${stop.id}" style="
                        margin-top: 12px;
                        width: 100%;
                        padding: 8px;
                        background: #0055A4;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-weight: 600;
                        font-size: 13px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                    ">Voir tous les horaires →</button>
                </div>
            `)
            .openOn(this.map);

        // Fonction pour charger et mettre à jour les horaires
        const loadPassages = () => {
            fetch(`/api/horaires-station/${stop.id}`)
                .then(r => r.json())
                .then(data => {
                    const contentDiv = document.getElementById(`popup-content-${stop.id}`);
                    if (!contentDiv) return;
                    
                    const groups = data.data || [];
                    const staticRoutes = data.staticRoutes || [];

                    if (groups.length === 0) {
                        if (staticRoutes.length > 0) {
                            let html = '<div style="font-size:11px; color:#888; margin-bottom:6px;">Lignes desservant cet arrêt :</div>';
                            html += '<div style="display:flex; flex-wrap:wrap; gap:4px;">';
                            staticRoutes.forEach(r => {
                                html += `<div style="background:#${r.color}; color:white; border-radius:4px; padding:2px 6px; font-weight:700; font-size:10px;">${r.shortName}</div>`;
                            });
                            html += '</div>';
                            contentDiv.innerHTML = html;
                        } else {
                            contentDiv.innerHTML = '<span style="color:#aaa; font-style:italic;">Aucun passage prévu</span>';
                        }
                        return;
                    }

                    const now = Math.floor(Date.now() / 1000);
                    let html = '';
                    groups.slice(0, 4).forEach(g => {
                        const nextPassage = g.passages[0];
                        if (!nextPassage) return;
                        const diff = nextPassage.arrival - now;
                        const mins = Math.floor(diff / 60);
                        const timeLabel = mins <= 0 ? '<span style="color:#E30613;font-weight:700;">Imm.</span>'
                            : mins < 2 ? `<span style="color:#E30613;font-weight:700;">${mins} min</span>`
                            : `<span style="font-weight:700;">${mins} min</span>`;
                        const timeStr = nextPassage.arrival ? new Date(nextPassage.arrival * 1000).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}) : '';
                        html += `
                            <div style="display:flex; align-items:center; gap:8px; padding: 4px 0; border-bottom: 1px solid #f0f0f0;">
                                <div style="
                                    background:#${g.routeColor || '0055A4'};
                                    color:white;
                                    border-radius:6px;
                                    padding: 2px 7px;
                                    font-weight:700;
                                    font-size:12px;
                                    white-space:nowrap;
                                    min-width:28px;
                                    text-align:center;
                                ">${g.routeName}</div>
                                <div style="flex:1; font-size:11px; color:#444; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${g.direction}">${g.direction}</div>
                                <div style="font-size:12px; text-align:right; white-space:nowrap;">${timeLabel}<br><span style="color:#aaa;font-size:10px;">${timeStr}</span></div>
                            </div>
                        `;
                    });
                    contentDiv.innerHTML = html;
                })
                .catch(() => {
                    const div = document.getElementById(`popup-content-${stop.id}`);
                    if (div) div.innerHTML = '<span style="color:#aaa;">Erreur de chargement</span>';
                });
        };

        // Charger immédiatement puis commencer le polling
        loadPassages();
        if (this.popupInterval) clearInterval(this.popupInterval);
        this.popupInterval = setInterval(loadPassages, 15000);
    },

    // --- Géolocalisation ---
    getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("La géolocalisation n'est pas supportée par votre navigateur."));
            } else {
                navigator.geolocation.getCurrentPosition(
                    position => {
                        const { latitude, longitude } = position.coords;
                        // Afficher un marqueur utilisateur
                        if (this.userMarker) this.map.removeLayer(this.userMarker);
                        this.userMarker = L.circleMarker([latitude, longitude], {
                            radius: 8,
                            fillColor: '#0055A4',
                            color: 'white',
                            weight: 2,
                            fillOpacity: 1
                        }).addTo(this.map);
                        this.map.setView([latitude, longitude], 15);
                        resolve({ lat: latitude, lon: longitude });
                    },
                    error => reject(error),
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                );
            }
        });
    },

    // Calcul de la distance de Haversine
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
};
