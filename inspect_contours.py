import cv2
import numpy as np

im_rgba = cv2.imread('KJP_Layout_Outline.png', cv2.IMREAD_UNCHANGED)
alpha = im_rgba[:, :, 3]
binary = (alpha < 50).astype(np.uint8) * 255

contours, hierarchy = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
print('Total contours:', len(contours))

# Let's inspect all contours with area > 100
large = []
for i, c in enumerate(contours):
    area = cv2.contourArea(c)
    x, y, w, h = cv2.boundingRect(c)
    if area > 100:
        large.append((i, area, x, y, w, h))

large.sort(key=lambda x: x[1])
print('Contours with area > 100:', len(large))
for item in large[:30]:
    print(item)
print('...')
for item in large[-15:]:
    print(item)
