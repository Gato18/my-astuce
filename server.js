const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Fonction de normalisation pour la déduplication (identique au frontend)
function normalizeName(str) {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Supprimer accents
        .replace(/[^a-z0-9]/g, ' ') // Supprimer ponctuation (Correction typo 0-h -> 0-9)
        .replace(/\s+/g, ' ') // Espaces uniques
        .trim();
}
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration des middlewares
// Le CORS est nécessaire pour que le frontend (si lancé séparément plus tard) puisse interroger l'API
app.use(cors());

// Dossier pour les fichiers statiques (Frontend - Phase 2)
app.use(express.static('public'));

// Sources OFFICIELLES Rouen Normandie (API Cityway pour Transdev)
const URLS = {
    horaires: 'https://api.mrn.cityway.fr/dataflow/horaire-tc-tr/download?provider=TCAR&dataFormat=gtfs-rt',
    vehicules: 'https://api.mrn.cityway.fr/dataflow/vehicle-tc-tr/download?provider=TCAR&dataFormat=gtfs-rt',
    alertes: 'https://api.mrn.cityway.fr/dataflow/info-transport/download?provider=ASTUCE&dataFormat=gtfs-rt'
};

// --- CACHE IN-MEMORY ---
// Stockage global des données pour répondre instantanément aux clients web
let cache = {
    vehicules: [],
    passages: [],
    alertes: [],
    routes: {},           // route_id -> { shortName, color, routeType }
    trips: {},            // trip_id -> { routeId, headsign, directionId }
    stationChildren: {},  // parent_station_id -> [child_stop_id, ...]
    stopToParent: {},     // child_stop_id -> parent_station_id
    stopsByName: {},      // stop_name -> [stop_id, ...]
    stopNames: {},        // stop_id -> stop_name
    shapes: {},           // shape_id -> [{lat, lon}]
    routeShapes: {},      // route_id -> Set(shape_id)
    routeStops: {},       // route_id -> Set(stop_id)
    lastUpdate: 0
};

// --- CHARGEMENT DES REFERENTIELS GTFS STATIQUES ---
function loadGtfsStatic() {
    console.log("📂 Chargement des référentiels GTFS statiques en mémoire...");
    try {
        // Parseur CSV basique (gestion des guillemets)
        function parseCSV(line) {
            let result = [], cur = '', inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '"') inQuotes = !inQuotes;
                else if (c === ',' && !inQuotes) { result.push(cur); cur = ''; }
                else cur += c;
            }
            result.push(cur);
            return result;
        }

        function getHeaderMapping(headerLine) {
            if (!headerLine) return {};
            const parts = parseCSV(headerLine.trim());
            const mapping = {};
            parts.forEach((p, i) => mapping[p.replace(/"/g, '').trim()] = i);
            return mapping;
        }

        // 1. routes.txt
        const routesPath = path.join(__dirname, 'public', 'data', 'gtfs', 'routes.txt');
        if (fs.existsSync(routesPath)) {
            const lines = fs.readFileSync(routesPath, 'utf8').split('\n');
            const map = getHeaderMapping(lines[0]);
            let count = 0;
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const parts = parseCSV(lines[i].trim());
                const id = parts[map.route_id]?.replace(/"/g, '');
                if (id) {
                    cache.routes[id] = {
                        shortName: parts[map.route_short_name]?.replace(/"/g, '') || '',
                        routeType: parseInt(parts[map.route_type]) || 3,
                        color: parts[map.route_color]?.replace(/"/g, '') || '0055A4'
                    };
                    count++;
                }
            }
            console.log(`✅ ${count} Lignes (routes.txt) chargées.`);
        }

        // 2. trips.txt
        const tripsPath = path.join(__dirname, 'public', 'data', 'gtfs', 'trips.txt');
        if (fs.existsSync(tripsPath)) {
            const lines = fs.readFileSync(tripsPath, 'utf8').split('\n');
            const map = getHeaderMapping(lines[0]);
            let count = 0;
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const parts = parseCSV(lines[i].trim());
                const tripId = parts[map.trip_id]?.replace(/"/g, '');
                if (tripId) {
                    const rId = parts[map.route_id]?.replace(/"/g, '');
                    const shapeId = parts[map.shape_id]?.replace(/"/g, '');
                    
                    cache.trips[tripId] = {
                        routeId: rId,
                        headsign: parts[map.trip_headsign]?.replace(/"/g, '') || '',
                        directionId: parts[map.direction_id]?.replace(/"/g, '') || '0',
                        shapeId: shapeId
                    };

                    if (shapeId && rId) {
                        if (!cache.routeShapes[rId]) cache.routeShapes[rId] = new Set();
                        cache.routeShapes[rId].add(shapeId);
                    }
                    count++;
                }
            }
            console.log(`✅ ${count} Voyages (trips.txt) chargés.`);
        }

        // 3. shapes.txt
        const shapesPath = path.join(__dirname, 'public', 'data', 'gtfs', 'shapes.txt');
        if (fs.existsSync(shapesPath)) {
            const lines = fs.readFileSync(shapesPath, 'utf8').split('\n');
            const map = getHeaderMapping(lines[0]);
            let ptCount = 0;
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const parts = parseCSV(lines[i].trim());
                const sid = parts[map.shape_id]?.replace(/"/g, '');
                if (sid) {
                    if (!cache.shapes[sid]) cache.shapes[sid] = [];
                    cache.shapes[sid].push({
                        lat: parseFloat(parts[map.shape_pt_lat]),
                        lon: parseFloat(parts[map.shape_pt_lon]),
                        seq: parseInt(parts[map.shape_pt_sequence])
                    });
                    ptCount++;
                }
            }
            // Trier chaque shape par sequence
            Object.keys(cache.shapes).forEach(sid => {
                cache.shapes[sid].sort((a,b) => a.seq - b.seq);
            });
            console.log(`✅ ${ptCount} points de tracé (shapes.txt) chargés.`);
        }

        // 4. stop_times.txt (Optimisé : on ne prend qu'un trip par route pour avoir les arrêts)
        const stopTimesPath = path.join(__dirname, 'public', 'data', 'gtfs', 'stop_times.txt');
        if (fs.existsSync(stopTimesPath)) {
            const lines = fs.readFileSync(stopTimesPath, 'utf8').split('\n');
            const map = getHeaderMapping(lines[0]);
            let count = 0;
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const parts = parseCSV(lines[i].trim());
                const tripId = parts[map.trip_id]?.replace(/"/g, '');
                const stopId = parts[map.stop_id]?.replace(/"/g, '');
                const trip = cache.trips[tripId];
                if (trip && stopId) {
                    const rId = trip.routeId;
                    if (!cache.routeStops[rId]) cache.routeStops[rId] = new Set();
                    cache.routeStops[rId].add(stopId);
                    count++;
                }
            }
            console.log(`✅ Relation arrets/lignes chargée.`);
        }

        // 5. stops.txt - charger la hiérarchie station -> quais
        const stopsPath = path.join(__dirname, 'public', 'data', 'gtfs', 'stops.txt');
        if (fs.existsSync(stopsPath)) {
            const lines = fs.readFileSync(stopsPath, 'utf8').split('\n');
            const map = getHeaderMapping(lines[0]);
            let stationCount = 0;
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const parts = parseCSV(lines[i].trim());
                // Format: stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,...
                const parentStation = (parts[map.parent_station] || '').replace(/"/g, '').trim();
                const stopId = (parts[map.stop_id] || '').replace(/"/g, '').trim();
                const stopName = (parts[map.stop_name] || '').replace(/"/g, '').trim();
                const locationType = parseInt(parts[map.location_type]) || 0;

                if (stopName && stopId) {
                    const normalized = normalizeName(stopName);
                    if (!cache.stopsByName[normalized]) cache.stopsByName[normalized] = [];
                    if (!cache.stopsByName[normalized].includes(stopId)) {
                        cache.stopsByName[normalized].push(stopId);
                    }
                    cache.stopNames[stopId] = stopName;
                }

                if (parentStation && locationType === 0) {
                    if (!cache.stationChildren[parentStation]) {
                        cache.stationChildren[parentStation] = [];
                    }
                    cache.stationChildren[parentStation].push(stopId);
                    cache.stopToParent[stopId] = parentStation;
                    stationCount++;
                }
            }
            console.log(`✅ ${stationCount} quais rattachés aux stations.`);
        }
    } catch (e) {
        console.error("❌ Erreur au chargement des GTFS statiques :", e.message);
    }
}
loadGtfsStatic();


/**
 * Fonction de polling asynchrone pour télécharger et décoder les protobufs
 * Exécutée toutes les 15 secondes en arrière-plan.
 */
async function fetchAndCacheData() {
    try {
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 Rafraîchissement des données du réseau Astuce...`);

        // 1. Fetch Véhicules
        const resVehicules = await fetch(URLS.vehicules);
        if (resVehicules.ok) {
            const buffer = await resVehicules.arrayBuffer();
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
            
            const tmpVehicles = [];
            for (const entity of feed.entity) {
                if (entity.vehicle) {
                    tmpVehicles.push({
                        id: entity.id,
                        tripId: entity.vehicle.trip?.tripId,
                        routeId: entity.vehicle.trip?.routeId,
                        latitude: entity.vehicle.position?.latitude,
                        longitude: entity.vehicle.position?.longitude,
                        bearing: entity.vehicle.position?.bearing,
                        timestamp: entity.vehicle.timestamp?.toNumber()
                    });
                }
            }
            cache.vehicules = tmpVehicles;
        }

        // 2. Fetch Horaires (TripUpdates)
        const resHoraires = await fetch(URLS.horaires);
        if (resHoraires.ok) {
            const buffer = await resHoraires.arrayBuffer();
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
            
            const tmpPassages = [];
            for (const entity of feed.entity) {
                if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate) {
                    for (const stopTimeUpdate of entity.tripUpdate.stopTimeUpdate) {
                        let arrivalTime = null;
                        let departureTime = null;
                        let delaySec = null;
                        try {
                            if (stopTimeUpdate.arrival?.time) arrivalTime = stopTimeUpdate.arrival.time.toNumber();
                            if (stopTimeUpdate.departure?.time) departureTime = stopTimeUpdate.departure.time.toNumber();
                            if (stopTimeUpdate.arrival?.delay !== undefined) delaySec = stopTimeUpdate.arrival.delay;
                        } catch(e) {}

                        tmpPassages.push({
                            tripId: entity.tripUpdate.trip?.tripId || 'Inconnu',
                            routeId: entity.tripUpdate.trip?.routeId || 'Inconnu',
                            stopId: stopTimeUpdate.stopId, // On stocke en string pour la correspondance JS
                            arrival: arrivalTime,
                            departure: departureTime,
                            delay: delaySec
                        });
                    }
                }
            }
            cache.passages = tmpPassages;
        }

        // 3. Fetch Alertes
        const resAlertes = await fetch(URLS.alertes);
        if (resAlertes.ok) {
            const buffer = await resAlertes.arrayBuffer();
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
            
            const tmpAlertes = [];
            for (const entity of feed.entity) {
                if (entity.alert) {
                    tmpAlertes.push({
                        id: entity.id,
                        cause: entity.alert.cause,
                        effect: entity.alert.effect,
                        header: entity.alert.headerText?.translation?.[0]?.text || "Alerte de service",
                        description: entity.alert.descriptionText?.translation?.[0]?.text || "",
                    });
                }
            }
            cache.alertes = tmpAlertes;
        }

        cache.lastUpdate = Date.now();
        console.log(`✅ Cache à jour : ${cache.vehicules.length} véhicules | ${cache.passages.length} passages futurs | ${cache.alertes.length} alertes`);

    } catch (error) {
        console.error("❌ Erreur critique lors du rafraîchissement global:", error.message);
    }
}

// Initialiser le système de cache et programmer la récurrence à 15 secondes
fetchAndCacheData();
setInterval(fetchAndCacheData, 15000);

// ============================================
// ROUTES API (Temps de réponse de l'ordre de ~1ms car lisent directement la RAM)
// ============================================

/**
 * Route GET /api/vehicules
 */
app.get('/api/vehicules', (req, res) => {
    res.json({
        status: 'success',
        timestamp: cache.lastUpdate,
        count: cache.vehicules.length,
        data: cache.vehicules
    });
});

/**
 * Route GET /api/horaires/:stopId
 */
app.get('/api/horaires/:stopId', (req, res) => {
    const stopId = String(req.params.stopId);
    
    // Filtrage très rapide en mémoire pour isoler un seul arrêt
    const arretsFiltres = cache.passages.filter(p => p.stopId === stopId);
    
    // Tri et nettoyage comme avant
    arretsFiltres.sort((a, b) => (a.arrival || Infinity) - (b.arrival || Infinity));
    const currentUnixTime = Math.floor(Date.now() / 1000);
    const prochainsPassages = arretsFiltres.filter(p => !p.arrival || p.arrival > currentUnixTime).slice(0, 10);
    
    // On enrichit chaque passage avec les données statiques
    const enrichedPassages = prochainsPassages.map(p => {
        const tripInfo = cache.trips[p.tripId];
        // Certains passages RT n'ont pas de routeId, on essaie de le déduire du trip
        const rId = p.routeId && p.routeId !== 'Inconnu' ? p.routeId : (tripInfo ? tripInfo.routeId : 'Inconnu');
        const routeInfo = cache.routes[rId];

        return {
            ...p,
            routeName: routeInfo ? routeInfo.shortName : (rId !== 'Inconnu' ? rId : 'BUS'),
            routeColor: routeInfo ? routeInfo.color : 'cccccc',
            direction: tripInfo ? tripInfo.headsign : 'Terminus',
            directionId: tripInfo ? tripInfo.directionId : '0'
        };
    });

    // Regroupement par Ligne + Direction (Sens)
    const grouped = {};
    enrichedPassages.forEach(p => {
        const key = `${p.routeName}-${p.direction}`;
        if (!grouped[key]) {
            grouped[key] = {
                routeId: p.routeId !== 'Inconnu' ? p.routeId : '',
                routeName: p.routeName,
                routeColor: p.routeColor,
                direction: p.direction,
                directionId: p.directionId,
                passages: []
            };
        }
        // Limiter à 3 passages maximum par sens
        if (grouped[key].passages.length < 3) {
            grouped[key].passages.push({
                arrival: p.arrival,
                delay: p.delay,
                tripId: p.tripId
            });
        }
    });
    
    // Convertir en tableau
    const finalData = Object.values(grouped);

    res.json({
        status: 'success',
        stopId: stopId,
        timestamp: cache.lastUpdate,
        count: finalData.length,
        data: finalData
    });
});

/**
 * Route GET /api/horaires-station/:stationId
 * Agrège les passages de TOUS les quais enfants d'une station
 */
app.get('/api/horaires-station/:stationId', (req, res) => {
    const stationId = String(req.params.stationId);
    
    // 1. Récupérer les enfants explicites (parent_station dans GTFS)
    const explicitChildren = cache.stationChildren[stationId] || [];
    
    // 2. Récupérer les IDs par NOM NORMALISÉ (pour les arrêts mal liés dans GTFS)
    const stopName = cache.stopNames[stationId];
    const normalized = normalizeName(stopName);
    const nameSiblings = normalized ? (cache.stopsByName[normalized] || []) : [];
    
    // Union de tous les IDs possibles pour cette station
    const allStopIds = Array.from(new Set([stationId, ...explicitChildren, ...nameSiblings]));
    
    // Filtrer tous les passages pour ces arrêts
    const currentUnixTime = Math.floor(Date.now() / 1000);
    const allPassages = cache.passages
        .filter(p => allStopIds.includes(p.stopId) && p.arrival && p.arrival > currentUnixTime)
        .sort((a, b) => a.arrival - b.arrival);
    
    // Enrichir avec les données statiques
    const enriched = allPassages.map(p => {
        const tripInfo = cache.trips[p.tripId];
        const rId = p.routeId && p.routeId !== 'Inconnu' ? p.routeId : (tripInfo ? tripInfo.routeId : 'Inconnu');
        const routeInfo = cache.routes[rId];
        
        // Détermination du type de véhicule
        const routeType = routeInfo ? routeInfo.routeType : 3;
        const shortName = routeInfo ? routeInfo.shortName : '';
        let vehicleType = 'bus';
        if (routeType === 1) vehicleType = 'metro';
        else if (routeType === 4) vehicleType = 'ferry';
        else if (/^T\d/.test(shortName)) vehicleType = 'teor';
        else if (/^F\d/.test(shortName)) vehicleType = 'fast';
        else if (shortName === 'Noctambus') vehicleType = 'noctambus';
        
        return {
            ...p,
            routeName: routeInfo ? routeInfo.shortName : 'BUS',
            routeColor: routeInfo ? routeInfo.color : 'cccccc',
            routeType: vehicleType,
            direction: tripInfo ? tripInfo.headsign : 'Terminus',
            directionId: tripInfo ? tripInfo.directionId : '0'
        };
    });
    
    // Regroupement par Ligne + Direction
    const grouped = {};
    enriched.forEach(p => {
        const key = `${p.routeName}-${p.direction}`;
        if (!grouped[key]) {
            grouped[key] = {
                routeId: p.routeId !== 'Inconnu' ? p.routeId : '',
                routeName: p.routeName,
                routeColor: p.routeColor,
                routeType: p.routeType,
                direction: p.direction,
                directionId: p.directionId,
                passages: []
            };
        }
        if (grouped[key].passages.length < 3) {
            grouped[key].passages.push({
                arrival: p.arrival,
                delay: p.delay,
                tripId: p.tripId
            });
        }
    });
    
    const finalData = Object.values(grouped);
    
    // NOUVEAU : Récupérer aussi les lignes statiques qui desservent cet arrêt
    const staticRouteIds = new Set();
    allStopIds.forEach(sid => {
        Object.keys(cache.routeStops).forEach(rid => {
            if (cache.routeStops[rid].has(sid)) staticRouteIds.add(rid);
        });
    });
    const staticRoutes = Array.from(staticRouteIds).map(rid => {
        const rInfo = cache.routes[rid];
        return {
            id: rid,
            shortName: rInfo ? rInfo.shortName : rid,
            color: rInfo ? rInfo.color : 'cccccc',
            type: rInfo ? rInfo.routeType : 3
        };
    }).sort((a,b) => a.shortName.localeCompare(b.shortName, undefined, {numeric:true}));

    res.json({
        status: 'success',
        stationId: stationId,
        stopName: stopName,
        allStopIds: allStopIds,
        timestamp: cache.lastUpdate,
        count: finalData.length,
        data: finalData,
        staticRoutes: staticRoutes
    });
});

/**
 * Route GET /api/routes
 * Liste toutes les lignes disponibles
 */
app.get('/api/routes', (req, res) => {
    const list = Object.keys(cache.routes).map(id => ({
        id,
        ...cache.routes[id]
    })).sort((a, b) => a.shortName.localeCompare(b.shortName, undefined, {numeric: true}));
    res.json(list);
});

/**
 * Route GET /api/route-trace/:routeId
 * Retourne le tracé (tous les shapes combinés) et les arrêts d'une ligne
 */
app.get('/api/route-trace/:routeId', (req, res) => {
    const rId = req.params.routeId;
    const shapeIds = cache.routeShapes[rId] ? Array.from(cache.routeShapes[rId]) : [];
    
    // Dédoublonnage des tracés (shapes) physiques pour éviter les lignes "doublées" sur la carte
    const uniqueShapes = [];
    const seenShapes = new Set();

    shapeIds.forEach(sid => {
        const points = cache.shapes[sid] || [];
        if (points.length === 0) return;
        
        // On crée une signature simple basée sur le premier, le milieu et le dernier point
        // pour détecter les tracés identiques sans comparer chaque point (perf)
        const mid = Math.floor(points.length / 2);
        const signature = `${points[0].lat},${points[0].lon}|${points[mid].lat},${points[mid].lon}|${points[points.length-1].lat},${points[points.length-1].lon}|${points.length}`;
        
        if (!seenShapes.has(signature)) {
            seenShapes.add(signature);
            uniqueShapes.push({
                id: sid,
                points: points
            });
        }
    });

    const stopIds = cache.routeStops[rId] ? Array.from(cache.routeStops[rId]) : [];
    
    // On ajoute aussi les IDs parents pour faciliter le filtrage sur la carte
    const parentIds = new Set();
    stopIds.forEach(id => {
        if (cache.stopToParent[id]) parentIds.add(cache.stopToParent[id]);
        else parentIds.add(id); // Si pas de parent, c'est peut-être déjà l'ID principal
    });

    res.json({
        routeId: rId,
        shapes: uniqueShapes,
        stopIds: stopIds,
        parentIds: Array.from(parentIds)
    });
});

/**
 * Route GET /api/alertes
 */
app.get('/api/alertes', (req, res) => {
    res.json({
        status: 'success',
        timestamp: cache.lastUpdate,
        count: cache.alertes.length,
        data: cache.alertes
    });
});

// Lancement du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur Astuce Tracker démarré sur http://localhost:${PORT}`);
    console.log(`⚡ Mécanisme d'ingestion en mémoire : Actif (Refresh=15s)`);
});
