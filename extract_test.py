import cv2
import numpy as np

# Load layout image
# KJP_Layout_Outline.png is RGBA with black lines on transparent background
im_rgba = cv2.imread('KJP_Layout_Outline.png', cv2.IMREAD_UNCHANGED)
alpha = im_rgba[:, :, 3]

# Create clean binary mask:
# Plot interiors are transparent (alpha < 50), lines are black (alpha > 100)
# We can also do the exact pipeline described:
# convert to grayscale, bilateral filter, adaptive thresholding / Canny edges
gray = cv2.cvtColor(im_rgba[:, :, :3], cv2.COLOR_BGR2GRAY)
# Invert or use alpha
# Let's inspect
binary_plots = (alpha < 50).astype(np.uint8) * 255

# Apply bilateral filter to smooth edges while keeping lines crisp
filtered = cv2.bilateralFilter(binary_plots, 9, 75, 75)

# Find contours
contours, hierarchy = cv2.findContours(filtered, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
print(f"Total raw contours found: {len(contours)}")

# Inspect area distribution
areas = [cv2.contourArea(c) for c in contours]
print(f"Area min: {min(areas)}, max: {max(areas)}, median: {np.median(areas)}")

# Filter plot contours:
# Individual plots have areas typically between 450 and 8000 pixels
# Width typically 20 to 120, height typically 15 to 100
valid_plots = []
for i, cnt in enumerate(contours):
    area = cv2.contourArea(cnt)
    x, y, w, h = cv2.boundingRect(cnt)
    
    # Filter out text labels (< 400 area) and large roads/perimeter (> 15000 area)
    if 450 <= area <= 15000 and 18 <= w <= 180 and 14 <= h <= 180:
        # Check aspect ratio (not too skinny like a road segment)
        aspect = max(w / h, h / w)
        if aspect <= 4.5:
            # Approximate polygon corners
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)
            valid_plots.append({
                'idx': i,
                'x': x, 'y': y, 'w': w, 'h': h,
                'area': area,
                'aspect': aspect,
                'approx_corners': len(approx),
                'cnt': cnt,
                'approx': approx
            })

print(f"Validated plot contours: {len(valid_plots)}")
