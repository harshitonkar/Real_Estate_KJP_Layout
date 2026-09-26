import cv2
import numpy as np
import json
import random

# Georeferenced bounding box strictly provided:
# [[15.330144270045299, 75.17031642578027], [15.325156914381514, 75.17219397212556]]
NW_lat = 15.330144270045299
NW_lng = 75.17031642578027
SE_lat = 15.325156914381514
SE_lng = 75.17219397212556

W = 1014.0
H = 1550.0

def pixel_to_ll(x, y):
    lng = NW_lng + (float(x) / W) * (SE_lng - NW_lng)
    lat = NW_lat - (float(y) / H) * (NW_lat - SE_lat)
    return [round(lng, 7), round(lat, 7)]

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

# Sort top-to-bottom, left-to-right
plots_found.sort(key=lambda p: (p['y'] // 70, p['x']))
print(f'Total candidate plots found: {len(plots_found)}')

# Pick 25 nicely distributed plots
step = max(1, len(plots_found) // 25)
selected = plots_found[::step][:25]

plot_numbers = [
    42, 101, 104, 107, 110, 115, 118, 122, 126, 130,
    201, 205, 208, 212, 216, 220, 225, 230,
    301, 305, 310, 314, 318, 322, 326
]

dim_choices = ['30x40 sq ft', '30x50 sq ft', '40x60 sq ft', '35x45 sq ft']
facing_choices = ['East-Facing', 'North-Facing', 'West-Facing', 'South-Facing']

features = []
for idx, p in enumerate(selected):
    pid_num = plot_numbers[idx] if idx < len(plot_numbers) else 100 + idx
    is_corner = bool(idx in [0, 4, 8, 11, 15, 18, 22])
    
    if idx == 0:
        plot_id = 'Plot 42'
        dimensions = '30x40 sq ft'
        price = '₹45,000'
        status = 'Available'
        facing = 'East-Facing'
        is_corner = True
    elif idx % 3 == 0:
        status = 'Sold'
        plot_id = f'Plot {pid_num}'
        dimensions = dim_choices[idx % len(dim_choices)]
        price = f'₹{48000 + idx * 1500:,}'
        facing = facing_choices[idx % len(facing_choices)]
    elif idx % 4 == 0:
        status = 'Booked'
        plot_id = f'Plot {pid_num}'
        dimensions = dim_choices[idx % len(dim_choices)]
        price = f'₹{46000 + idx * 1200:,}'
        facing = facing_choices[idx % len(facing_choices)]
    else:
        status = 'Available'
        plot_id = f'Plot {pid_num}'
        dimensions = dim_choices[idx % len(dim_choices)]
        price = f'₹{45000 + idx * 1000:,}'
        facing = facing_choices[idx % len(facing_choices)]

    pts = p['cnt']
    coords = [pixel_to_ll(pt[0], pt[1]) for pt in pts]
    if coords[0] != coords[-1]:
        coords.append(coords[0])

    features.append({
        'type': 'Feature',
        'properties': {
            'plot_id': plot_id,
            'dimensions': dimensions,
            'price': price,
            'status': status,
            'facing': facing,
            'is_corner': is_corner,
            'sector': f'Sector {chr(65 + min(3, p["y"] // 350))}'
        },
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

print(f'Successfully generated {len(features)} plots in plots.geojson and plotsData.js')
