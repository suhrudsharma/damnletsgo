const app = {
    // ================= CONFIG =================
    TSP_THRESHOLD: 9,

    speeds: {
        walk: 5,
        cycle: 15,
        bike: 30,
        car: 25
    },

    // ================= STATE =================
    map: null,
    currentMode: 'walk',
    venues: [],
    userSelection: [],
    routingControl: null,
    currentTotalDistance: 0,
    lastRoutePath: null,

    icons: {
        default: new L.Icon.Default(),
        selected: new L.Icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        }),
        start: new L.Icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        })
    },

    // ================= INIT =================
    init() {
        this.map = L.map('map', { zoomControl: false })
            .setView([17.3850, 78.4867], 16);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(this.map);

        // Allow user to add points anywhere
        this.map.on('click', (e) => {
            this.addTempPoint(e.latlng);
        });

        console.log('DamnLetsGo – Global OSRM Mode Ready');
    },

    // ================= POINT HANDLING =================
    addTempPoint(latlng) {
        const id = Date.now();

        const marker = L.marker(latlng).addTo(this.map);
        marker.on('click', () => this.toggleSelection(id));

        const venue = {
            id,
            lat: latlng.lat,
            lng: latlng.lng,
            name: `Point ${this.venues.length + 1}`,
            marker
        };

        this.venues.push(venue);
        this.toggleSelection(id);
    },

    toggleSelection(id) {
        const venue = this.venues.find(v => v.id === id);
        if (!venue) return;

        const index = this.userSelection.indexOf(venue);

        if (index === -1) {
            this.userSelection.push(venue);
            venue.marker.setIcon(this.icons.selected);
        } else {
            this.userSelection.splice(index, 1);
            venue.marker.setIcon(this.icons.default);
        }

        if (this.userSelection.length > 0) {
            this.userSelection[0].marker.setIcon(this.icons.start);
            for (let i = 1; i < this.userSelection.length; i++) {
                this.userSelection[i].marker.setIcon(this.icons.selected);
            }
        }

        this.updateUI();
    },

    clearSelection() {
        this.userSelection.forEach(v => v.marker.setIcon(this.icons.default));
        this.userSelection = [];
        this.lastRoutePath = null;
        this.clearRoute();
        this.updateUI();
    },

    // ================= ROUTING =================
    calculateRoute() {
        if (this.userSelection.length < 2) {
            this.showToast('Select at least 2 locations');
            return;
        }

        const start = this.userSelection[0];
        const others = this.userSelection.slice(1);
        let ordered;

        if (this.userSelection.length <= this.TSP_THRESHOLD) {
            ordered = [start, ...this.solveTSPBruteForce(start, others)];
        } else {
            ordered = this.solveTSPHeuristic(start, others);
        }

        this.lastRoutePath = ordered;
        this.drawRoadRoute(ordered);
    },

    getOSRMProfile() {
        if (this.currentMode === 'walk') return 'foot';
        if (this.currentMode === 'cycle') return 'bike';
        return 'driving';
    },

    drawRoadRoute(path) {
        this.clearRoute();

        const waypoints = path.map(v => L.latLng(v.lat, v.lng));

        this.routingControl = L.Routing.control({
            waypoints,
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1',
                profile: this.getOSRMProfile()
            }),
            createMarker: () => null,
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: false,
            show: false,
            lineOptions: {
                styles: [{ color: '#2563eb', weight: 6, opacity: 0.85 }]
            }
        }).addTo(this.map);

        this.routingControl.on('routesfound', e => {
            const summary = e.routes[0].summary;
            this.currentTotalDistance = summary.totalDistance;
            this.updateTimeAndDistance();
            document.getElementById('results-area').classList.remove('hidden');
        });

        this.routingControl.on('routingerror', () => {
            this.clearRoute();
            this.showToast('Routing failed. Check connection.');
        });
    },

    clearRoute() {
        if (this.routingControl) {
            this.map.removeControl(this.routingControl);
            this.routingControl = null;
        }
        document.getElementById('results-area').classList.add('hidden');
    },

    // ================= MODE =================
    setTravelMode(mode, btn) {
        this.currentMode = mode;
        document.querySelectorAll('.t-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (this.lastRoutePath) {
            this.drawRoadRoute(this.lastRoutePath);
        } else {
            this.updateTimeAndDistance();
        }
    },

    // ================= ALGORITHMS =================
    solveTSPBruteForce(start, others) {
        const perms = this.getPermutations(others);
        let min = Infinity, best = [];
        perms.forEach(p => {
            let d = 0, cur = start;
            p.forEach(n => {
                d += this.getDirectDist(cur, n);
                cur = n;
            });
            if (d < min) { min = d; best = p; }
        });
        return best;
    },

    solveTSPHeuristic(start, others) {
        let unvisited = [...others];
        let path = [start];
        let current = start;
        while (unvisited.length) {
            let idx = 0, min = Infinity;
            unvisited.forEach((n, i) => {
                const d = this.getDirectDist(current, n);
                if (d < min) { min = d; idx = i; }
            });
            current = unvisited[idx];
            path.push(current);
            unvisited.splice(idx, 1);
        }
        return path;
    },

    getPermutations(arr) {
        if (arr.length <= 1) return [arr];
        return arr.flatMap((v, i) =>
            this.getPermutations(arr.filter((_, j) => j !== i)).map(p => [v, ...p])
        );
    },

    getDirectDist(p1, p2) {
        const R = 6371e3;
        const rad = Math.PI / 180;
        const dLat = (p2.lat - p1.lat) * rad;
        const dLon = (p2.lng - p1.lng) * rad;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(p1.lat * rad) * Math.cos(p2.lat * rad) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    // ================= MAP CONTROLS =================
    panMap(x, y) {
        this.map.panBy([x, y], { animate: true });
    },

    zoomMap(delta) {
        this.map.setZoom(this.map.getZoom() + delta);
    },

    resetView() {
        if (this.userSelection.length > 0) {
            const group = new L.featureGroup(this.userSelection.map(v => v.marker));
            this.map.fitBounds(group.getBounds(), { padding: [50, 50] });
        }
    },

    // ================= UI =================
    updateTimeAndDistance() {
        if (!this.currentTotalDistance) return;
        const km = this.currentTotalDistance / 1000;
        const mins = Math.ceil((km / this.speeds[this.currentMode]) * 60);
        document.getElementById('dist-val').innerText =
            km > 1 ? km.toFixed(2) + ' km' : Math.round(this.currentTotalDistance) + ' m';
        document.getElementById('time-val').innerText = mins + ' min';
    },

    updateUI() {
        document.getElementById('selection-status').innerText =
            this.userSelection.length
                ? `${this.userSelection.length} places selected`
                : 'Tap map to select locations';
    },

    showToast(msg) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.style.opacity = '1';
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t.style.opacity = '0', 2500);
    }
};

window.onload = () => app.init();
