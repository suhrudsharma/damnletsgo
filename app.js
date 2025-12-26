let campusGraphData = null;
const VIT_CENTER = [12.9692, 79.1559];
const VIT_ZOOM = 17;

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
    campusRouteLayer: null,
    routingControl: null,
    currentTotalDistance: 0,
    lastRoutePath: null,
    toastTimer: null,
    isCampusMode: false,
    campusSnapLayers: [],

    // ================= ICONS =================
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

    // ================= CAMPUS GRAPH LOADER =================
    async loadCampusGraph() {
        const res = await fetch("./data/vit_campus_graph_v1.json");
        campusGraphData = await res.json();
        console.log(
            "Campus graph loaded:",
            Object.keys(campusGraphData).length,
            "nodes"
        );
    },

    validateCampusGraph() {
        for (const id in campusGraphData) {
            const n = campusGraphData[id];
            if (typeof n.lat !== "number" || typeof n.lng !== "number") {
                console.error("Invalid coordinates at node:", id);
                return false;
            }
            if (!n.adj || typeof n.adj !== "object") {
                console.error("Invalid adjacency at node:", id);
                return false;
            }
        }
        console.log("Campus graph validation OK");
        return true;
    },
    
    findNearestCampusNode(lat, lng) {
    let nearestId = null;
    let minDist = Infinity;

    for (const id in campusGraphData) {
        const n = campusGraphData[id];

        // Only allow ENTRY or POI as routing endpoints
        if (n.type !== "entry" && n.type !== "poi") continue;

        const d = this.getDirectDist(
            { lat, lng },
            { lat: n.lat, lng: n.lng }
        );

        if (d < minDist) {
            minDist = d;
            nearestId = id;
        }
    }

    return nearestId;
},
handleCampusClick(latlng) {
    const nearestNodeId = this.findNearestCampusNode(latlng.lat, latlng.lng);

    if (!nearestNodeId) {
        this.showToast("No nearby campus location");
        return;
    }

    const node = campusGraphData[nearestNodeId];

    // Draw snap line (raw click → snapped node)
    const snapLine = L.polyline(
        [
            [latlng.lat, latlng.lng],
            [node.lat, node.lng]
        ],
        {
            color: "#64748b",
            weight: 3,
            dashArray: "6,6",
            opacity: 0.8
        }
    ).addTo(this.map);

    this.campusSnapLayers.push(snapLine);

    // Marker at snapped node
    const marker = L.marker([node.lat, node.lng], {
        icon: this.icons.selected
    }).addTo(this.map);

    const venue = {
        id: Date.now(),
        rawLat: latlng.lat,
        rawLng: latlng.lng,
        lat: node.lat,
        lng: node.lng,
        snapTo: nearestNodeId,
        name: node.name || "Campus Point",
        marker
    };

    this.venues.push(venue);
    this.toggleSelection(venue.id);
},



findCampusShortestPath(startId, endId) {
    const distances = {};
    const previous = {};
    const visited = new Set();

    for (const id in campusGraphData) {
        distances[id] = Infinity;
        previous[id] = null;
    }

    distances[startId] = 0;

    while (true) {
        let current = null;
        let minDist = Infinity;

        for (const id in distances) {
            if (!visited.has(id) && distances[id] < minDist) {
                minDist = distances[id];
                current = id;
            }
        }

        if (current === null) break;
        if (current === endId) break;

        visited.add(current);

        for (const neighborId in campusGraphData[current].adj) {
            const weight = campusGraphData[current].adj[neighborId];
            const alt = distances[current] + weight;

            if (alt < distances[neighborId]) {
                distances[neighborId] = alt;
                previous[neighborId] = current;
            }
        }
    }

    const path = [];
    let cur = endId;

    while (cur) {
        path.unshift(cur);
        cur = previous[cur];
    }

    if (path[0] !== startId) {
        console.warn("No campus path found");
        return null;
    }

    return {
        path,
        distance: distances[endId]
    };
},

drawCampusRoute(pathResult) {
    // Safety
    if (!pathResult || !pathResult.path) return;

    // Clear old campus route if any
    if (this.campusRouteLayer) {
        this.map.removeLayer(this.campusRouteLayer);
        this.campusRouteLayer = null;
    }

    // Convert node IDs to LatLngs
    const latlngs = pathResult.path.map(id => {
        const n = campusGraphData[id];
        return [n.lat, n.lng];
    });

    // Draw polyline
    this.campusRouteLayer = L.polyline(latlngs, {
        color: '#16a34a',
        weight: 6,
        opacity: 0.9
    }).addTo(this.map);

    // Fit map to route
    this.map.fitBounds(this.campusRouteLayer.getBounds(), {
        padding: [40, 40]
    });

    // Save distance
    let snapDistance = 0;

this.userSelection.forEach(v => {
    if (v.rawLat !== undefined) {
        snapDistance += this.getDirectDist(
            { lat: v.rawLat, lng: v.rawLng },
            { lat: v.lat, lng: v.lng }
        );
    }
});

this.currentTotalDistance = pathResult.distance + snapDistance;

    this.updateTimeAndDistance();

    console.log("Campus route drawn");
},
testCampusRoute(startId, endId) {
    if (!this.isCampusMode) {
        console.warn("Not in campus mode");
        return;
    }

    const result = this.findCampusShortestPath(startId, endId);
    if (!result) {
        this.showToast("No campus path found");
        return;
    }

    this.drawCampusRoute(result);
},
enterCampusMode() {
    this.isCampusMode = true;
    this.clearSelection();
    this.clearRoute();

    // Move map to VIT campus
    this.map.setView(VIT_CENTER, VIT_ZOOM, { animate: true });

    this.showToast("Campus Mode: VIT Vellore");
    console.log("Entered Campus Mode");
},


exitCampusMode() {
    this.isCampusMode = false;
    this.clearSelection();
    this.clearRoute();

    // Clear snap segments
    this.campusSnapLayers.forEach(l => this.map.removeLayer(l));
    this.campusSnapLayers = [];

    this.showToast("Global Mode");
    console.log("Exited Campus Mode");
},



    // ================= INIT =================
    async init() {
        await this.loadCampusGraph();
        this.validateCampusGraph();

        this.map = L.map('map', { zoomControl: false })
            .setView([17.3850, 78.4867], 16);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(this.map);

        // Allow user to add points anywhere (GLOBAL MODE)
        this.map.on('click', (e) => {
    if (this.isCampusMode) {
        this.handleCampusClick(e.latlng);
        return;
    }
    this.addTempPoint(e.latlng);
    const campusBtn = document.getElementById("campusToggle");

campusBtn.addEventListener("click", () => {
    if (!this.isCampusMode) {
        this.enterCampusMode();
        campusBtn.classList.add("active");
        campusBtn.innerText = "Campus Mode: ON";
    } else {
        this.exitCampusMode();
        campusBtn.classList.remove("active");
        campusBtn.innerText = "Campus Mode: OFF";
    }
});

});



        console.log('Global OSRM Mode Ready');
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
        // Clear snap segments
this.campusSnapLayers.forEach(l => this.map.removeLayer(l));
this.campusSnapLayers = [];

        if (this.campusRouteLayer) {
            this.map.removeLayer(this.campusRouteLayer);
            this.campusRouteLayer = null;
        }
        this.userSelection.forEach(v => v.marker.setIcon(this.icons.default));
        this.userSelection = [];
        this.lastRoutePath = null;
        this.clearRoute();
        this.updateUI();
    },

    // ================= ROUTING (GLOBAL) =================
    calculateRoute() {
    // ===== CAMPUS MODE ROUTING =====
    if (this.isCampusMode) {
        if (this.userSelection.length < 2) {
            this.showToast("Select start and destination");
            return;
        }

        const startPoint = this.userSelection[0];
        const endPoint = this.userSelection[1];

        const startNode = this.findNearestCampusNode(startPoint.lat, startPoint.lng);
        const endNode = this.findNearestCampusNode(endPoint.lat, endPoint.lng);

        if (!startNode || !endNode) {
            this.showToast("Campus destination not reachable");
            return;
        }

        const result = this.findCampusShortestPath(startNode, endNode);

        if (!result) {
            this.showToast("No campus path found");
            return;
        }

        this.drawCampusRoute(result);
        return;
    }

    // ===== GLOBAL MODE (OSRM) =====
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


    // ===== GLOBAL MODE (OSRM) =====

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
            document.getElementById('results-area')?.classList.remove('hidden');
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
        document.getElementById('results-area')?.classList.add('hidden');
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
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(p1.lat * rad) * Math.cos(p2.lat * rad) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
        if (!t) return;
        t.innerText = msg;
        t.style.opacity = '1';
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t.style.opacity = '0', 2500);
    }
};

window.onload = () => app.init();
