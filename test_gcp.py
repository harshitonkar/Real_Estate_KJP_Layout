import numpy as np

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

print('Lat params:', lat_params)
print('Lng params:', lng_params)

for g in gcps:
    x, y = g['img']
    pred_lat = lat_params[0]*x + lat_params[1]*y + lat_params[2]
    pred_lng = lng_params[0]*x + lng_params[1]*y + lng_params[2]
    err_lat = pred_lat - g['map'][0]
    err_lng = pred_lng - g['map'][1]
    err_m = np.sqrt((err_lat * 111000)**2 + (err_lng * 107000)**2)
    print(f"{g['label']}: error = {err_m:.2f} meters")
