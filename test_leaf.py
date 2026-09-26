import cv2
import numpy as np

im_rgba = cv2.imread('KJP_Layout_Outline.png', cv2.IMREAD_UNCHANGED)
alpha = im_rgba[:, :, 3]
binary = (alpha < 50).astype(np.uint8) * 255

contours, hierarchy = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
hier = hierarchy[0]

print('Total contours:', len(contours))

# We want innermost plot cells:
# Individual plots have areas between 300 and 4500 pixels!
# Dimensions: w between 14 and 100, h between 14 and 80.
leaf_plots = []
for i, cnt in enumerate(contours):
    area = cv2.contourArea(cnt)
    x, y, w, h = cv2.boundingRect(cnt)
    first_child = hier[i][2]
    
    # An individual plot has area roughly 250 to 5000, not a giant block
    if 250 <= area <= 5000 and 12 <= w <= 120 and 12 <= h <= 90:
        # Check aspect ratio
        aspect = max(w / h, h / w)
        if aspect <= 4.0:
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
            leaf_plots.append({
                'idx': i,
                'x': x, 'y': y, 'w': w, 'h': h,
                'area': area,
                'aspect': aspect,
                'corners': len(approx),
                'cnt': approx.reshape(-1, 2)
            })

print(f"Leaf plot cells found: {len(leaf_plots)}")
