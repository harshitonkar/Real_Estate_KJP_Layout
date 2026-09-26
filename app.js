/**
 * KJP Layout • Spacer Interactive 3D Plot Viewing Platform Engine
 * Advanced 6-Point GCP Affine Projection, 3D Perspective, Live GPS, Dynamic Inventory Filters & WhatsApp CTA
 */

// ==============================================================================
// 1. IMMUTABLE 6-POINT GROUND CONTROL TRANSFORMATION MATRIX (At absolute top)
// ==============================================================================
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

// Masterplan Geographic Bounding Box
const MASTERPLAN_BOUNDS = L.latLngBounds(GCP_MAPPING_MATRIX.map(g => g.map));

// Masterplan Exact Outer Boundary Polygon (13 Coordinates derived from CAD blueprint contour)
const LAYOUT_PERIMETER_POLYGON = Object.freeze([
  Object.freeze([15.3301726, 75.1702594]),
  Object.freeze([15.3294822, 75.1703478]),
  Object.freeze([15.3295084, 75.1712804]),
  Object.freeze([15.3255531, 75.1716053]),
  Object.freeze([15.3255938, 75.1714859]),
  Object.freeze([15.3254185, 75.1714063]),
  Object.freeze([15.3251961, 75.1718945]),
  Object.freeze([15.3252685, 75.1728578]),
  Object.freeze([15.3274460, 75.1727281]),
  Object.freeze([15.3275385, 75.1748729]),
  Object.freeze([15.3297924, 75.1744694]),
  Object.freeze([15.3297483, 75.1733524]),
  Object.freeze([15.3302297, 75.1732899])
]);

// Application State
const appState = {
  // Filters
  filterStatus: 'all',       // 'all' | 'Available' | 'Booked' | 'Sold'
  filterFacing: 'all',       // 'all' | 'East-Facing' | 'North-Facing' | etc.
  filterCategory: 'all',     // 'all' | 'corner' | 'standard'
  filterMinArea: 0,          // minimum area threshold

  // Selection & UI
  selectedPlotNo: null,
  areaUnit: 'sqft',          // 'sqft' | 'sqyd'
  is3dMode: false,
  isGpsActive: false,
  isMeasureMode: false,
  measurePoints: [],
  measureGraphicLayers: [],

  // Spotlight Map Mask (80% black background, 100% transparent aperture)
  isSpotlightActive: true,
  spotlightOpacity: 0.80,

  // Overlay settings
  blueprintOpacity: 0.85,
  blueprintTheme: 'white',
  showLabels: false,
  forceLabels: false,
  plots: []
};

// Global Map References
let map;
let gcpBlueprintLayer;
let spotlightMask;
let plotsLayerGroup;
let labelsLayerGroup;
let gpsMarkerGroup;
let measureLayerGroup;
let plotLayersMap = new Map(); // plot_no -> Leaflet Layer

/**
 * 2. ALGEBRAIC AFFINE MATRIX TRANSFORMATION SOLVER (Least-Squares for N=6)
 */
function computeAffineTransform(points) {
  const n = points.length;
  if (n < 3) throw new Error('At least 3 GCPs required.');

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
  if (Math.abs(det) < 1e-12) throw new Error('Singular matrix');

  const invDet = 1.0 / det;
  const inv00 = c00 * invDet, inv01 = c10 * invDet, inv02 = c20 * invDet;
  const inv10 = c01 * invDet, inv11 = c11 * invDet, inv12 = c21 * invDet;
  const inv20 = c02 * invDet, inv21 = c12 * invDet, inv22 = c22 * invDet;

  const a = inv00 * bu0 + inv01 * bu1 + inv02 * bu2;
  const c = inv10 * bu0 + inv11 * bu1 + inv12 * bu2;
  const tx = inv20 * bu0 + inv21 * bu1 + inv22 * bu2;

  const b = inv00 * bv0 + inv01 * bv1 + inv02 * bv2;
  const d = inv10 * bv0 + inv11 * bv1 + inv12 * bv2;
  const ty = inv20 * bv0 + inv21 * bv1 + inv22 * bv2;

  return { a, b, c, d, tx, ty };
}

/**
 * 3. CUSTOM LEAFLET CSS3 3D AFFINE OVERLAY LAYER
 */
const AffineGcpBlueprintLayer = L.Layer.extend({
  initialize: function(imageUrl, gcpMatrix, options) {
    this._imageUrl = imageUrl;
    this._gcpMatrix = gcpMatrix;
    this._options = options || { opacity: 0.85 };
  },

  onAdd: function(map) {
    this._map = map;
    if (!this._image) this._initImage();
    map.getPanes().overlayPane.appendChild(this._image);

    map.on('viewreset move zoom zoomend', this._update, this);
    this._update();
  },

  onRemove: function(map) {
    if (this._image && this._image.parentNode) {
      this._image.parentNode.removeChild(this._image);
    }
    map.off('viewreset move zoom zoomend', this._update, this);
  },

  _initImage: function() {
    const img = L.DomUtil.create('img', 'gcp-blueprint-layer blueprint-theme-white');
    img.src = this._imageUrl;
    img.style.position = 'absolute';
    img.style.transformOrigin = '0 0';
    img.style.pointerEvents = 'none';
    img.style.opacity = this._options.opacity;
    this._image = img;
  },

  setOpacity: function(opacity) {
    this._options.opacity = opacity;
    if (this._image) this._image.style.opacity = opacity;
  },

  setTheme: function(theme) {
    if (!this._image) return;
    this._image.classList.remove('blueprint-theme-white', 'blueprint-theme-black', 'blueprint-theme-cyan');
    this._image.classList.add(`blueprint-theme-${theme}`);
  },

  _update: function() {
    if (!this._map || !this._image) return;

    const pointPairs = this._gcpMatrix.map(pt => {
      const layerPoint = this._map.latLngToLayerPoint(L.latLng(pt.map[0], pt.map[1]));
      return { x: pt.image[0], y: pt.image[1], u: layerPoint.x, v: layerPoint.y };
    });

    const { a, b, c, d, tx, ty } = computeAffineTransform(pointPairs);
    const matrix3d = `matrix3d(${a.toFixed(8)}, ${b.toFixed(8)}, 0, 0, ${c.toFixed(8)}, ${d.toFixed(8)}, 0, 0, 0, 0, 1, 0, ${tx.toFixed(4)}, ${ty.toFixed(4)}, 0, 1)`;
    this._image.style.transform = matrix3d;
  }
});

/**
 * 4. DYNAMIC SPOTLIGHT MAP MASK ENGINE (HTML5 Canvas Compositing)
 * Covers the entire screen/map viewport with an 80% opacity dark overlay (rgba(0, 0, 0, 0.8)),
 * cutting out a 100% transparent, bright aperture perfectly conforming to the layout perimeter.
 * Dynamically tracks panning, zooming, dragging, and scaling with zero lag.
 */
class SpotlightMapMask {
  constructor(map, polygonLatLngs, options = {}) {
    this.map = map;
    this.polygonLatLngs = polygonLatLngs;
    this.opacity = options.opacity !== undefined ? options.opacity : 0.8;
    this.feather = options.feather !== undefined ? options.feather : 2;
    this.enabled = options.enabled !== undefined ? options.enabled : true;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'spotlight-canvas-mask';
    this.ctx = this.canvas.getContext('2d', { alpha: true });

    this._initCanvas();
    this._bindEvents();
    this.render();
  }

  _initCanvas() {
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.willChange = 'transform';

    // Mount inside dedicated Leaflet map pane
    if (!this.map.getPane('spotlightPane')) {
      const pane = this.map.createPane('spotlightPane');
      pane.style.zIndex = 240; // Positioned directly above satellite base tiles (200), below blueprint (250) and vectors (400)
      pane.style.pointerEvents = 'none';
    }
    this.map.getPane('spotlightPane').appendChild(this.canvas);
  }

  _bindEvents() {
    this._onMove = () => this.requestRender();
    this.map.on('move zoom viewreset resize zoomanim', this._onMove);
    window.addEventListener('resize', this._onMove);
  }

  requestRender() {
    if (this._animId) return;
    this._animId = requestAnimationFrame(() => {
      this._animId = null;
      this.render();
    });
  }

  render() {
    if (!this.enabled || this.opacity <= 0.01) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const size = this.map.getSize();
    const width = size.x;
    const height = size.y;

    // Synchronize canvas DOM element position with viewport container origin
    const topLeft = this.map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);

    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Clear previous frame
    ctx.clearRect(0, 0, width, height);

    // 2. Cover entire map viewport with black overlay: rgba(0, 0, 0, 0.8)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0, 0, 0, ${this.opacity})`;
    ctx.fillRect(0, 0, width, height);

    // 3. Switch to 'destination-out' to punch 100% transparent spotlight aperture
    ctx.globalCompositeOperation = 'destination-out';

    // 4. Project geographic polygon coordinates to current screen container pixels
    const screenPoints = this.polygonLatLngs.map(latlng => {
      return this.map.latLngToContainerPoint(L.latLng(latlng[0], latlng[1]));
    });

    if (screenPoints.length > 2) {
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.closePath();

      // Punch 100% transparent hole directly through to the layout map
      ctx.fillStyle = '#000000';
      ctx.fill();

      // Soft crisp boundary edge feathering
      if (this.feather > 0) {
        ctx.lineWidth = this.feather;
        ctx.strokeStyle = '#000000';
        ctx.stroke();
      }
    }

    // 5. Subtle vector perimeter accent glow around the spotlight boundary
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.stroke();

    ctx.restore();
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    this.requestRender();
  }

  setPolygon(polygonLatLngs) {
    this.polygonLatLngs = polygonLatLngs;
    this.requestRender();
  }

  toggle(enabled) {
    this.enabled = enabled !== undefined ? enabled : !this.enabled;
    this.requestRender();
  }

  destroy() {
    this.map.off('move zoom viewreset resize zoomanim', this._onMove);
    window.removeEventListener('resize', this._onMove);
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

/**
 * 4. INITIALIZE MAP ENGINE
 */
function initMap() {
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

  // Esri World Imagery Satellite Tile Layer
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri &mdash; Spacer GIS Engine',
      maxNativeZoom: 19,
      maxZoom: 21
    }
  ).addTo(map);

  // Esri Boundaries & Geographic Places Reference
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 19, maxZoom: 21, opacity: 0.75 }
  ).addTo(map);

  // Layer Groups
  plotsLayerGroup = L.layerGroup().addTo(map);
  labelsLayerGroup = L.layerGroup();
  gpsMarkerGroup = L.layerGroup().addTo(map);
  measureLayerGroup = L.layerGroup().addTo(map);

  // Mount Dynamic Spotlight Map Mask (80% black background, 100% transparent layout aperture)
  spotlightMask = new SpotlightMapMask(map, LAYOUT_PERIMETER_POLYGON, {
    opacity: appState.spotlightOpacity,
    enabled: appState.isSpotlightActive
  });

  // Mount 6-Point GCP Blueprint Overlay
  gcpBlueprintLayer = new AffineGcpBlueprintLayer('KJP_Layout_Outline.png', GCP_MAPPING_MATRIX, {
    opacity: appState.blueprintOpacity
  });
  gcpBlueprintLayer.addTo(map);

  // Smart Zoom Listener for labels
  map.on('zoomend', () => {
    if (appState.forceLabels || (appState.showLabels && map.getZoom() >= 18)) {
      if (!map.hasLayer(labelsLayerGroup)) map.addLayer(labelsLayerGroup);
    } else if (!appState.forceLabels && map.getZoom() < 18) {
      if (map.hasLayer(labelsLayerGroup)) map.removeLayer(labelsLayerGroup);
    }
  });

  // Click on map canvas
  map.on('click', function(e) {
    if (appState.isMeasureMode) {
      handleMeasureClick(e.latlng);
      return;
    }
    if (e.originalEvent.target.classList.contains('leaflet-container') || e.originalEvent.target.id === 'map') {
      closeSidebar();
    }
  });
}

/**
 * 5. DYNAMIC PLOT STYLING (Available: Emerald, Booked: Amber, Sold: Ruby)
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

function getPlotSelectedStyle() {
  return {
    fillColor: '#38bdf8',
    fillOpacity: 0.72,
    weight: 4.0,
    color: '#ffffff'
  };
}

/**
 * 6. RENDER PLOTS & INSTANT INVENTORY FILTER QUERY EXECUTION
 * Spacer Pattern: Non-matching plots visually fade (drop opacity) while matching plots remain highlighted.
 */
function renderPlots(geojsonData) {
  plotsLayerGroup.clearLayers();
  labelsLayerGroup.clearLayers();
  plotLayersMap.clear();

  appState.plots = geojsonData.features;
  updateKpiBadges();

  const geoJsonLayer = L.geoJSON(geojsonData, {
    style: function(feature) {
      const match = matchesFilters(feature);
      if (!match) {
        return {
          fillColor: '#64748b',
          fillOpacity: 0.04,
          weight: 0.5,
          color: 'rgba(255,255,255,0.06)'
        };
      }
      return getPlotBaseStyle(feature);
    },
    onEachFeature: function(feature, layer) {
      const props = feature.properties;
      plotLayersMap.set(props.plot_no, layer);

      const isMatch = matchesFilters(feature);
      if (!isMatch) {
        // Dimmed plot
        if (layer.getElement()) {
          layer.getElement().classList.add('plot-dimmed');
        }
        return;
      }

      // Tooltip
      const cornerTag = props.is_corner ? '⭐ Corner' : '';
      layer.bindTooltip(`
        <div style="font-weight: 800; font-size: 13px;">Plot ${props.plot_no} ${cornerTag}</div>
        <div style="font-size: 11px; opacity: 0.9; margin-top: 1px;">${props.status} &bull; ${props.dimensions}</div>
        <div style="font-size: 12px; color: #38bdf8; font-weight: 700; margin-top: 2px;">${props.price}</div>
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
            iconSize: [36, 16]
          }),
          interactive: false
        });
        labelsLayerGroup.addLayer(labelMarker);
      }

      // Hover and Click Listeners
      layer.on({
        mouseover: function(e) {
          if (appState.selectedPlotNo !== props.plot_no) {
            e.target.setStyle(getPlotHoverStyle(feature));
            e.target.bringToFront();
          }
        },
        mouseout: function(e) {
          if (appState.selectedPlotNo !== props.plot_no) {
            e.target.setStyle(getPlotBaseStyle(feature));
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
 * Filter Matching Evaluation
 */
function matchesFilters(feature) {
  const p = feature.properties;

  // Status Filter
  if (appState.filterStatus !== 'all' && p.status !== appState.filterStatus) {
    return false;
  }

  // Facing Filter
  if (appState.filterFacing !== 'all' && p.facing !== appState.filterFacing) {
    return false;
  }

  // Category Filter
  if (appState.filterCategory === 'corner' && !p.is_corner) {
    return false;
  }
  if (appState.filterCategory === 'standard' && p.is_corner) {
    return false;
  }

  // Minimum Area Threshold
  if (appState.filterMinArea > 0) {
    const areaVal = parseInt(p.area.replace(/\D/g, '')) || 0;
    if (areaVal < appState.filterMinArea) return false;
  }

  return true;
}

/**
 * 7. SPACER PLOT DETAIL PANEL SELECTION & DATA POPULATION
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

  // Highlight selected plot
  layer.setStyle(getPlotSelectedStyle());
  layer.bringToFront();

  // Smooth Contextual Auto-Focus: Ease-in-out camera translation matrix
  if (layer.getBounds) {
    map.flyToBounds(layer.getBounds(), {
      padding: [100, 100],
      maxZoom: 19,
      duration: 1.0
    });
  }

  // Update Detail Panel Metrics
  document.getElementById('sidePlotNumber').textContent = `Plot ${props.plot_no}`;
  document.getElementById('sideSectorTag').textContent = props.grid_ref ? `SECTOR ${props.grid_ref}` : 'RESIDENTIAL PARCEL';
  document.getElementById('sidePrice').textContent = props.price;
  document.getElementById('sideDimensions').textContent = props.dimensions;
  document.getElementById('sideFacing').textContent = props.facing;

  // Road width dynamic estimation
  const roadWidth = props.is_corner ? '40 ft Asphalt Boulevard' : '30 ft Internal Roadway';
  document.getElementById('sideRoadWidth').textContent = roadWidth;

  // Area & Units formatting
  updateAreaDisplay(props.area);

  // Status Badge
  const statusBadge = document.getElementById('sideStatusBadge');
  statusBadge.textContent = props.status;
  statusBadge.className = `status-pill status-${props.status.toLowerCase()}`;

  // Golden Corner Banner Header
  const cornerBanner = document.getElementById('cornerPremiumBanner');
  if (props.is_corner) {
    cornerBanner.style.display = 'flex';
  } else {
    cornerBanner.style.display = 'none';
  }

  // Pre-fill booking modal
  document.getElementById('modalPlotTitle').textContent = `Plot ${props.plot_no}`;
  document.getElementById('modalSummaryPlot').textContent = `Plot ${props.plot_no}`;
  document.getElementById('modalSummaryDims').textContent = `${props.dimensions} (${props.area})`;
  document.getElementById('modalSummaryPrice').textContent = props.price;

  // Open Drawer / Sidebar Panel
  document.getElementById('propertySidebar').classList.add('open');
}

/**
 * Format Area according to Sq Ft vs Sq Yd Toggle
 */
function updateAreaDisplay(rawAreaStr) {
  const areaSqFt = parseInt(rawAreaStr.replace(/\D/g, '')) || 1200;
  const areaElement = document.getElementById('sideArea');
  const rateCalc = document.getElementById('sideRateCalc');

  if (appState.areaUnit === 'sqyd') {
    const sqYd = (areaSqFt / 9).toFixed(1);
    areaElement.textContent = `${sqYd} sq yd (${areaSqFt} sq ft)`;
    rateCalc.textContent = `Approx. $${(85000 / sqYd).toFixed(0)} / sq yd`;
  } else {
    areaElement.textContent = `${areaSqFt.toLocaleString()} sq ft`;
    const ratePerSqFt = (85000 / areaSqFt).toFixed(2);
    rateCalc.textContent = `Approx. $${ratePerSqFt} / sq ft`;
  }
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
 * 8. VIEWPORT CONTROL HUD (3D Tilt, Live GPS, Ruler Measurement, Reset View)
 */
function setupViewportHud() {
  // 1. 3D Perspective Isometric Tilt
  const tilt3dBtn = document.getElementById('hudTilt3dBtn');
  const mapElement = document.getElementById('map');

  tilt3dBtn.addEventListener('click', () => {
    appState.is3dMode = !appState.is3dMode;
    tilt3dBtn.classList.toggle('active', appState.is3dMode);
    mapElement.classList.toggle('perspective-3d', appState.is3dMode);
    showToast(appState.is3dMode ? '3D Perspective Isometric View Activated' : 'Top-Down Orthographic View Restored');
  });

  // 2. Live GPS Mode ("My Location" On-Site Navigation)
  const gpsBtn = document.getElementById('hudGpsBtn');
  let gpsWatchId = null;

  gpsBtn.addEventListener('click', () => {
    appState.isGpsActive = !appState.isGpsActive;
    gpsBtn.classList.toggle('active', appState.isGpsActive);

    if (appState.isGpsActive) {
      if ('geolocation' in navigator) {
        showToast('Acquiring high-precision GPS lock...');
        gpsWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            const userLatLng = [pos.coords.latitude, pos.coords.longitude];
            renderGpsMarker(userLatLng, pos.coords.accuracy);
            map.flyTo(userLatLng, 18, { duration: 1.2 });
            showToast('GPS Lock Active: Location synchronized on masterplan');
          },
          () => {
            // Simulated fallback to on-site center if location permission blocked or on desktop
            const simulatedOnSite = [15.328669, 75.173189];
            renderGpsMarker(simulatedOnSite, 10);
            map.flyTo(simulatedOnSite, 18, { duration: 1.2 });
            showToast('GPS Simulation Mode: Centered on layout ground location');
          },
          { enableHighAccuracy: true, timeout: 5000 }
        );
      }
    } else {
      if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
      gpsMarkerGroup.clearLayers();
      showToast('Live GPS Mode Disabled');
    }
  });

  function renderGpsMarker(latlng, accuracy) {
    gpsMarkerGroup.clearLayers();
    const pulseMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'gps-user-marker',
        html: `<div class="gps-pulse-circle"></div><div class="gps-dot"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    });
    const circle = L.circle(latlng, { radius: Math.min(accuracy || 15, 30), color: '#3b82f6', fillOpacity: 0.1, weight: 1 });
    gpsMarkerGroup.addLayer(circle);
    gpsMarkerGroup.addLayer(pulseMarker);
  }

  // 3. Linear Dimension Measurement Tool (Ruler)
  const measureBtn = document.getElementById('hudMeasureBtn');
  const measureHud = document.getElementById('measurementHud');
  const exitMeasureBtn = document.getElementById('exitMeasureBtn');

  measureBtn.addEventListener('click', () => {
    appState.isMeasureMode = !appState.isMeasureMode;
    measureBtn.classList.toggle('active', appState.isMeasureMode);
    if (appState.isMeasureMode) {
      measureHud.style.display = 'flex';
      appState.measurePoints = [];
      measureLayerGroup.clearLayers();
      document.getElementById('measInstruction').textContent = 'Click 2 points on the map to measure linear ground distance';
    } else {
      clearMeasureTool();
    }
  });

  exitMeasureBtn.addEventListener('click', clearMeasureTool);

  function clearMeasureTool() {
    appState.isMeasureMode = false;
    measureBtn.classList.remove('active');
    measureHud.style.display = 'none';
    measureLayerGroup.clearLayers();
    appState.measurePoints = [];
  }

  // 4. Reset Orientation & Camera Home
  const compassBtn = document.getElementById('hudCompassBtn');
  compassBtn.addEventListener('click', () => {
    map.flyToBounds(MASTERPLAN_BOUNDS, { padding: [50, 50], duration: 1.2 });
    showToast('Camera reset to masterplan center');
  });

  // 5. Spotlight Mask HUD Button Toggle
  const spotlightBtn = document.getElementById('hudSpotlightBtn');
  spotlightBtn?.addEventListener('click', () => {
    appState.isSpotlightActive = !appState.isSpotlightActive;
    spotlightBtn.classList.toggle('active', appState.isSpotlightActive);
    spotlightMask?.toggle(appState.isSpotlightActive);
    showToast(appState.isSpotlightActive ? 'Spotlight Mask Active (80% Dark Background)' : 'Spotlight Mask Disabled');
  });

  // 6. Blueprint Layer Popover Toggle
  const blueprintBtn = document.getElementById('hudBlueprintBtn');
  const blueprintPopover = document.getElementById('blueprintPopover');
  const closeBlueprintPopoverBtn = document.getElementById('closeBlueprintPopoverBtn');

  blueprintBtn.addEventListener('click', () => {
    const isVisible = blueprintPopover.style.display === 'block';
    blueprintPopover.style.display = isVisible ? 'none' : 'block';
    blueprintBtn.classList.toggle('active', !isVisible);
  });

  closeBlueprintPopoverBtn.addEventListener('click', () => {
    blueprintPopover.style.display = 'none';
    blueprintBtn.classList.remove('active');
  });
}

/**
 * Handle Linear Distance Measurement on Map Click
 */
function handleMeasureClick(latlng) {
  appState.measurePoints.push(latlng);

  // Add pin marker
  const marker = L.circleMarker(latlng, {
    radius: 5,
    fillColor: '#06b6d4',
    fillOpacity: 1,
    color: '#ffffff',
    weight: 2
  });
  measureLayerGroup.addLayer(marker);

  if (appState.measurePoints.length === 2) {
    const p1 = appState.measurePoints[0];
    const p2 = appState.measurePoints[1];
    const distMeters = p1.distanceTo(p2);
    const distFeet = (distMeters * 3.28084).toFixed(1);

    const polyline = L.polyline([p1, p2], {
      color: '#06b6d4',
      weight: 3,
      dashArray: '6, 6'
    });
    measureLayerGroup.addLayer(polyline);

    // Center distance badge
    const midLat = (p1.lat + p2.lat) / 2;
    const midLng = (p1.lng + p2.lng) / 2;
    const distMarker = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: 'dist-readout-badge',
        html: `<div style="background: rgba(14,20,34,0.95); border: 1px solid #06b6d4; padding: 4px 8px; border-radius: 6px; font-weight: 700; color: #67e8f9; font-size: 11px; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">${distFeet} ft (${distMeters.toFixed(1)} m)</div>`,
        iconSize: [120, 24]
      })
    });
    measureLayerGroup.addLayer(distMarker);

    document.getElementById('measInstruction').textContent = `Distance: ${distFeet} ft (${distMeters.toFixed(1)} m). Click again to measure a new line.`;
    appState.measurePoints = [];
  }
}

/**
 * 9. INVENTORY FILTER MECHANICS & DRAWER
 */
function setupInventoryFilters() {
  // Top Navbar Status Chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      appState.filterStatus = chip.dataset.status;
      applyFilters();
    });
  });

  // Toggle Advanced Filter Drawer
  const toggleDrawerBtn = document.getElementById('toggleFilterDrawerBtn');
  const drawer = document.getElementById('advancedFilterDrawer');
  const closeDrawerBtn = document.getElementById('closeFilterDrawerBtn');

  toggleDrawerBtn.addEventListener('click', () => {
    const isVisible = drawer.style.display === 'block';
    drawer.style.display = isVisible ? 'none' : 'block';
  });

  closeDrawerBtn.addEventListener('click', () => {
    drawer.style.display = 'none';
  });

  // Facing Chips
  document.querySelectorAll('.facing-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.facing-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      appState.filterFacing = chip.dataset.facing;
      applyFilters();
    });
  });

  // Category Toggle (All, Corner, Standard)
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      appState.filterCategory = pill.dataset.category;
      applyFilters();
    });
  });

  // Minimum Area Range Slider
  const areaSlider = document.getElementById('minAreaSlider');
  const areaDisplay = document.getElementById('minAreaDisplay');
  areaSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    appState.filterMinArea = val > 1000 ? val : 0;
    areaDisplay.textContent = val > 1000 ? `≥ ${val} sq ft` : 'All Sizes';
    applyFilters();
  });

  // Reset Filters
  document.getElementById('resetAllFiltersBtn').addEventListener('click', () => {
    appState.filterStatus = 'all';
    appState.filterFacing = 'all';
    appState.filterCategory = 'all';
    appState.filterMinArea = 0;

    // Reset UI
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.status === 'all'));
    document.querySelectorAll('.facing-chip').forEach(c => c.classList.toggle('active', c.dataset.facing === 'all'));
    document.querySelectorAll('.cat-pill').forEach(c => c.classList.toggle('active', c.dataset.category === 'all'));
    areaSlider.value = 1000;
    areaDisplay.textContent = 'All Sizes';

    applyFilters();
    showToast('Filters reset to default view');
  });

  function applyFilters() {
    if (window.PLOTS_GEOJSON) {
      renderPlots(window.PLOTS_GEOJSON);
    }
  }
}

/**
 * 10. PLOT DETAIL ACTIONS: WHATSAPP CTA, SITE VISIT MODAL, SQ FT / SQ YD TOGGLE
 */
function setupDetailPanelActions() {
  // Close Sidebar Button
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);

  // Unit Toggle (Sq Ft ⇄ Sq Yd)
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.areaUnit = btn.dataset.unit;
      const currentProps = plotLayersMap.get(appState.selectedPlotNo)?.feature?.properties;
      if (currentProps) {
        updateAreaDisplay(currentProps.area);
      }
    });
  });

  // Sticky CTA: Inquire on WhatsApp
  document.getElementById('ctaWhatsappBtn').addEventListener('click', () => {
    const plotNo = appState.selectedPlotNo || '104';
    const msg = encodeURIComponent(`Hi! I am interested in inquiring about ${plotNo} at KJP Layout. Please share availability and payment schedule.`);
    const waUrl = `https://wa.me/?text=${msg}`;
    window.open(waUrl, '_blank');
  });

  // Sticky CTA: Book Site Visit Modal
  const modalBackdrop = document.getElementById('bookingModalBackdrop');
  const bookingBtn = document.getElementById('ctaBookingBtn');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const bookingForm = document.getElementById('bookingForm');

  bookingBtn.addEventListener('click', () => {
    modalBackdrop.style.display = 'flex';
  });

  function closeModal() {
    modalBackdrop.style.display = 'none';
  }

  modalCloseBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('leadName').value;
    const date = document.getElementById('visitDate').value;
    closeModal();
    showToast(`Thank you, ${name}! Your site inspection for ${date} has been registered.`);
    bookingForm.reset();
  });

  // Download Brochure Action
  document.getElementById('downloadBrochureBtn').addEventListener('click', () => {
    window.print();
  });

  // Keyboard shortcut: ESC closes all modals & drawers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeSidebar();
      document.getElementById('advancedFilterDrawer').style.display = 'none';
      document.getElementById('blueprintPopover').style.display = 'none';
    }
  });
}

/**
 * 11. BLUEPRINT OVERLAY CONTROLS (Opacity & Themes)
 */
function setupBlueprintControls() {
  const slider = document.getElementById('blueprintOpacitySlider');
  slider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value) / 100;
    appState.blueprintOpacity = val;
    gcpBlueprintLayer.setOpacity(val);
    document.getElementById('opacityDisplay').textContent = `${Math.round(val * 100)}%`;
    document.querySelectorAll('.opacity-preset').forEach(b => b.classList.remove('active'));
  });

  document.querySelectorAll('.opacity-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.opacity-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = parseFloat(btn.dataset.val) / 100;
      slider.value = btn.dataset.val;
      appState.blueprintOpacity = val;
      gcpBlueprintLayer.setOpacity(val);
      document.getElementById('opacityDisplay').textContent = `${btn.dataset.val}%`;
    });
  });

  document.querySelectorAll('.theme-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.theme-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      gcpBlueprintLayer.setTheme(chip.dataset.theme);
    });
  });

  // Spotlight Mask Darkness Slider & Presets
  const spotlightSlider = document.getElementById('spotlightOpacitySlider');
  const spotlightDisplay = document.getElementById('spotlightDisplay');

  spotlightSlider?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value) / 100;
    appState.spotlightOpacity = val;
    spotlightMask?.setOpacity(val);
    if (spotlightDisplay) spotlightDisplay.textContent = `${Math.round(val * 100)}% Dark`;
    document.querySelectorAll('.mask-preset').forEach(b => b.classList.remove('active'));
  });

  document.querySelectorAll('.mask-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mask-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = parseFloat(btn.dataset.val) / 100;
      if (spotlightSlider) spotlightSlider.value = btn.dataset.val;
      appState.spotlightOpacity = val;
      spotlightMask?.setOpacity(val);
      if (spotlightDisplay) spotlightDisplay.textContent = `${btn.dataset.val}% Dark`;
    });
  });
}

/**
 * 12. SEARCH AUTOCOMPLETE ENGINE
 */
function setupSearch() {
  const input = document.getElementById('plotSearchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
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
    }).slice(0, 15);

    if (matches.length === 0) {
      dropdown.innerHTML = `<div style="padding: 10px; color: #94a3b8; text-align: center; font-size: 12px;">No matching plots found</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches.map(m => `
      <div class="search-result-row" data-pno="${m.properties.plot_no}">
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

    dropdown.querySelectorAll('.search-result-row').forEach(row => {
      row.addEventListener('click', () => {
        const targetNo = row.dataset.pno;
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

function showToast(msg) {
  const toast = document.getElementById('toastNotification');
  const toastMsg = document.getElementById('toastMessage');
  toastMsg.textContent = msg;
  toast.style.display = 'flex';
  setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

/**
 * 13. BOOTSTRAP SPACER PLATFORM
 */
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupViewportHud();
  setupInventoryFilters();
  setupDetailPanelActions();
  setupBlueprintControls();
  setupSearch();

  // Load 341 Plots GeoJSON
  if (window.PLOTS_GEOJSON) {
    renderPlots(window.PLOTS_GEOJSON);
  } else {
    fetch('plots.geojson')
      .then(res => res.json())
      .then(data => renderPlots(data))
      .catch(err => console.error('Error loading plots.geojson:', err));
  }

  // Pre-select Plot 104 to showcase the rich detail panel
  setTimeout(() => {
    if (plotLayersMap.has('104')) {
      selectPlot('104');
    }
  }, 600);
});
