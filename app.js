/**
 * KJP Layout • Advanced 6-Point Ground Control Point (GCP) Affine Projection Engine
 * Full-Stack GIS & Architectural CAD Overlay Solution with CSS3 3D Matrix Transformations
 */

// 1. IMMUTABLE 6-POINT GROUND CONTROL TRANSFORMATION MATRIX (At absolute top)
const GCP_MAPPING_MATRIX = Object.freeze([
  Object.freeze({
    label: "Top-Left Park Corner",
    image: Object.freeze([14, 90]),
    map: Object.freeze([15.330146085670561, 75.1702983832602])
  }),
  Object.freeze({
    label: "Top-Right Row Edge",
    image: Object.freeze([699, 105]),
    map: Object.freeze([15.330301291921328, 75.17292694799194])
  }),
  Object.freeze({
    label: "Mid-Right Park Boundary",
    image: Object.freeze([988, 834]),
    map: Object.freeze([15.327517908991947, 75.17483668073581])
  }),
  Object.freeze({
    label: "Bottom Road Tip Nose",
    image: Object.freeze([268, 1435]),
    map: Object.freeze([15.325220814114056, 75.17154292819819])
  }),
  Object.freeze({
    label: "Inner Drop Corner Near Yoga Center",
    image: Object.freeze([515, 843]),
    map: Object.freeze([15.327445478446883, 75.17331318607874])
  }),
  Object.freeze({
    label: "Central Main Road Intersection",
    image: Object.freeze([636, 509]),
    map: Object.freeze([15.32866938226605, 75.17318997748359])
  })
]);

// Global State
const appState = {
  activeFilter: 'all',
  selectedPlotNo: null,
  blueprintOpacity: 0.85,
  blueprintTheme: 'white',
  showGcpPins: true,
  plots: []
};

// Map & Layer references
let map;
let gcpBlueprintLayer;
let plotsLayerGroup;
let labelsLayerGroup;
let gcpPinsLayerGroup;
let plotLayersMap = new Map(); // plot_no -> Leaflet Layer

/**
 * 2. ALGEBRAIC AFFINE COORDINATE MATRIX TRANSFORMATION SOLVER
 * Solves least-squares overdetermined linear system for N=6 Ground Control Points:
 * u = a*x + c*y + tx
 * v = b*x + d*y + ty
 * Calculates scaling (Scale X, Scale Y), rotation, skew, and translation metrics.
 */
function computeAffineTransform(points) {
  const n = points.length;
  if (n < 3) {
    throw new Error('At least 3 Ground Control Points are required for affine transformation.');
  }

  // Normal equations: (M^T * M) * P = M^T * B
  let a00 = 0, a01 = 0, a02 = 0;
  let a11 = 0, a12 = 0, a22 = n;
  let bu0 = 0, bu1 = 0, bu2 = 0;
  let bv0 = 0, bv1 = 0, bv2 = 0;

  for (let i = 0; i < n; i++) {
    const { x, y, u, v } = points[i];
    a00 += x * x;
    a01 += x * y;
    a02 += x;
    a11 += y * y;
    a12 += y;

    bu0 += x * u;
    bu1 += y * u;
    bu2 += u;

    bv0 += x * v;
    bv1 += y * v;
    bv2 += v;
  }

  const a10 = a01, a20 = a02, a21 = a12;

  // Compute 3x3 determinant and adjugate matrix
  const c00 = a11 * a22 - a12 * a21;
  const c01 = -(a10 * a22 - a12 * a20);
  const c02 = a10 * a21 - a11 * a20;

  const c10 = -(a01 * a22 - a02 * a21);
  const c11 = a00 * a22 - a02 * a20;
  const c12 = -(a00 * a21 - a01 * a20);

  const c20 = a01 * a12 - a02 * a11;
  const c21 = -(a00 * a12 - a02 * a10);
  const c22 = a00 * a11 - a01 * a10;

  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) < 1e-12) {
    throw new Error('GCP Matrix collinear singularity detected.');
  }

  const invDet = 1.0 / det;
  const inv00 = c00 * invDet, inv01 = c10 * invDet, inv02 = c20 * invDet;
  const inv10 = c01 * invDet, inv11 = c11 * invDet, inv12 = c21 * invDet;
  const inv20 = c02 * invDet, inv21 = c12 * invDet, inv22 = c22 * invDet;

  // Solution for u = a*x + c*y + tx
  const a = inv00 * bu0 + inv01 * bu1 + inv02 * bu2;
  const c = inv10 * bu0 + inv11 * bu1 + inv12 * bu2;
  const tx = inv20 * bu0 + inv21 * bu1 + inv22 * bu2;

  // Solution for v = b*x + d*y + ty
  const b = inv00 * bv0 + inv01 * bv1 + inv02 * bv2;
  const d = inv10 * bv0 + inv11 * bv1 + inv12 * bv2;
  const ty = inv20 * bv0 + inv21 * bv1 + inv22 * bv2;

  // Decompose into geometric affine metrics
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const rotationRad = Math.atan2(b, a);
  const rotationDeg = rotationRad * (180 / Math.PI);
  const skewRad = Math.atan2(d, c) - Math.PI / 2 - rotationRad;
  const skewDeg = skewRad * (180 / Math.PI);

  return { a, b, c, d, tx, ty, scaleX, scaleY, rotationDeg, skewDeg };
}

/**
 * 3. CUSTOM LEAFLET CSS3 3D AFFINE OVERLAY LAYER
 * Dynamically binds GCP coordinates to layer points and executes matrix3d(...)
 */
const AffineGcpBlueprintLayer = L.Layer.extend({
  initialize: function(imageUrl, gcpMatrix, options) {
    this._imageUrl = imageUrl;
    this._gcpMatrix = gcpMatrix;
    this._options = options || { opacity: 0.85 };
  },

  onAdd: function(map) {
    this._map = map;
    if (!this._image) {
      this._initImage();
    }
    map.getPanes().overlayPane.appendChild(this._image);

    // Sync with Leaflet view updates
    map.on('viewreset', this._update, this);
    map.on('move', this._update, this);
    map.on('zoom', this._update, this);
    map.on('zoomend', this._update, this);

    this._update();
  },

  onRemove: function(map) {
    if (this._image && this._image.parentNode) {
      this._image.parentNode.removeChild(this._image);
    }
    map.off('viewreset', this._update, this);
    map.off('move', this._update, this);
    map.off('zoom', this._update, this);
    map.off('zoomend', this._update, this);
  },

  _initImage: function() {
    const img = L.DomUtil.create('img', 'gcp-blueprint-layer blueprint-theme-white');
    img.src = this._imageUrl;
    img.style.position = 'absolute';
    img.style.transformOrigin = '0 0';
    img.style.pointerEvents = 'none';
    img.style.opacity = this._options.opacity;
    img.style.willChange = 'transform, opacity';
    this._image = img;
  },

  setOpacity: function(opacity) {
    this._options.opacity = opacity;
    if (this._image) {
      this._image.style.opacity = opacity;
    }
  },

  setTheme: function(theme) {
    if (!this._image) return;
    this._image.classList.remove('blueprint-theme-white', 'blueprint-theme-black', 'blueprint-theme-cyan');
    this._image.classList.add(`blueprint-theme-${theme}`);
  },

  _update: function() {
    if (!this._map || !this._image) return;

    // Convert all 6 GCPs to current Leaflet layer pixels
    const pointPairs = this._gcpMatrix.map(pt => {
      const layerPoint = this._map.latLngToLayerPoint(L.latLng(pt.map[0], pt.map[1]));
      return {
        x: pt.image[0],
        y: pt.image[1],
        u: layerPoint.x,
        v: layerPoint.y
      };
    });

    const metrics = computeAffineTransform(pointPairs);
    const { a, b, c, d, tx, ty, scaleX, scaleY, rotationDeg, skewDeg } = metrics;

    // CSS3 3D Affine Matrix
    const matrix3d = `matrix3d(${a.toFixed(8)}, ${b.toFixed(8)}, 0, 0, ${c.toFixed(8)}, ${d.toFixed(8)}, 0, 0, 0, 0, 1, 0, ${tx.toFixed(4)}, ${ty.toFixed(4)}, 0, 1)`;
    this._image.style.transform = matrix3d;

    // Update Telemetry Panel in Dashboard
    updateTelemetryUI(scaleX, scaleY, rotationDeg, skewDeg);
  }
});

/**
 * 4. INITIALIZE MAP & ESRI WORLD IMAGERY SATELLITE
 */
function initMap() {
  // Center of the 6 GCPs
  const centerLat = GCP_MAPPING_MATRIX.reduce((acc, p) => acc + p.map[0], 0) / GCP_MAPPING_MATRIX.length;
  const centerLng = GCP_MAPPING_MATRIX.reduce((acc, p) => acc + p.map[1], 0) / GCP_MAPPING_MATRIX.length;

  map = L.map('map', {
    center: [centerLat, centerLng],
    zoom: 17,
    minZoom: 14,
    maxZoom: 21,
    zoomControl: true,
    attributionControl: true
  });

  // Esri World Imagery Tile Layer
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxNativeZoom: 19,
      maxZoom: 21
    }
  ).addTo(map);

  // Esri Boundaries & Places Labels
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
      maxNativeZoom: 19,
      maxZoom: 21,
      opacity: 0.75
    }
  ).addTo(map);

  // Layer Groups
  plotsLayerGroup = L.layerGroup().addTo(map);
  labelsLayerGroup = L.layerGroup().addTo(map);
  gcpPinsLayerGroup = L.layerGroup().addTo(map);

  // Mount 6-Point GCP Blueprint Overlay
  gcpBlueprintLayer = new AffineGcpBlueprintLayer('KJP_Layout_Outline.png', GCP_MAPPING_MATRIX, {
    opacity: appState.blueprintOpacity
  });
  gcpBlueprintLayer.addTo(map);

  // Render Visual Markers for the 6 GCPs
  renderGcpVisualPins();

  // Close sidebar on empty map click
  map.on('click', function(e) {
    if (e.originalEvent.target.classList.contains('leaflet-container') ||
        e.originalEvent.target.id === 'map') {
      closeSidebar();
    }
  });
}

/**
 * Render Visual Pins for the 6 Ground Control Points
 */
function renderGcpVisualPins() {
  gcpPinsLayerGroup.clearLayers();

  GCP_MAPPING_MATRIX.forEach((gcp, idx) => {
    const latlng = L.latLng(gcp.map[0], gcp.map[1]);
    const marker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'gcp-target-pin',
        html: `<div class="gcp-pin-inner"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    });

    marker.bindTooltip(`
      <div style="font-weight: 700; color: #38bdf8;">GCP #${idx + 1}: ${gcp.label}</div>
      <div style="font-size: 10px; font-family: monospace; color: #94a3b8; margin-top: 2px;">Image Pixel: [${gcp.image[0]}, ${gcp.image[1]}]</div>
      <div style="font-size: 10px; font-family: monospace; color: #34d399;">Map LatLng: [${gcp.map[0].toFixed(6)}, ${gcp.map[1].toFixed(6)}]</div>
    `, {
      className: 'gcp-leaflet-tooltip',
      direction: 'top',
      offset: [0, -8]
    });

    gcpPinsLayerGroup.addLayer(marker);
  });
}

/**
 * 5. DYNAMIC PLOT STYLING (Strict Status Specifications)
 * 'Available' -> Semi-transparent Emerald (#2ecc71, fillOpacity: 0.35, weight: 1.5, color: '#27ae60')
 * 'Booked'    -> Semi-transparent Amber (#f1c40f, fillOpacity: 0.35, weight: 1.5, color: '#d35400')
 * 'Sold'      -> Semi-transparent Ruby (#e74c3c, fillOpacity: 0.35, weight: 1.5, color: '#c0392b')
 */
function getPlotBaseStyle(feature) {
  const status = feature.properties.status;
  if (status === 'Available') {
    return {
      fillColor: '#2ecc71',
      fillOpacity: 0.35,
      weight: 1.5,
      color: '#27ae60',
      lineCap: 'round',
      lineJoin: 'round'
    };
  } else if (status === 'Booked') {
    return {
      fillColor: '#f1c40f',
      fillOpacity: 0.35,
      weight: 1.5,
      color: '#d35400',
      lineCap: 'round',
      lineJoin: 'round'
    };
  } else {
    // Sold
    return {
      fillColor: '#e74c3c',
      fillOpacity: 0.35,
      weight: 1.5,
      color: '#c0392b',
      lineCap: 'round',
      lineJoin: 'round'
    };
  }
}

function getPlotHoverStyle(feature) {
  const base = getPlotBaseStyle(feature);
  return {
    ...base,
    weight: 3.5,
    color: '#ffffff',
    fillOpacity: 0.65
  };
}

function getPlotSelectedStyle(feature) {
  return {
    fillColor: '#38bdf8',
    fillOpacity: 0.7,
    weight: 4.0,
    color: '#ffffff'
  };
}

/**
 * 6. RENDER PLOTS GEOJSON WITH INTERACTION
 */
function renderPlots(geojsonData) {
  plotsLayerGroup.clearLayers();
  labelsLayerGroup.clearLayers();
  plotLayersMap.clear();

  appState.plots = geojsonData.features;
  updateKpiBadges();

  const geoJsonLayer = L.geoJSON(geojsonData, {
    style: function(feature) {
      return getPlotBaseStyle(feature);
    },
    filter: function(feature) {
      if (appState.activeFilter === 'all') return true;
      return feature.properties.status === appState.activeFilter;
    },
    onEachFeature: function(feature, layer) {
      const props = feature.properties;
      plotLayersMap.set(props.plot_no, layer);

      // Tooltip
      const cornerTag = props.is_corner ? '⭐ Corner' : '';
      layer.bindTooltip(`
        <div style="font-weight: 700; margin-bottom: 2px;">Plot ${props.plot_no} ${cornerTag}</div>
        <div style="font-size: 11px; opacity: 0.9;">${props.status} • ${props.dimensions}</div>
        <div style="font-size: 11px; color: #38bdf8; font-weight: 700; margin-top: 2px;">${props.price}</div>
      `, {
        sticky: true,
        direction: 'top',
        className: 'gcp-leaflet-tooltip',
        offset: [0, -10]
      });

      // Permanent Center Label
      if (layer.getBounds) {
        const center = layer.getBounds().getCenter();
        const labelMarker = L.marker(center, {
          icon: L.divIcon({
            className: 'plot-marker-label',
            html: `<span>#${props.plot_no}</span>`,
            iconSize: [40, 20]
          }),
          interactive: false
        });
        labelsLayerGroup.addLayer(labelMarker);
      }

      // Hover and Click listeners
      layer.on({
        mouseover: function(e) {
          const l = e.target;
          if (appState.selectedPlotNo !== props.plot_no) {
            l.setStyle(getPlotHoverStyle(feature));
            l.bringToFront();
          }
        },
        mouseout: function(e) {
          const l = e.target;
          if (appState.selectedPlotNo !== props.plot_no) {
            l.setStyle(getPlotBaseStyle(feature));
          }
        },
        click: function(e) {
          L.DomEvent.stopPropagation(e);
          selectPlot(props.plot_no);
        }
      });
    }
  });

  plotsLayerGroup.addLayer(geoJsonLayer);
}

/**
 * 7. SELECT PLOT & POPULATE SIDEBAR PANEL
 */
function selectPlot(plotNo) {
  const previousNo = appState.selectedPlotNo;
  appState.selectedPlotNo = plotNo;

  // Reset previous plot style
  if (previousNo && plotLayersMap.has(previousNo)) {
    const prevLayer = plotLayersMap.get(previousNo);
    prevLayer.setStyle(getPlotBaseStyle(prevLayer.feature));
  }

  const layer = plotLayersMap.get(plotNo);
  if (!layer) return;

  const feature = layer.feature;
  const props = feature.properties;

  // Apply selected style
  layer.setStyle(getPlotSelectedStyle(feature));
  layer.bringToFront();

  // Smooth centering onto the plot's true bounding center
  if (layer.getBounds) {
    map.flyToBounds(layer.getBounds(), {
      padding: [120, 120],
      maxZoom: 19,
      duration: 1.0
    });
  }

  // Populate Sidebar Header & Data Rows
  document.getElementById('sidePlotNumber').textContent = `Plot ${props.plot_no}`;
  document.getElementById('sideDimensions').textContent = props.dimensions;
  document.getElementById('sideArea').textContent = props.area;
  document.getElementById('sidePrice').textContent = props.price;
  document.getElementById('sideFacing').textContent = props.facing;

  // Status Badge
  const statusBadge = document.getElementById('sideStatusBadge');
  statusBadge.textContent = props.status;
  statusBadge.className = `status-pill-badge status-${props.status.toLowerCase()}`;

  // Golden Premium Banner: IF is_corner is true, instantly prepend
  const cornerBanner = document.getElementById('cornerPremiumBanner');
  if (props.is_corner) {
    cornerBanner.style.display = 'flex';
  } else {
    cornerBanner.style.display = 'none';
  }

  // Booking button label
  document.getElementById('bookingBtnText').textContent = `Reserve & Book Plot ${props.plot_no}`;

  // Pre-fill modal dialog
  document.getElementById('dialogPlotTitle').textContent = `Plot ${props.plot_no}`;
  document.getElementById('dialogPlotNo').textContent = `Plot ${props.plot_no}`;
  document.getElementById('dialogPlotDim').textContent = `${props.dimensions} (${props.area})`;
  document.getElementById('dialogPlotPrice').textContent = props.price;

  // Open sidebar container
  document.getElementById('propertySidebar').classList.add('open');
}

function closeSidebar() {
  document.getElementById('propertySidebar').classList.remove('open');
  if (appState.selectedPlotNo && plotLayersMap.has(appState.selectedPlotNo)) {
    const layer = plotLayersMap.get(appState.selectedPlotNo);
    layer.setStyle(getPlotBaseStyle(layer.feature));
  }
  appState.selectedPlotNo = null;
}

/**
 * 8. TELEMETRY & DASHBOARD UI BINDINGS
 */
function updateTelemetryUI(scaleX, scaleY, rotationDeg, skewDeg) {
  document.getElementById('telemetryScaleX').textContent = scaleX.toFixed(4);
  document.getElementById('telemetryScaleY').textContent = scaleY.toFixed(4);
  document.getElementById('telemetryRotation').textContent = `${rotationDeg.toFixed(2)}°`;
  document.getElementById('telemetrySkew').textContent = `${skewDeg.toFixed(2)}°`;
}

function updateKpiBadges() {
  let available = 0, booked = 0, sold = 0;
  appState.plots.forEach(f => {
    const s = f.properties.status;
    if (s === 'Available') available++;
    else if (s === 'Booked') booked++;
    else if (s === 'Sold') sold++;
  });

  document.getElementById('kpiTotal').textContent = appState.plots.length;
  document.getElementById('kpiAvailable').textContent = available;
  document.getElementById('kpiBooked').textContent = booked;
  document.getElementById('kpiSold').textContent = sold;
}

function setupUIListeners() {
  // Opacity Slider
  const slider = document.getElementById('blueprintOpacitySlider');
  slider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value) / 100;
    appState.blueprintOpacity = val;
    gcpBlueprintLayer.setOpacity(val);
    document.getElementById('opacityDisplay').textContent = `${Math.round(val * 100)}%`;
    document.querySelectorAll('.preset-pill').forEach(btn => btn.classList.remove('active'));
  });

  // Opacity Presets
  document.querySelectorAll('.preset-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = parseFloat(btn.dataset.val) / 100;
      slider.value = btn.dataset.val;
      appState.blueprintOpacity = val;
      gcpBlueprintLayer.setOpacity(val);
      document.getElementById('opacityDisplay').textContent = `${btn.dataset.val}%`;
    });
  });

  // Blueprint Themes
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gcpBlueprintLayer.setTheme(btn.dataset.theme);
    });
  });

  // Toggle GCP Ground Pins on Map
  const toggleGcpPinsBtn = document.getElementById('toggleGcpPinsBtn');
  const gcpPinsText = document.getElementById('gcpPinsText');
  toggleGcpPinsBtn.addEventListener('click', () => {
    appState.showGcpPins = !appState.showGcpPins;
    if (appState.showGcpPins) {
      map.addLayer(gcpPinsLayerGroup);
      gcpPinsText.textContent = 'Hide 6 GCPs';
    } else {
      map.removeLayer(gcpPinsLayerGroup);
      gcpPinsText.textContent = 'Show 6 GCPs';
    }
  });

  // Collapse / Expand Dashboard
  document.getElementById('toggleDashBtn').addEventListener('click', () => {
    document.getElementById('devDashboard').classList.toggle('collapsed');
  });

  // Recenter Masterplan Bounds
  document.getElementById('recenterMasterplanBtn').addEventListener('click', () => {
    const bounds = L.latLngBounds(GCP_MAPPING_MATRIX.map(g => g.map));
    map.flyToBounds(bounds, { padding: [60, 60], duration: 1.2 });
  });

  // KPI Filter Pills
  document.querySelectorAll('.kpi-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.kpi-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      appState.activeFilter = pill.dataset.filter;
      if (window.PLOTS_GEOJSON) {
        renderPlots(window.PLOTS_GEOJSON);
      }
    });
  });

  // Close Sidebar
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);

  // Booking Modal
  const modalOverlay = document.getElementById('bookingModalOverlay');
  const bookingBtn = document.getElementById('bookingSubmitBtn');
  const dialogCloseBtn = document.getElementById('dialogCloseBtn');
  const bookingForm = document.getElementById('bookingForm');

  bookingBtn.addEventListener('click', () => {
    modalOverlay.style.display = 'flex';
  });

  function closeModal() {
    modalOverlay.style.display = 'none';
  }

  dialogCloseBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('clientName').value;
    closeModal();
    showToast(`Reservation request for Plot ${appState.selectedPlotNo} submitted! We will contact ${name} shortly.`);
    bookingForm.reset();
  });

  // Keyboard ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeSidebar();
    }
  });

  // Search autocomplete
  setupSearch();
}

/**
 * 9. SEARCH AUTOCOMPLETE LOGIC
 */
function setupSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClearBtn');
  const dropdown = document.getElementById('searchDropdown');

  function doSearch(term) {
    term = term.trim().toLowerCase();
    if (!term) {
      dropdown.style.display = 'none';
      clearBtn.style.display = 'none';
      return;
    }
    clearBtn.style.display = 'block';

    const matches = appState.plots.filter(f => {
      const pno = f.properties.plot_no.toLowerCase();
      return pno.includes(term) || `plot ${pno}`.includes(term);
    });

    if (matches.length === 0) {
      dropdown.innerHTML = `<div style="padding: 10px; color: #94a3b8; text-align: center; font-size: 12px;">No matching plots found</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches.map(m => `
      <div class="search-item" data-pno="${m.properties.plot_no}">
        <div>
          <strong>Plot ${m.properties.plot_no}</strong>
          ${m.properties.is_corner ? '<span style="color: #f59e0b; margin-left: 4px;">⭐</span>' : ''}
          <span style="color: #64748b; font-size: 11px; margin-left: 6px;">${m.properties.dimensions}</span>
        </div>
        <div style="font-weight: 700; color: ${m.properties.status === 'Available' ? '#2ecc71' : (m.properties.status === 'Booked' ? '#f1c40f' : '#e74c3c')}">
          ${m.properties.status}
        </div>
      </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.search-item').forEach(item => {
      item.addEventListener('click', () => {
        const targetNo = item.dataset.pno;
        input.value = `Plot ${targetNo}`;
        dropdown.style.display = 'none';
        selectPlot(targetNo);
      });
    });
  }

  input.addEventListener('input', (e) => doSearch(e.target.value));

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    dropdown.style.display = 'none';
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function showToast(msg) {
  const toast = document.getElementById('toastPopup');
  const toastText = document.getElementById('toastText');
  toastText.textContent = msg;
  toast.style.display = 'flex';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 4500);
}

/**
 * 10. BOOTSTRAP APPLICATION
 */
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupUIListeners();

  // Load 10 Plots GeoJSON
  if (window.PLOTS_GEOJSON) {
    renderPlots(window.PLOTS_GEOJSON);
  } else {
    fetch('plots.geojson')
      .then(res => res.json())
      .then(data => renderPlots(data))
      .catch(err => console.error('Error loading plots.geojson:', err));
  }

  // Pre-select required showcase Plot 104 to demonstrate rich sidebar & corner banner
  setTimeout(() => {
    if (plotLayersMap.has('104')) {
      selectPlot('104');
    }
  }, 500);
});
