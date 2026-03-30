/**
 * Module Favorites - Gestion LocalStorage
 */

const STORAGE_KEY = 'astuce_favorites';

const favoritesManager = {
    getFavorites() {
        try {
            const val = localStorage.getItem(STORAGE_KEY);
            return val ? JSON.parse(val) : [];
        } catch(e) {
            console.error("Erreur locale storage parsing", e);
            return [];
        }
    },

    saveFavorites(favs) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
    },

    addFavorite(favObj) {
        // favObj: { id: "stopId_routeId_directionId", stop: {id, name, description, latitude, longitude}, routeName, routeColor, direction }
        const favs = this.getFavorites();
        if (!favs.some(f => f.id === favObj.id)) {
            favs.push(favObj);
            this.saveFavorites(favs);
        }
    },

    removeFavorite(id) {
        let favs = this.getFavorites();
        favs = favs.filter(f => f.id !== id);
        this.saveFavorites(favs);
    },

    isFavorite(id) {
        return this.getFavorites().some(f => f.id === id);
    }
};
