/**
 * Module API - Communication Backend
 */

const API_BASE_URL = '/api';

const api = {
    /**
     * Récupérer les prochains passages temps réel (Phase 1)
     */
    async getHoraires(stopId) {
        try {
            const res = await fetch(`${API_BASE_URL}/horaires/${stopId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            return data.data || [];
        } catch (e) {
            console.error("Erreur API getHoraires:", e);
            return [];
        }
    },

    /**
     * Récupérer les horaires agrégés d'une station (tous quais confondus)
     */
    async getHorairesStation(stationId) {
        try {
            const res = await fetch(`${API_BASE_URL}/horaires-station/${stationId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            return data;
        } catch (e) {
            console.error("Erreur API getHorairesStation:", e);
            return { data: [], staticRoutes: [] };
        }
    },

    /**
     * Récupérer les véhicules en circulation (Phase 1 & 3)
     */
    async getVehicules() {
        try {
            const res = await fetch(`${API_BASE_URL}/vehicules`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            return data.data || [];
        } catch (e) {
            console.error("Erreur API getVehicules:", e);
            return [];
        }
    },

    /**
     * Récupérer les alertes trafic (Phase 4)
     */
    async getAlertes() {
        try {
            const res = await fetch(`${API_BASE_URL}/alertes`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            return data.data || [];
        } catch (e) {
            console.error("Erreur API getAlertes:", e);
            return [];
        }
    },

    /**
     * Récupérer la liste de toutes les lignes (Phase 3+)
     */
    async getRoutes() {
        try {
            const res = await fetch(`${API_BASE_URL}/routes`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error("Erreur API getRoutes:", e);
            return [];
        }
    },

    /**
     * Récupérer le tracé et les arrêts d'une ligne
     */
    async getRouteTrace(routeId) {
        try {
            const res = await fetch(`${API_BASE_URL}/route-trace/${routeId}`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error("Erreur API getRouteTrace:", e);
            return null;
        }
    }
};
