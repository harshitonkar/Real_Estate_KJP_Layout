function computeAffine(points) {
  let a00 = 0, a01 = 0, a02 = 0;
  let a11 = 0, a12 = 0, a22 = points.length;
  let bu0 = 0, bu1 = 0, bu2 = 0;
  let bv0 = 0, bv1 = 0, bv2 = 0;

  for (const p of points) {
    const { x, y, u, v } = p;
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
  if (Math.abs(det) < 1e-12) {
    throw new Error('Singular matrix');
  }

  const inv00 = c00 / det, inv01 = c10 / det, inv02 = c20 / det;
  const inv10 = c01 / det, inv11 = c11 / det, inv12 = c21 / det;
  const inv20 = c02 / det, inv21 = c12 / det, inv22 = c22 / det;

  const a = inv00 * bu0 + inv01 * bu1 + inv02 * bu2;
  const c = inv10 * bu0 + inv11 * bu1 + inv12 * bu2;
  const tx = inv20 * bu0 + inv21 * bu1 + inv22 * bu2;

  const b = inv00 * bv0 + inv01 * bv1 + inv02 * bv2;
  const d = inv10 * bv0 + inv11 * bv1 + inv12 * bv2;
  const ty = inv20 * bv0 + inv21 * bv1 + inv22 * bv2;

  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const rotationDeg = Math.atan2(b, a) * (180 / Math.PI);
  const skewDeg = (Math.atan2(d, c) - Math.PI / 2 - Math.atan2(b, a)) * (180 / Math.PI);

  return { a, b, c, d, tx, ty, scaleX, scaleY, rotationDeg, skewDeg };
}

// Test with synthetic points
const testPts = [
  { x: 10, y: 10, u: 100, v: 200 },
  { x: 50, y: 10, u: 180, v: 200 },
  { x: 50, y: 80, u: 180, v: 340 },
  { x: 10, y: 80, u: 100, v: 340 }
];
console.log('Test affine:', computeAffine(testPts));
