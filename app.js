const app = {
    // --- CONFIGURATION ---
    // The Threshold: Venues <= 9 uses TSP (Brute Force), > 9 uses Heuristic
    TSP_THRESHOLD: 9, 
    
    // Average Speeds (km/h) for Time Estimation
    speeds: {
        walk: 5,   // Average walking speed
        cycle: 15, // Casual cycling
        bike: 30,  // Campus speed limit
        car: 25    // Traffic adjusted
    },

    // --- STATE ---
    map: null,
    isEditMode: false,
    currentMode: 'walk',
    venues: [],
    userSelection: [],
    routingControl: null,
    currentTotalDistance: 0, // In meters (from OSRM)

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

    // --- INITIALIZATION ---
    init: function() {
        // Initialize Map
        this.map = L.map('map', {zoomControl: false}).setView([17.3850, 78.4867], 16);
        
        // Load OpenStreetMap Tiles (Free)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(this.map);

        this.loadData();

        // Map Click Event (Add Point if in Edit Mode)
        this.map.on('click', (e) => {
            if (this.isEditMode) {
                this.addVenue(e.latlng);
            }
        });

        console.log("DamnLetsGo v3.0 - Unified Engine Ready");
    },

    // --- VENUE MANAGEMENT ---
    addVenue: function(latlng) {
        const id = Date.now();
        const name = `Point ${this.venues.length + 1}`; 
        
        const marker = L.marker(latlng).addTo(this.map);
        marker.bindPopup(`<b>${name}</b>`);
        
        // Click on marker = Select/Deselect
        marker.on('click', () => {
            this.toggleSelection(id);
        });

        this.venues.push({ id, lat: latlng.lat, lng: latlng.lng, name, marker });
        this.saveData();
        this.showToast("Venue Added");
    },

    toggleSelection: function(id) {
        const venue = this.venues.find(v => v.id === id);
        if (!venue) return;

        const index = this.userSelection.indexOf(venue);

        if (index === -1) {
            // Select
            this.userSelection.push(venue);
            venue.marker.setIcon(this.icons.selected);
        } else {
            // Deselect
            this.userSelection.splice(index, 1);
            venue.marker.setIcon(this.icons.default);
        }

        // Mark the first one as "Start" visually if multiple
        if (this.userSelection.length > 0) {
            this.userSelection[0].marker.setIcon(this.icons.start);
            // Reset others to selected green
            for(let i=1; i<this.userSelection.length; i++){
                this.userSelection[i].marker.setIcon(this.icons.selected);
            }
        }
        
        this.updateUI();
    },

    clearSelection: function() {
        this.userSelection.forEach(v => v.marker.setIcon(this.icons.default));
        this.userSelection = [];
        this.currentTotalDistance = 0;
        this.clearRoute();
        this.updateUI();
    },

    clearAllData: function() {
        if(!confirm("Are you sure you want to delete all points?")) return;
        this.venues.forEach(v => this.map.removeLayer(v.marker));
        this.venues = [];
        this.clearSelection();
        this.saveData();
        this.showToast("All Data Deleted");
    },

    // --- THE UNIFIED ALGORITHM ENGINE ---
    calculateRoute: function() {
        if (this.userSelection.length < 2) {
            this.showToast("Please select at least 2 locations");
            return;
        }

        this.showToast("Calculating Optimized Path...");

        // 1. Determine Strategy based on input size
        const startNode = this.userSelection[0];
        const others = this.userSelection.slice(1);
        let sortedPath = [];
        let method = "";

        // AUTOMATIC SWITCH:
        if (this.userSelection.length <= this.TSP_THRESHOLD) {
            // Small Input -> Exact Result (Brute Force)
            console.log("Engine: Brute Force TSP");
            const bestPerm = this.solveTSPBruteForce(startNode, others);
            sortedPath = [startNode, ...bestPerm];
            method = "Exact Shortest Path";
        } else {
            // Large Input -> Fast Approximation (Nearest Neighbor)
            console.log("Engine: Heuristic TSP");
            sortedPath = this.solveTSPHeuristic(startNode, others);
            method = "Optimized Route";
        }

        document.getElementById('algo-badge').innerText = method;

        // 2. Draw the path on roads using OSRM
        this.drawRoadRoute(sortedPath);
    },

    // --- ROUTING VISUALIZATION (OSRM) ---
    drawRoadRoute: function(pathVenueObjects) {
        this.clearRoute();
        
        // Convert venue objects to Leaflet LatLngs
        const waypoints = pathVenueObjects.map(v => L.latLng(v.lat, v.lng));

        // Create Routing Control (Hidden UI, just the line)
        this.routingControl = L.Routing.control({
            waypoints: waypoints,
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1',
                profile: 'driving' // We use driving for consistent road graph, adjust time manually
            }),
            createMarker: function() { return null; }, // We use our own markers
            lineOptions: {
                styles: [{color: '#2563eb', opacity: 0.8, weight: 6}]
            },
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: false, // We do it manually with padding
            show: false 
        }).addTo(this.map);

        // Event: Route Found
        this.routingControl.on('routesfound', (e) => {
            const routes = e.routes;
            const summary = routes[0].summary;
            
            // Store real road distance (meters)
            this.currentTotalDistance = summary.totalDistance;
            
            // Update UI
            this.updateTimeAndDistance();
            
            document.getElementById('results-area').classList.remove('hidden');

            // Fit bounds with padding for dashboard
            const bounds = L.latLngBounds(waypoints);
            this.map.fitBounds(bounds, {
                paddingBottomRight: [0, 300], // Add padding at bottom so path isn't behind dashboard
                paddingTopLeft: [0, 50]
            });
        });
        
        this.routingControl.on('routingerror', function(e) {
            console.error("OSRM Error", e);
            app.showToast("Could not find road path. Check internet.");
        });
    },

    clearRoute: function() {
        if (this.routingControl) {
            this.map.removeControl(this.routingControl);
            this.routingControl = null;
        }
        document.getElementById('results-area').classList.add('hidden');
    },

    // --- ALGORITHMS (The Math) ---
    
    // 1. Brute Force TSP (O(N!)) - Accurate for N <= 9
    solveTSPBruteForce: function(start, others) {
        const perms = this.getPermutations(others);
        let minDist = Infinity;
        let bestOrder = [];
        
        perms.forEach(perm => {
            let d = 0; 
            let curr = start;
            // Sum Haversine distances
            perm.forEach(n => { 
                d += this.getDirectDist(curr, n); 
                curr = n; 
            });
            
            if (d < minDist) { 
                minDist = d; 
                bestOrder = perm; 
            }
        });
        return bestOrder;
    },

    // 2. Nearest Neighbor Heuristic (O(N^2)) - Fast for N > 9
    solveTSPHeuristic: function(start, others) {
        let unvisited = [...others];
        let path = [start];
        let current = start;
        
        while(unvisited.length > 0) {
            let nearestIdx = -1; 
            let minD = Infinity;
            
            unvisited.forEach((n, i) => {
                const d = this.getDirectDist(current, n);
                if(d < minD) { 
                    minD = d; 
                    nearestIdx = i; 
                }
            });
            
            current = unvisited[nearestIdx];
            path.push(current);
            unvisited.splice(nearestIdx, 1);
        }
        return path;
    },
    
    // Helper: Permutation Generator
    getPermutations: function(arr) {
        if (arr.length <= 1) return [arr];
        return arr.flatMap((v, i) => this.getPermutations(arr.filter((_, j) => j !== i)).map(p => [v, ...p]));
    },

    // Helper: Haversine Distance (Crow flies) - used ONLY for ordering
    getDirectDist: function(p1, p2) {
        const R = 6371e3; // Earth radius in meters
        const rad = Math.PI/180;
        const dLat = (p2.lat - p1.lat)*rad;
        const dLon = (p2.lng - p1.lng)*rad;
        const a = Math.sin(dLat/2)**2 + Math.cos(p1.lat*rad)*Math.cos(p2.lat*rad)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    },

    // --- UI HELPERS ---
    
    updateTimeAndDistance: function() {
        if(this.currentTotalDistance === 0) return;

        const distMeters = this.currentTotalDistance;
        const speedKmh = this.speeds[this.currentMode];
        
        // Convert to KM
        const distKm = distMeters / 1000;
        
        // Time = Distance / Speed * 60
        const timeMins = Math.ceil((distKm / speedKmh) * 60);

        // Display
        document.getElementById('dist-val').innerText = distMeters > 1000 ? 
            distKm.toFixed(2) + ' km' : 
            Math.round(distMeters) + ' m';
            
        document.getElementById('time-val').innerText = timeMins + " min";
    },

    setTravelMode: function(mode, btn) {
        this.currentMode = mode;
        // Visual Update
        document.querySelectorAll('.t-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Logic Update (Instant)
        this.updateTimeAndDistance();
        
        this.showToast(`Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
    },

    toggleDashboard: function() {
        // Just simple collapse/expand if needed, mostly handled by CSS now
        // Currently relying on max-height in CSS, but we can add a class if we want full minimize
    },

    toggleEditMode: function() {
        this.isEditMode = document.getElementById('edit-mode-toggle').checked;
        const controls = document.getElementById('edit-controls');
        if(this.isEditMode) {
            controls.classList.remove('hidden');
            this.showToast("Tap map to add venues");
        } else {
            controls.classList.add('hidden');
        }
    },

    updateUI: function() {
        const count = this.userSelection.length;
        const text = count === 0 ? 
            "Select venues on map to start" : 
            `${count} venues selected`;
        document.getElementById('selection-status').innerText = text;
    },

    // --- SEARCH ---
    handleSearch: function() {
        const query = document.getElementById('search-input').value.toLowerCase();
        const resultsDiv = document.getElementById('search-results');
        const clearBtn = document.getElementById('clear-search');
        
        resultsDiv.innerHTML = '';
        
        if(query.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');

        if(query.length < 2) { 
            resultsDiv.classList.add('hidden'); 
            return; 
        }

        const matches = this.venues.filter(v => v.name.toLowerCase().includes(query));
        
        if(matches.length > 0) {
            resultsDiv.classList.remove('hidden');
            matches.forEach(v => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerHTML = `<span>${v.name}</span> <span class="search-add-btn">+ Add</span>`;
                div.onclick = () => {
                    this.selectSearchResult(v);
                };
                resultsDiv.appendChild(div);
            });
        } else {
            resultsDiv.classList.add('hidden');
        }
    },

    selectSearchResult: function(venue) {
        // Zoom to place
        this.map.flyTo([venue.lat, venue.lng], 18);
        
        // Select it
        if (!this.userSelection.find(v => v.id === venue.id)) {
            this.toggleSelection(venue.id);
        }
        
        // Clear Search
        this.clearSearch();
    },

    clearSearch: function() {
        document.getElementById('search-input').value = '';
        document.getElementById('search-results').classList.add('hidden');
        document.getElementById('clear-search').classList.add('hidden');
    },

    // --- MANUAL MAP CONTROLS ---
    panMap: function(x, y) { this.map.panBy([x, y]); },
    zoomMap: function(z) { this.map.setZoom(this.map.getZoom() + z); },
    resetView: function() { 
        if(this.userSelection.length > 0) {
             const group = new L.featureGroup(this.userSelection.map(u => u.marker));
             this.map.fitBounds(group.getBounds(), {padding: [50, 50]});
        } else {
            this.map.setView([17.3850, 78.4867], 16); 
        }
    },

    // --- STORAGE ---
    saveData: function() {
        const data = this.venues.map(v => ({ id: v.id, lat: v.lat, lng: v.lng, name: v.name }));
        localStorage.setItem('damnletsgo_db', JSON.stringify(data));
    },

    loadData: function() {
        const data = localStorage.getItem('damnletsgo_db');
        if (data) {
            const parsed = JSON.parse(data);
            parsed.forEach(v => {
                const latlng = {lat: v.lat, lng: v.lng};
                const marker = L.marker(latlng).addTo(this.map);
                marker.bindPopup(`<b>${v.name}</b>`);
                marker.on('click', () => this.toggleSelection(v.id));
                this.venues.push({ ...v, marker });
            });
        }
    },

    showToast: function(msg) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.style.opacity = '1';
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t.style.opacity = '0', 3000);
    }
};

window.onload = () => app.init();