// ================= CAMPUS DATA CONFIG (SSOT) =================
const CAMPUS_DATA_VERSION = "v2";

const CAMPUS_DATA_PATHS = {
    v1: "./data/vit_campus_graph_v1.json",
    v2: "./data/vit_campus_graph_v2.json"
};

const CAMPUS_DATA_URL = CAMPUS_DATA_PATHS[CAMPUS_DATA_VERSION];

if (!CAMPUS_DATA_URL) {
    throw new Error(
        "Invalid CAMPUS_DATA_VERSION: " + CAMPUS_DATA_VERSION
    );
}

console.log("Using campus data:", CAMPUS_DATA_URL);
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
    searchResults: [],
searchAbortController: null,
searchDebounceTimer: null,
campusArrowLayer: null,
campusSelection: [],

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
searchCampusNodes(query) {
    if (!campusGraphData) return [];

    const q = query.toLowerCase();

    return Object.values(campusGraphData)
        .filter(n =>
            n.name &&
            (n.type === "entry" || n.type === "poi") &&
            n.name.toLowerCase().includes(q)
        )
        .slice(0, 10); // hard limit for UX
},
async searchGlobalPlaces(query) {
    if (this.searchAbortController) {
        this.searchAbortController.abort();
    }

    this.searchAbortController = new AbortController();

    const words = query.trim().split(/\s+/);
    const isSingleWord = words.length === 1;

    const baseUrl =
        `https://nominatim.openstreetmap.org/search` +
        `?format=json` +
        `&q=${encodeURIComponent(query)}` +
        `&countrycodes=in` +
        `&addressdetails=1` +
        `&limit=15`;

    try {
        const res = await fetch(baseUrl, {
            signal: this.searchAbortController.signal,
            headers: { "Accept-Language": "en" }
        });

        if (!res.ok) return [];

        const data = await res.json();

        // 🔹 SINGLE WORD → CITY ONLY
        if (isSingleWord) {
    return data.filter(p => {
        const a = p.address || {};
        return (
            a.city ||
            a.town ||
            a.municipality ||
            p.type === "university" ||
            p.type === "hospital"
        );
    });
}


        // 🔹 MULTI WORD → POI + CITY, BUT FILTER JUNK
        return data.filter(p => {
            const a = p.address || {};
            return (
                p.type === "university" ||
                p.type === "hospital" ||
                p.type === "college" ||
                p.class === "amenity" ||
                a.city ||
                a.town
            );
        });

    } catch {
        return [];
    }
},
panMap(x, y) {
    if (!this.map) return;

    this.map.panBy([x, y], {
        animate: true,
        duration: 0.3
    });
},
zoomMap(delta) {
    if (!this.map) return;

    const currentZoom = this.map.getZoom();
    const newZoom = currentZoom + delta;

    // Optional safety limits
    if (newZoom < 3 || newZoom > 20) return;

    this.map.setZoom(newZoom);
},
openHelp() {
    document.getElementById("help-overlay").classList.remove("hidden");
},

closeHelp() {
    document.getElementById("help-overlay").classList.add("hidden");
},

resetView() {
    if (!this.map) return;

    if (this.isCampusMode) {
        // Campus mode → always go back to VIT
        this.map.setView(VIT_CENTER, VIT_ZOOM, {
            animate: true
        });
    } else {
        // Global mode → fit to route if exists
        if (this.routingControl && this.routingControl._line) {
            this.map.fitBounds(
                this.routingControl._line.getBounds(),
                { padding: [50, 50] }
            );
        } else {
            // Otherwise just keep current center
            this.map.setView(this.map.getCenter(), this.map.getZoom());
        }
    }
},

    // ================= CAMPUS GRAPH LOADER =================
    async loadCampusGraph() {
    const res = await fetch(CAMPUS_DATA_URL);

    if (!res.ok) {
        throw new Error("Failed to load campus graph");
    }

    campusGraphData = await res.json();

    console.log(
        "Campus graph loaded:",
        Object.keys(campusGraphData).length,
        "nodes"
    );
    Object.freeze(campusGraphData);

},
getCampusNode(id) {
    if (!campusGraphData) return null;
    return campusGraphData[id] || null;
},


    validateCampusGraph() {
    if (!campusGraphData || typeof campusGraphData !== "object") {
        console.error("Campus graph is empty or invalid");
        return false;
    }

    for (const id in campusGraphData) {
        const n = campusGraphData[id];

        // Lat/Lng check
        if (typeof n.lat !== "number" || typeof n.lng !== "number") {
            console.error("Invalid coordinates at node:", id);
            return false;
        }

        // Type check
        if (!n.type) {
            console.error("Missing type at node:", id);
            return false;
        }

        // Adjacency check
        if (!n.adj || typeof n.adj !== "object") {
            console.error("Invalid adjacency at node:", id);
            return false;
        }

        for (const neighborId in n.adj) {
            // Neighbor must exist
            if (!campusGraphData[neighborId]) {
                console.error(`Broken edge: ${id} -> ${neighborId}`);
                return false;
            }

            // Weight must be valid
            const w = n.adj[neighborId];
            if (typeof w !== "number" || w <= 0) {
                console.error(`Invalid edge weight: ${id} -> ${neighborId}`);
                return false;
            }

            // No self loops
            if (neighborId === id) {
                console.error(`Self loop detected at node: ${id}`);
                return false;
            }
        }
    }

    console.log("Campus graph validation OK (strict)");
    return true;
},

    
    findNearestCampusNode(lat, lng) {
    let nearestId = null;
    let minDist = Infinity;

    for (const id in campusGraphData) {
        const n = campusGraphData[id];

        // Only allow ENTRY or POI as routing endpoints
        // Only ENTRY or POI
if (n.type !== "entry" && n.type !== "poi") continue;

// Must be connected to graph
if (!n.adj || Object.keys(n.adj).length === 0) continue;


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
computeCampusRoute(points) {
    let fullPath = [];
    let totalDistance = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const res = this.findCampusShortestPath(
            points[i].snapTo,
            points[i + 1].snapTo
        );

        if (!res) return null;

        if (i === 0) {
            fullPath.push(...res.path);
        } else {
            fullPath.push(...res.path.slice(1)); // avoid duplicate node
        }

        totalDistance += res.distance;
    }

    return { path: fullPath, distance: totalDistance };
},

handleCampusClick(latlng) {
    const nearestNodeId = this.findNearestCampusNode(latlng.lat, latlng.lng);
    
    if (!nearestNodeId) {
        this.showToast("No nearby campus location");
        return;
    }

    // Check if this snap location is already selected
    if (this.campusSelection.some(v => v.snapTo === nearestNodeId)) {
        this.showToast("Choose a different campus location");
        return;
    }

    const node = this.getCampusNode(nearestNodeId);
    if (!node) {
        this.showToast("Invalid campus node");
        return;
    }

    // ✅ CHANGED: Place marker at USER'S CLICK LOCATION (not at snap node)
    const marker = L.marker([latlng.lat, latlng.lng], {
        icon: this.icons.selected
    }).addTo(this.map);

    // ✅ REMOVED: No more snap lines!
    // ✅ REMOVED: No more campusSnapLayers!

    const venue = {
        id: Date.now(),
        rawLat: latlng.lat,        // User's actual click
        rawLng: latlng.lng,        // User's actual click
        lat: latlng.lat,           // Display at user's click
        lng: latlng.lng,           // Display at user's click
        snapTo: nearestNodeId,     // But route from this node
        snapLat: node.lat,         // Store snap node coords for routing
        snapLng: node.lng,         // Store snap node coords for routing
        name: node.name || "Campus Point",
        marker
    };

    this.campusSelection.push(venue);

    // Update marker icon based on position
    marker.setIcon(
        this.campusSelection.length === 1
            ? this.icons.start
            : this.icons.selected
    );

    this.updateUI();
    
    console.log(`Point at [${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}] → routes from "${node.name}"`);
},


// clearCampusSnaps() {
//     this.campusSnapLayers.forEach(l => this.map.removeLayer(l));
//     this.campusSnapLayers = [];
// },


findCampusShortestPath(startId, endId) {
    if (!this.getCampusNode(startId) || !this.getCampusNode(endId)) {
    console.warn("Invalid start or end node");
    return null;
}

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
    // ✅ REMOVED: clearCampusSnaps() - not needed anymore

    if (!pathResult || !pathResult.path) return;

    if (this.campusRouteLayer) {
        this.map.removeLayer(this.campusRouteLayer);
        this.campusRouteLayer = null;
    }

    // Convert node IDs to LatLngs
    const latlngs = pathResult.path.map(id => {
        const n = this.getCampusNode(id);
        if (!n) {
            console.error("Route references missing node:", id);
            return null;
        }
        return [n.lat, n.lng];
    }).filter(Boolean);

    // ✅ NEW: Add user's click points to the route visualization
    // This connects the user's marker to the routing graph
    this.campusRouteLayer = L.polyline(latlngs, {
    color: '#16a34a',
    weight: 6,
    opacity: 0.9,
    lineJoin: 'round',
    lineCap: 'round'
}).addTo(this.map);
console.log("Route points:", latlngs.length);

// ===== DIRECTION ARROWS =====
if (this.campusArrowLayer) {
    this.map.removeLayer(this.campusArrowLayer);
    this.campusArrowLayer = null;
}

this.campusArrowLayer = L.polylineDecorator(this.campusRouteLayer, {
    patterns: [
        {
            offset: 25,
            repeat: 80,
            symbol: L.Symbol.arrowHead({
                pixelSize: 12,
                polygon: false,
                pathOptions: {
                    stroke: true,
                    color: '#064e3b',
                    weight: 3
                }
            })
        }
    ]
}).addTo(this.map);

    // ✅ CHANGED: Calculate total distance including snap distances
    let snapDistance = 0;

    // Distance from first user point to first snap node
    if (this.campusSelection[0]) {
        snapDistance += this.getDirectDist(
            { 
                lat: this.campusSelection[0].rawLat, 
                lng: this.campusSelection[0].rawLng 
            },
            { 
                lat: this.campusSelection[0].snapLat, 
                lng: this.campusSelection[0].snapLng 
            }
        );
    }

    // Distance from last snap node to last user point
    if (this.campusSelection.length > 0) {
        const last = this.campusSelection[this.campusSelection.length - 1];
        snapDistance += this.getDirectDist(
            { 
                lat: last.snapLat, 
                lng: last.snapLng 
            },
            { 
                lat: last.rawLat, 
                lng: last.rawLng 
            }
        );
    }

    this.currentTotalDistance = pathResult.distance + snapDistance;

    this.updateDistanceOnly();
    document.getElementById('results-area')?.classList.remove('hidden');
    document.getElementById('time-stat')?.classList.add('hidden');
    document.getElementById('time-options')?.classList.add('hidden');

    console.log("Campus route drawn (markers at user locations)");
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
    this.clearRoute();
this.lastRoutePath = null;
this.campusSelection = [];

    if (!campusGraphData) {
        this.showToast("Campus data not loaded");
        return;
    }

    
    // 1. Set state
    this.isCampusMode = true;

    // 2. Clear previous stuff
    this.clearSelection();
    this.clearRoute();

    // 3. FORCE Leaflet to wake up
    this.map.invalidateSize(true);

    // 4. Move map AFTER invalidation
    this.map.setView(VIT_CENTER, VIT_ZOOM, {
        animate: true
    });

    // 5. Feedback
    this.showToast("Campus Mode: VIT Vellore");
    console.log("Entered Campus Mode");
},

showTimeOptions() {
    if (!this.currentTotalDistance) {
        this.showToast("Calculate route first");
        return;
    }

    // Show travel mode buttons
    document.getElementById("time-options").classList.remove("hidden");
    
    // Show time stat row
    document.getElementById("time-stat").classList.remove("hidden");
    
    // Calculate and display time immediately
    this.updateTimeOnly();
    
    this.showToast("Select travel mode to see estimated time");
},

exitCampusMode() {
    // 1️⃣ Turn off mode FIRST
    this.isCampusMode = false;

    // 2️⃣ Remove campus markers
    this.campusSelection.forEach(v => {
        if (v.marker) this.map.removeLayer(v.marker);
    });
    this.campusSelection = [];

    // 3️⃣ Remove campus route
    if (this.campusRouteLayer) {
        this.map.removeLayer(this.campusRouteLayer);
        this.campusRouteLayer = null;
    }

    // 4️⃣ Reset distance & UI
    this.currentTotalDistance = 0;
    document.getElementById('results-area')?.classList.add('hidden');
    document.getElementById('time-options')?.classList.add('hidden');
    document.getElementById('time-stat')?.classList.add('hidden');
    document.getElementById('estimate-time-row')?.classList.add('hidden');

    // 5️⃣ Reset view (optional but recommended)
    this.map.setView([17.3850, 78.4867], 16);

    // 6️⃣ Update UI text
    this.updateUI();
    this.showToast("Global Mode");
    console.log("Exited Campus Mode cleanly");
},



    // ================= INIT =================
    // ================= INIT =================
async init() {
    // ===== STEP 4.1: HARD FAIL ON BAD CAMPUS DATA =====
    try {
        await this.loadCampusGraph();

        const isValid = this.validateCampusGraph();
        if (!isValid) {
            throw new Error("Campus graph validation failed");
        }
    } catch (err) {
        console.error(err);
        alert("Campus data is broken. Fix the JSON before running the app.");
        return; // ⛔ STOP APP COMPLETELY
    }
    const resetBtn = document.getElementById("resetBtn");

if (resetBtn) {
    resetBtn.addEventListener("click", () => {
        this.resetApp();
    });
}

    // ===== MAP INITIALIZATION =====
    this.map = L.map('map', { zoomControl: false })
        .setView([17.3850, 78.4867], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(this.map);

    // ===== MAP CLICK HANDLER =====
    this.map.on('click', (e) => {
        if (this.isCampusMode) {
            this.handleCampusClick(e.latlng);
            return;
        }
        this.addTempPoint(e.latlng);
    });

    // ===== CAMPUS MODE BUTTON (REGISTER ONCE) =====
    const campusBtn = document.getElementById("campusToggle");

    if (campusBtn) {
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
    }

    console.log("Global OSRM Mode Ready");
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
    handleSearch() {
    clearTimeout(this.searchDebounceTimer);

    this.searchDebounceTimer = setTimeout(() => {
        this._handleSearchInternal();
    }, 350);
},

async _handleSearchInternal() {
    const input = document.getElementById("search-input");
    const resultsBox = document.getElementById("search-results");
    const clearBtn = document.getElementById("clear-search");

    if (!input || !resultsBox || !clearBtn) return;

    const query = input.value.trim();

    // ✅ MINIMUM LENGTH FOR GLOBAL SEARCH
    if (
    !query ||
    (!this.isCampusMode &&
     (query.length < 4)
    )
) {
    resultsBox.classList.add("hidden");
    clearBtn.classList.add("hidden");
    return;
}

    clearBtn.classList.remove("hidden");

    let results = [];

    if (this.isCampusMode) {
        results = this.searchCampusNodes(query);
    } else {
        results = await this.searchGlobalPlaces(query);
    }

    this.renderSearchResults(results);
},
formatPlaceLabel(place) {
    if (!place.address) return place.display_name;

    const a = place.address;

    const city =
        a.city ||
        a.town ||
        a.municipality;

    const state = a.state;
    const country = a.country;

    // 🚫 Hide state-only results visually
    if (!city && state && country) {
        return `${state}, ${country} (Region)`;
    }

    let parts = [];
    if (city) parts.push(city);
    if (state) parts.push(state);
    if (country) parts.push(country);

    return parts.join(", ");
},

deduplicatePlaces(results) {
    const seen = new Set();
    const unique = [];

    for (const place of results) {
        const label = this.formatPlaceLabel(place);

        if (seen.has(label)) continue;

        seen.add(label);
        unique.push(place);
    }

    return unique;
},

renderSearchResults(results) {
    const box = document.getElementById("search-results");
    box.innerHTML = "";

    if (!results || results.length === 0) {
        box.classList.add("hidden");
        return;
    }

    // ✅ Deduplicate global results
    const finalResults = this.isCampusMode
    ? results
    : this.deduplicatePlaces(results.slice(0, 8));


    finalResults.forEach(item => {
        const div = document.createElement("div");
        div.className = "search-item";

        const name = document.createElement("span");

        name.innerText = this.isCampusMode
            ? item.name
            : this.formatPlaceLabel(item);

        const btn = document.createElement("span");
        btn.className = "search-add-btn";
        btn.innerText = "ADD";

        div.appendChild(name);
        div.appendChild(btn);

        div.onclick = () => {
            if (this.isCampusMode) {
                this.selectCampusSearchResult(item);
            } else {
                this.selectGlobalSearchResult(item);
            }
            this.clearSearch();
        };

        box.appendChild(div);
    });

    box.classList.remove("hidden");
},

selectCampusSearchResult(node) {
    this.map.setView([node.lat, node.lng], VIT_ZOOM, { animate: true });

    // Fake a click at node location
    this.handleCampusClick({
        lat: node.lat,
        lng: node.lng
    });
},selectGlobalSearchResult(place) {
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);

    this.map.setView([lat, lng], 16, { animate: true });
    this.addTempPoint({ lat, lng });
},
clearSearch() {
    document.getElementById("search-input").value = "";
    document.getElementById("search-results").classList.add("hidden");
    document.getElementById("clear-search").classList.add("hidden");
},

    clearSelection() {
        // Clear snap segments
        if (this.isCampusMode) return;

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
    // ================= CAMPUS MODE =================
    if (this.isCampusMode) {
        // ✅ REMOVED: clearCampusSnaps() - not needed

        if (this.campusSelection.length < 2) {
            this.showToast("Select at least 2 campus points");
            return;
        }

        for (const p of this.campusSelection) {
            if (!p.snapTo) {
                this.showToast("One or more campus points are unreachable");
                return;
            }
        }

        let ordered;

        if (this.campusSelection.length <= this.TSP_THRESHOLD) {
            const start = this.campusSelection[0];
            const others = this.campusSelection.slice(1);
            const optimized = this.solveCampusTSP(start, others);
            ordered = [start, ...optimized];
            console.log("Campus route optimized with TSP");
        } else {
            ordered = this.solveCampusTSPHeuristic(
                this.campusSelection[0],
                this.campusSelection.slice(1)
            );
            console.log("Campus route optimized with greedy heuristic");
        }

        const result = this.computeCampusRoute(ordered);

        if (!result || !result.path || result.path.length === 0) {
            this.showToast("No valid campus route found");
            return;
        }

        this.drawCampusRoute(result);
        document.getElementById('estimate-time-row')?.classList.remove('hidden');
        
        return;
    }

    // ================= GLOBAL MODE (UNCHANGED) =================
    if (this.userSelection.length < 2) {
        this.showToast("Select at least 2 locations");
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
    document.getElementById('estimate-time-row')?.classList.remove('hidden');
},
solveCampusTSP(start, others) {
    // Brute force TSP using campus graph distances
    const perms = this.getPermutations(others);
    let minDist = Infinity;
    let bestPath = [];

    for (const perm of perms) {
        let totalDist = 0;
        let current = start;

        // Calculate total distance through this permutation
        for (const next of perm) {
            const segment = this.findCampusShortestPath(
                current.snapTo,
                next.snapTo
            );

            if (!segment) {
                totalDist = Infinity; // Invalid path
                break;
            }

            totalDist += segment.distance;
            current = next;
        }

        if (totalDist < minDist) {
            minDist = totalDist;
            bestPath = perm;
        }
    }

    return bestPath;
},
solveCampusTSPHeuristic(start, others) {
    // Nearest neighbor heuristic using campus graph distances
    let unvisited = [...others];
    let path = [start];
    let current = start;

    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let minDist = Infinity;

        // Find nearest unvisited node
        for (let i = 0; i < unvisited.length; i++) {
            const segment = this.findCampusShortestPath(
                current.snapTo,
                unvisited[i].snapTo
            );

            if (segment && segment.distance < minDist) {
                minDist = segment.distance;
                nearestIdx = i;
            }
        }

        // Visit nearest node
        current = unvisited[nearestIdx];
        path.push(current);
        unvisited.splice(nearestIdx, 1);
    }

    return path;
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
        
        // ✅ CHANGED: Only show distance, NOT time
        this.updateDistanceOnly();
        document.getElementById('results-area')?.classList.remove('hidden');
        
        // ✅ NEW: Hide time stat until user clicks "Estimate Time"
        document.getElementById('time-stat')?.classList.add('hidden');
        document.getElementById('time-options')?.classList.add('hidden');
    });

    this.routingControl.on('routingerror', () => {
        this.clearRoute();
        this.showToast('Routing failed. Check connection.');
    });
},
resetApp() {
    this.clearRoute();

    this.venues.forEach(v => {
        if (v.marker) this.map.removeLayer(v.marker);
    });

    this.venues = [];
    this.userSelection = [];
    this.lastRoutePath = null;

    this.campusSelection = [];

    if (this.campusRouteLayer) {
        this.map.removeLayer(this.campusRouteLayer);
        this.campusRouteLayer = null;
    }

    // ✅ REMOVED: clearCampusSnaps() - not needed

    this.isCampusMode = false;

    document.getElementById('results-area')?.classList.add('hidden');
    document.getElementById('time-options')?.classList.add('hidden');
    document.getElementById('time-stat')?.classList.add('hidden');
    document.getElementById('estimate-time-row')?.classList.add('hidden');

    const campusBtn = document.getElementById("campusToggle");
    if (campusBtn) {
        campusBtn.classList.remove("active");
        campusBtn.innerText = "Campus Mode: OFF";
    }

    this.updateUI();
    this.showToast("Reset complete");

    console.log("App reset");
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

    // Update active button styling
    document.querySelectorAll('.t-btn')
        .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // ✅ CRITICAL: Only update time display, DO NOT redraw route
    this.updateTimeOnly();
    
    console.log(`Travel mode: ${mode} (time updated only)`);
},
clearSelectionOnly() {
    if (this.isCampusMode) {
        this.campusSelection.forEach(v => {
            if (v.marker) this.map.removeLayer(v.marker);
        });
        this.campusSelection = [];
        
        // ✅ REMOVED: clearCampusSnaps() - not needed
        
        if (this.campusRouteLayer) {
            this.map.removeLayer(this.campusRouteLayer);
            this.campusRouteLayer = null;
        }
    } else {
        this.userSelection.forEach(v => {
            v.marker.setIcon(this.icons.default);
        });
        this.userSelection = [];
    }
    
    document.getElementById('results-area')?.classList.add('hidden');
    document.getElementById('time-options')?.classList.add('hidden');
    document.getElementById('time-stat')?.classList.add('hidden');
    document.getElementById('estimate-time-row')?.classList.add('hidden');
    
    this.clearRoute();
    
    this.updateUI();
    this.showToast("Selection cleared");
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
    
updateDistanceOnly() {
    if (!this.currentTotalDistance) return;

    const km = this.currentTotalDistance / 1000;
    document.getElementById('dist-val').innerText =
        km >= 1
            ? km.toFixed(2) + ' km'
            : Math.round(this.currentTotalDistance) + ' m';
},
updateTimeOnly() {
    if (!this.currentTotalDistance) return;

    const km = this.currentTotalDistance / 1000;
    const speed = this.speeds[this.currentMode];
    const mins = Math.ceil((km / speed) * 60);

    document.getElementById('time-val').innerText = mins + ' min';
},

    updateUI() {
    if (this.isCampusMode) {
        document.getElementById('selection-status').innerText =
            this.campusSelection.length
                ? `${this.campusSelection.length} campus points selected`
                : 'Tap campus map to select start and destination';
        return;
    }

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
