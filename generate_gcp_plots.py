import cv2
import numpy as np
import json

# 6-Point GCP Matrix from user:
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

def pixel_to_ll(x, y):
    lat = lat_params[0] * x + lat_params[1] * y + lat_params[2]
    lng = lng_params[0] * x + lng_params[1] * y + lng_params[2]
    return [round(float(lng), 7), round(float(lat), 7)]

# Load image to extract actual plot rectangles
im = cv2.imread('KJP_Layout_Outline.png', cv2.IMREAD_UNCHANGED)
alpha = im[:, :, 3]
binary = (alpha < 50).astype(np.uint8) * 255
contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

plots_found = []
for cnt in contours:
    x, y, w, h = cv2.boundingRect(cnt)
    area = cv2.contourArea(cnt)
    if 700 <= area <= 3500 and 24 <= w <= 65 and 18 <= h <= 55:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
        if len(approx) == 4:
            plots_found.append({'x': x, 'y': y, 'w': w, 'h': h, 'area': area, 'cnt': approx.reshape(-1, 2).tolist()})

plots_found.sort(key=lambda p: (p['y'] // 100, p['x']))

# Select 10 distinct plots across the blueprint
step = max(1, len(plots_found) // 10)
selected_plots = plots_found[::step][:10]

# Define 10 plot configurations per prompt requirements
plot_configs = [
    { 'plot_no': '101', 'dimensions': '30 x 40 ft', 'area': '1200 sq ft', 'price': '$48,000', 'status': 'Available', 'facing': 'East-Facing', 'is_corner': True },
    { 'plot_no': '102', 'dimensions': '30 x 50 ft', 'area': '1500 sq ft', 'price': '$58,000', 'status': 'Booked', 'facing': 'North-Facing', 'is_corner': False },
    { 'plot_no': '103', 'dimensions': '40 x 60 ft', 'area': '2400 sq ft', 'price': '$92,000', 'status': 'Available', 'facing': 'East-Facing', 'is_corner': False },
    { 'plot_no': '104', 'dimensions': '40 x 60 ft', 'area': '2400 sq ft', 'price': '$85,000', 'status': 'Sold', 'facing': 'North-Facing', 'is_corner': True },
    { 'plot_no': '105', 'dimensions': '35 x 45 ft', 'area': '1575 sq ft', 'price': '$62,000', 'status': 'Available', 'facing': 'West-Facing', 'is_corner': False },
    { 'plot_no': '106', 'dimensions': '30 x 40 ft', 'area': '1200 sq ft', 'price': '$45,000', 'status': 'Available', 'facing': 'South-Facing', 'is_corner': False },
    { 'plot_no': '107', 'dimensions': '30 x 50 ft', 'area': '1500 sq ft', 'price': '$55,000', 'status': 'Booked', 'facing': 'East-Facing', 'is_corner': True },
    { 'plot_no': '108', 'dimensions': '40 x 60 ft', 'area': '2400 sq ft', 'price': '$88,000', 'status': 'Sold', 'facing': 'North-Facing', 'is_corner': False },
    { 'plot_no': '109', 'dimensions': '35 x 50 ft', 'area': '1750 sq ft', 'price': '$69,000', 'status': 'Available', 'facing': 'West-Facing', 'is_corner': False },
    { 'plot_no': '110', 'dimensions': '50 x 80 ft', 'area': '4000 sq ft', 'price': '$145,000', 'status': 'Available', 'facing': 'East-Facing', 'is_corner': True },
]

features = []
for i, cfg in enumerate(plot_configs):
    p = selected_plots[i]
    pts = p['cnt']
    coords = [pixel_to_ll(pt[0], pt[1]) for pt in pts]
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    
    features.append({
        'type': 'Feature',
        'properties': cfg,
        'geometry': {
            'type': 'Polygon',
            'coordinates': [coords]
        }
    })

geojson = {
    'type': 'FeatureCollection',
    'features': features
}

with open('plots.geojson', 'w', encoding='utf-8') as f:
    json.dump(geojson, f, indent=2)

with open('plotsData.js', 'w', encoding='utf-8') as f:
    f.write('const PLOTS_GEOJSON = ' + json.dumps(geojson, indent=2) + ';\n')

print(f"Generated {len(features)} plots with exact 6-point affine projection.")
