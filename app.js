const app = {
    /* =========================
       CONFIG
    ========================= */
    MAX_BRUTE_FORCE: 9,

    /* =========================
       STATE
    ========================= */
    map: null,
    mode: "organizer",
    venues: [],
    selectedIds: new Set(),
    routeLayer: null,

    /* =========================
       ICONS
    ========================= */
    icons: {
        default: new L.Icon.Default(),
        selected: new L.Icon({
            iconUrl:
                "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
            shadowUrl:
                "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            shadowSize: [41, 41],
        }),
    },

    /* =========================
       INIT
    ========================= */
    init() {
        this.map = L.map("map").setView([17.385, 78.4867], 16);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap",
        }).addTo(this.map);

        this.loadData();

        this.map.on("click", (e) => {
            if (this.mode === "organizer") this.addVenue(e.latlng);
        });

        console.log("DamnLetsGo Engine Ready");
    },

    /* =========================
       ORGANIZER
    ========================= */
    addVenue(latlng) {
        const id = Date.now();
        const name = `Venue ${this.venues.length + 1}`;

        const marker = L.marker(latlng).addTo(this.map);
        marker.bindPopup(`<b>${name}</b>`);

        marker.on("click", () => {
            if (this.mode === "user") this.toggleSelection(id);
        });

        this.venues.push({ id, lat: latlng.lat, lng: latlng.lng, name, marker });
        this.saveData();
        this.updateCounts();
        this.showToast("Venue added");
    },

    clearAllData() {
        if (!confirm("Delete all venues?")) return;

        this.venues.forEach((v) => this.map.removeLayer(v.marker));
        this.venues = [];
        this.clearSelection();
        localStorage.removeItem("damnletsgo_db");
        this.updateCounts();
        this.showToast("Map reset");
    },

    exportData() {
        const data = JSON.stringify(
            this.venues.map(({ id, lat, lng, name }) => ({ id, lat, lng, name })),
            null,
            2
        );
        navigator.clipboard.writeText(data);
        this.showToast("Map copied to clipboard");
    },

    importData() {
        const json = prompt("Paste venue JSON");
        if (!json) return;

        try {
            const parsed = JSON.parse(json);
            this.clearAllData();
            parsed.forEach((v) => this.addVenue({ lat: v.lat, lng: v.lng }));
            this.showToast("Map imported");
        } catch {
            alert("Invalid JSON");
        }
    },

    /* =========================
       USER
    ========================= */
    toggleSelection(id) {
        const venue = this.venues.find((v) => v.id === id);
        if (!venue) return;

        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
            venue.marker.setIcon(this.icons.default);
        } else {
            this.selectedIds.add(id);
            venue.marker.setIcon(this.icons.selected);
        }

        this.updateCounts();
    },

    clearSelection() {
        this.selectedIds.forEach((id) => {
            const v = this.venues.find((x) => x.id === id);
            if (v) v.marker.setIcon(this.icons.default);
        });
        this.selectedIds.clear();

        if (this.routeLayer) this.map.removeLayer(this.routeLayer);
        document.getElementById("results-area").classList.add("hidden");
        this.updateCounts();
    },

    /* =========================
       CORE ENGINE
    ========================= */
    calculateRoute() {
        const selected = [...this.selectedIds].map((id) =>
            this.venues.find((v) => v.id === id)
        );

        if (selected.length < 2) {
            this.showToast("Select at least 2 venues");
            return;
        }

        const start = selected[0];
        const rest = selected.slice(1);

        let path, algo;

        if (selected.length <= this.MAX_BRUTE_FORCE) {
            algo = "Exact (Brute Force)";
            path = [start, ...this.solveBrute(start, rest)];
        } else {
            algo = "Near-Optimal (Greedy + 2-Opt)";
            path = this.solveHeuristic(start, rest);
        }

        this.drawRoute(path, algo);
    },

    solveBrute(start, others) {
        const perms = this.permutations(others);
        let best = [];
        let min = Infinity;

        perms.forEach((p) => {
            let d = 0,
                cur = start;
            p.forEach((n) => {
                d += this.getDistance(cur, n);
                cur = n;
            });
            if (d < min) {
                min = d;
                best = p;
            }
        });
        return best;
    },

    permutations(arr) {
        if (arr.length <= 1) return [arr];
        return arr.flatMap((v, i) =>
            this.permutations(arr.filter((_, j) => j !== i)).map((p) => [
                v,
                ...p,
            ])
        );
    },

    solveHeuristic(start, others) {
        let path = [start];
        let unvisited = [...others];
        let current = start;

        while (unvisited.length) {
            let idx = 0;
            let min = Infinity;

            unvisited.forEach((n, i) => {
                const d = this.getDistance(current, n);
                if (d < min) {
                    min = d;
                    idx = i;
                }
            });

            current = unvisited.splice(idx, 1)[0];
            path.push(current);
        }

        // Safe 2-Opt
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 1; i < path.length - 2; i++) {
                for (let j = i + 1; j < path.length - 1; j++) {
                    const d1 =
                        this.getDistance(path[i], path[i + 1]) +
                        this.getDistance(path[j], path[j + 1]);
                    const d2 =
                        this.getDistance(path[i], path[j]) +
                        this.getDistance(path[i + 1], path[j + 1]);
                    if (d2 < d1) {
                        path.splice(
                            i + 1,
                            j - i,
                            ...path.slice(i + 1, j + 1).reverse()
                        );
                        improved = true;
                    }
                }
            }
        }
        return path;
    },

    /* =========================
       MATH
    ========================= */
    getDistance(a, b) {
        const R = 6371e3;
        const rad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * rad;
        const dLon = (b.lng - a.lng) * rad;
        const x =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * rad) *
                Math.cos(b.lat * rad) *
                Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    },

    /* =========================
       DRAW
    ========================= */
    drawRoute(path, algo) {
        if (this.routeLayer) this.map.removeLayer(this.routeLayer);

        const coords = path.map((p) => [p.lat, p.lng]);
        this.routeLayer = L.polyline(coords, {
            color: "#2563eb",
            weight: 5,
            dashArray: "10,10",
        }).addTo(this.map);

        this.map.fitBounds(this.routeLayer.getBounds(), { padding: [50, 50] });

        let dist = 0;
        for (let i = 0; i < path.length - 1; i++)
            dist += this.getDistance(path[i], path[i + 1]);

        document.getElementById("algo-name").innerText = algo;
        document.getElementById("dist-val").innerText =
            Math.round(dist) + " m";
        document.getElementById("time-val").innerText =
            Math.ceil(dist / 1.4 / 60) + " min";
        document.getElementById("results-area").classList.remove("hidden");
    },

    /* =========================
       UI / STORAGE
    ========================= */
    setMode(m) {
        this.mode = m;
        document
            .getElementById("btn-organizer")
            .classList.toggle("active", m === "organizer");
        document
            .getElementById("btn-user")
            .classList.toggle("active", m === "user");

        document.getElementById("organizer-controls").style.display =
            m === "organizer" ? "block" : "none";
        document.getElementById("user-controls").style.display =
            m === "user" ? "block" : "none";

        this.clearSelection();
    },

    updateCounts() {
        document.getElementById("venue-count").innerText = this.venues.length;
        document.getElementById("selection-count").innerText =
            this.selectedIds.size;
    },

    showToast(msg) {
        const t = document.getElementById("toast");
        t.innerText = msg;
        t.classList.add("show");
        setTimeout(() => t.classList.remove("show"), 2500);
    },

    saveData() {
        localStorage.setItem(
            "damnletsgo_db",
            JSON.stringify(
                this.venues.map(({ id, lat, lng, name }) => ({
                    id,
                    lat,
                    lng,
                    name,
                }))
            )
        );
    },

    loadData() {
        const raw = localStorage.getItem("damnletsgo_db");
        if (!raw) return;

        JSON.parse(raw).forEach((v) => {
            const marker = L.marker([v.lat, v.lng]).addTo(this.map);
            marker.bindPopup(`<b>${v.name}</b>`);
            marker.on("click", () => {
                if (this.mode === "user") this.toggleSelection(v.id);
            });
            this.venues.push({ ...v, marker });
        });

        this.updateCounts();
    },
};

window.onload = () => app.init();
