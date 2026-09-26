import cv2
import numpy as np
import json
import random

# Fix seed for reproducible, balanced randomization
random.seed(42)

# ==============================================================================
# 1. 6-POINT GROUND CONTROL TRANSFORMATION MATRIX (GCP) SOLVER
# ==============================================================================
gcps = [
  { 'label': 'Top-Left Park Corner', 'img': [14, 90], 'map': [15.330146085670561, 75.1702983832602] },
  { 'label': 'Top-Right Row Edge', 'img': [699, 105], 'map': [15.330301291921328, 75.17292694799194] },
  { 'label': 'Mid-Right Park Boundary', 'img': [988, 834], 'map': [15.327517908991947, 75.17483668073581] },
  { 'label': 'Bottom Road Tip Nose', 'img': [268, 1435], 'map': [15.325220814114056, 75.17154292819819] },
  { 'label': 'Inner Drop Corner Near Yoga Center', 'img': [515, 843], 'map': [15.327445478446883, 75.17331318607874] },
  { 'label': 'Central Main Road Intersection', 'img': [636, 509], 'map': [15.32866938226605, 75.17318997748359] }
]

A = []
lat_b = []
lng_b = []
for g in gcps:
    x, y = g['img']
    lat, lng = g['map']
    A.append([x, y, 1.0])
    lat_b.append(lat)
    lng_b.append(lng)

A = np.array(A)
lat_b = np.array(lat_b)
lng_b = np.array(lng_b)

lat_params, _, _, _ = np.linalg.lstsq(A, lat_b, rcond=None)
lng_params, _, _, _ = np.linalg.lstsq(A, lng_b, rcond=None)

def pixel_to_latlng(x, y):
    lat = lat_params[0] * x + lat_params[1] * y + lat_params[2]
    lng = lng_params[0] * x + lng_params[1] * y + lng_params[2]
    return [round(float(lng), 7), round(float(lat), 7)]

# ==============================================================================
# 2. COMPUTER VISION PLOT EXTRACTION PIPELINE
# ==============================================================================
im_rgba = cv2.imread('KJP_Layout_Outline.png', cv2.IMREAD_UNCHANGED)
alpha = im_rgba[:, :, 3]

# Grayscale & bilateral filter
gray = cv2.cvtColor(im_rgba[:, :, :3], cv2.COLOR_BGR2GRAY)
filtered = cv2.bilateralFilter(gray, 9, 75, 75)

# Binary mask: plots are transparent interior (alpha < 50) surrounded by black CAD lines
binary = (alpha < 50).astype(np.uint8) * 255

# Morphological opening to detach slight line touch artifacts
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
cleaned_binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

# Find all contours with hierarchy
contours, hierarchy = cv2.findContours(cleaned_binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
hier = hierarchy[0]

print(f"Total contours detected: {len(contours)}")

raw_plots = []
for i, cnt in enumerate(contours):
    area = cv2.contourArea(cnt)
    x, y, w, h = cv2.boundingRect(cnt)
    
    # Filter for single residential plots:
    # Area between 250 and 4500 pixels; width & height within single-plot range
    if 250 <= area <= 4500 and 12 <= w <= 110 and 12 <= h <= 80:
        aspect = max(w / h, h / w)
        if aspect <= 4.0:
            # Fit oriented bounding box to get crisp, clean 4 corners
            rect = cv2.minAreaRect(cnt)
            box = cv2.boxPoints(rect)
            box = np.intp(box)
            
            raw_plots.append({
                'id': i,
                'center_x': rect[0][0],
                'center_y': rect[0][1],
                'w': rect[1][0],
                'h': rect[1][1],
                'angle': rect[2],
                'area': area,
                'corners': box.tolist()
            })

print(f"Extracted plot polygons meeting size/geometry filters: {len(raw_plots)}")

# ==============================================================================
# 3. SPATIAL GRID INDEXING & CORRELATION
# ==============================================================================
# Sort plots spatially:
# Assign sector blocks:
# Sector A: Top row / northern sector (center_y < 260)
# Sector B: Main Central East/West grid (260 <= center_y < 780)
# Sector C: Central Cross-Road Promenade (780 <= center_y < 850)
# Sector D: Southern Wings (center_y >= 850)

# Sort all by y then x
raw_plots.sort(key=lambda p: (p['center_y'], p['center_x']))

# Cluster into spatial columns (within 35px threshold in X)
columns = []
current_col = []
sorted_by_x = sorted(raw_plots, key=lambda p: p['center_x'])

for p in sorted_by_x:
    if not current_col:
        current_col.append(p)
    else:
        avg_x = sum(item['center_x'] for item in current_col) / len(current_col)
        if abs(p['center_x'] - avg_x) < 32:
            current_col.append(p)
        else:
            current_col.sort(key=lambda item: item['center_y'])
            columns.append(current_col)
            current_col = [p]

if current_col:
    current_col.sort(key=lambda item: item['center_y'])
    columns.append(current_col)

print(f"Clustered into {len(columns)} spatial column strips.")

# ==============================================================================
# 4. METADATA & GEOJSON GENERATION
# ==============================================================================
features = []
plot_counter = 101

# Random status distribution: 70% Available, 15% Booked, 15% Sold
status_pool = (['Available'] * 70) + (['Booked'] * 15) + (['Sold'] * 15)

for col_idx, col in enumerate(columns):
    col_size = len(col)
    avg_col_x = sum(p['center_x'] for p in col) / col_size

    for row_idx, p in enumerate(col):
        # 1. Determine Plot Number
        plot_no = str(plot_counter)
        plot_counter += 1

        # 2. Determine is_corner algorithmically:
        # Top or bottom of a column strip, or near intersections
        is_corner = (row_idx == 0 or row_idx == col_size - 1 or p['center_y'] < 260 or (770 <= p['center_y'] <= 840))

        # 3. Determine Facing dynamically based on column position & road orientations:
        cy = p['center_y']
        cx = p['center_x']
        if 780 <= cy <= 850:
            # Horizontal promenade road
            facing = 'North-Facing' if cy < 815 else 'South-Facing'
        elif cy < 260:
            facing = 'South-Facing'
        else:
            # In vertical columns, determine whether road is to the East or West
            # Pairs of columns share roads: e.g. col 0 faces East, col 1 faces West, etc.
            facing = 'East-Facing' if (col_idx % 2 == 0) else 'West-Facing'

        # 4. Dimensions & Area
        area_px = p['area']
        if area_px > 1800:
            dimensions = "40 x 60 ft"
            area = "2400 sq ft"
            price = f"${random.randint(82, 98) * 1000:,}"
        elif area_px > 1100:
            dimensions = "30 x 50 ft"
            area = "1500 sq ft"
            price = f"${random.randint(58, 68) * 1000:,}"
        else:
            dimensions = "30 x 40 ft"
            area = "1200 sq ft"
            price = f"${random.randint(45, 54) * 1000:,}"

        # 5. Status
        status = random.choice(status_pool)

        # 6. Transform corners [X, Y] to geographic [Lat, Lng]
        corners_ll = [pixel_to_latlng(pt[0], pt[1]) for pt in p['corners']]
        # Close polygon
        if corners_ll[0] != corners_ll[-1]:
            corners_ll.append(corners_ll[0])

        feature = {
            'type': 'Feature',
            'properties': {
                'plot_no': plot_no,
                'dimensions': dimensions,
                'area': area,
                'price': price,
                'status': status,
                'facing': facing,
                'is_corner': bool(is_corner),
                'grid_ref': f"R{row_idx + 1}_C{col_idx + 1}"
            },
            'geometry': {
                'type': 'Polygon',
                'coordinates': [corners_ll]
            }
        }
        features.append(feature)

# Ensure Plot 104 is showcase plot
for f in features:
    if f['properties']['plot_no'] == '104':
        f['properties']['is_corner'] = True
        f['properties']['status'] = 'Sold'
        f['properties']['dimensions'] = '40 x 60 ft'
        f['properties']['area'] = '2400 sq ft'
        f['properties']['price'] = '$85,000'
        f['properties']['facing'] = 'North-Facing'

geojson = {
    'type': 'FeatureCollection',
    'features': features
}

# Write plots.geojson
with open('plots.geojson', 'w', encoding='utf-8') as f:
    json.dump(geojson, f, indent=2)

# Write plotsData.js
with open('plotsData.js', 'w', encoding='utf-8') as f:
    f.write('const PLOTS_GEOJSON = ' + json.dumps(geojson, indent=2) + ';\n')

print(f"\n==================================================================")
print(f"SUCCESS: Extracted and Georeferenced {len(features)} plots!")
print(f"Saved to 'plots.geojson' and 'plotsData.js'")
print(f"==================================================================")
