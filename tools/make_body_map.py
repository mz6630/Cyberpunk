# MakeHuman CC0 기본 메시 → 3/4 각도 흉상의 법선·깊이·재질 맵 (ASCII 렌더러용)
import numpy as np, collections, json, sys
from PIL import Image
from scipy import ndimage

YAW = np.radians(float(sys.argv[1]) if len(sys.argv) > 1 else -38)
PITCH = np.radians(0)
N = 640                                   # 맵 해상도

V = []; F = collections.defaultdict(list); g = None
for ln in open('repo/makehuman/data/3dobjs/base.obj'):
    if ln.startswith('v '): V.append([float(x) for x in ln.split()[1:4]])
    elif ln.startswith('g '): g = ln.split()[1].strip()
    elif ln.startswith('f '): F[g].append([int(t.split('/')[0]) - 1 for t in ln.split()[1:]])
V = np.array(V)
groups = {'body': 0, 'helper-l-eye': 4, 'helper-r-eye': 4}
tris, tmat = [], []
for gname, m in groups.items():
    for f in F[gname]:
        for k in range(1, len(f) - 1):
            tris.append([f[0], f[k], f[k + 1]]); tmat.append(m)
tris = np.array(tris); tmat = np.array(tmat)

# 정점 법선
fn = np.cross(V[tris[:, 1]] - V[tris[:, 0]], V[tris[:, 2]] - V[tris[:, 0]])
VN = np.zeros_like(V)
for k in range(3): np.add.at(VN, tris[:, k], fn)
VN /= np.linalg.norm(VN, axis=1, keepdims=True) + 1e-9

# 머리 크기 기준
headTop = V[F['body']].max() if False else V[np.unique(np.concatenate([np.array(f) for f in F['body']]))][:, 1].max()
H = 2.35                                    # 정수리~턱 대략
cx = 0.0

def rot(P):
    c, s = np.cos(YAW), np.sin(YAW)
    x = P[:, 0] * c + P[:, 2] * s
    z = -P[:, 0] * s + P[:, 2] * c
    y = P[:, 1]
    cp, sp = np.cos(PITCH), np.sin(PITCH)
    return np.stack([x, y * cp - z * sp, y * sp + z * cp], 1)

W = rot(V); WN = rot(VN)
# 화면 상자: 정수리 위 여백 ~ 가슴까지
SPAN = 3.5
top = headTop + 0.16
xc = 0.0
def to_px(P):
    return np.stack([(P[:, 0] - xc) / SPAN * N + N / 2, (top - P[:, 1]) / SPAN * N], 1)
S2 = to_px(W)

zbuf = np.full((N, N), -1e9); nrm = np.zeros((N, N, 3)); pos = np.zeros((N, N, 3)); mat = np.zeros((N, N), np.uint8)
for t, m in zip(tris, tmat):
    a, b, c = S2[t]
    xmin = int(max(0, np.floor(min(a[0], b[0], c[0])))); xmax = int(min(N - 1, np.ceil(max(a[0], b[0], c[0]))))
    ymin = int(max(0, np.floor(min(a[1], b[1], c[1])))); ymax = int(min(N - 1, np.ceil(max(a[1], b[1], c[1]))))
    if xmin > xmax or ymin > ymax: continue
    xs, ys = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-12: continue
    l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    l3 = 1 - l1 - l2
    ins = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
    if not ins.any(): continue
    z = l1 * W[t[0], 2] + l2 * W[t[1], 2] + l3 * W[t[2], 2]
    yy, xx = np.nonzero(ins)
    py, px = yy + ymin, xx + xmin
    zz = z[yy, xx]
    better = zz > zbuf[py, px]
    if not better.any(): continue
    py, px, zz = py[better], px[better], zz[better]
    L = np.stack([l1[yy, xx][better], l2[yy, xx][better], l3[yy, xx][better]], 1)
    n = L @ WN[t]
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    zbuf[py, px] = zz; nrm[py, px] = n; pos[py, px] = L @ V[t]; mat[py, px] = m + 1

mask = mat > 0
# 뒷면이 보이는 곳(법선이 화면 반대)은 앞쪽으로 뒤집기
nrm[mask & (nrm[..., 2] < 0)] *= -1

# 화면 공간 AO (깊이 차이로 오목함 추정)
z = np.where(mask, zbuf, zbuf[mask].min() - 1)
ao = np.zeros((N, N))
for r in (3, 6, 10, 16):
    acc = np.zeros((N, N))
    for ang in np.linspace(0, 2 * np.pi, 8, endpoint=False):
        dx, dy = int(round(np.cos(ang) * r)), int(round(np.sin(ang) * r))
        sh = np.roll(np.roll(z, dy, 0), dx, 1)
        acc += np.clip((sh - z) / (r / N * SPAN * 1.2), 0, 1)
    ao += acc / 8
ao = np.clip(1 - ao / 4 * 1.25, 0, 1)

# 재질: 1 피부, 2 머리카락, 3 금속, 4 케이블, 5 눈
P = pos
headH = H
yT = headTop
hair = np.zeros_like(mask)   # 민머리 (짧게 민 스타일)
M = np.where(mask, 1, 0).astype(np.uint8)
M[hair] = 2
M[mat == 5] = 5
# 보이는 쪽(+x) 관자놀이 금속 판
temple = mask & (mat == 1) & (P[..., 0] > 0.6) & (P[..., 0] < 0.78) & (P[..., 1] > yT - 0.95) & (P[..., 1] < yT - 0.42) & (P[..., 2] > -0.1)
M[temple] = 3

out = {}
from PIL import ImageDraw as _D
_c = Image.new('L', (N, N), 0); _d = _D.Draw(_c)
def _px(x, y): return ((x - xc) / SPAN * N + N / 2, (top - y) / SPAN * N)
for line in ([(0.66, yT - 0.9), (0.6, yT - 1.1), (0.6, yT - 1.3), (0.5, yT - 1.5)],
             [(0.7, yT - 0.75), (0.68, yT - 1.0), (0.66, yT - 1.25)]):
    _d.line([_px(*p) for p in line], fill=255, width=2)
    for p in line[1:]:
        q = _px(*p); _d.ellipse([q[0] - 2.5, q[1] - 2.5, q[0] + 2.5, q[1] + 2.5], fill=255)
circuit = (np.array(_c) > 0) & mask & (mat == 1)

# 포트: 목 옆 뒤 (+x, -z) 표면 정점 중 화면에서 보이는 것
body_idx = np.unique(np.concatenate([np.array(f) for f in F['body']]))
neckY = yT - 2.32
cand = body_idx[(np.abs(V[body_idx, 1] - neckY) < 0.08)]
score = V[cand, 0] * 0.75 - V[cand, 2] * 0.66
pv = cand[np.argmax(score)]
pp = to_px(W[[pv]])[0]
# 화면에서 같은 줄의 실루엣 오른쪽 끝(목 뒤 가장자리)으로 맞춤
row = int(pp[1]); cols_ = np.nonzero(mask[row])[0]
neck_cols = cols_[(cols_ > N * 0.3) & (cols_ < N * 0.7)]
# 목 구간의 오른쪽 끝 찾기
runs = np.split(neck_cols, np.where(np.diff(neck_cols) != 1)[0] + 1)
run = max(runs, key=len)
port_px = [float(run[-1]) - 2, float(row)]
out['port'] = [port_px[0] / N, port_px[1] / N]
out['neckW'] = (run[-1] - run[0]) / N

# 케이블: 포트 근처에서 어깨 뒤로 내려가는 두 줄 (2D로 그려 넣음)
from PIL import ImageDraw
cab = Image.new('L', (N, N), 0); dr = ImageDraw.Draw(cab)
x0, y0 = port_px
for off, w in ((-6, 5), (8, 4)):
    pts = [(x0 - 4, y0 + 10 + off * 0.6), (x0 + 4 + off * 0.4, y0 + 50 + off), (x0 + 30 + off, y0 + 92), (x0 + 70 + off, y0 + 120)]
    dr.line(pts, fill=255, width=w, joint='curve')
cabm = (np.array(cab) > 0) & mask & (M != 0)
M[cabm] = 4
# 포트 둘레 금속 링
yy, xx = np.mgrid[0:N, 0:N]
ring = mask & (np.hypot(xx - x0, yy - y0) < 14)
M[ring] = 3
M[circuit] = 3

# 아래쪽은 잘라냄 (가슴 아래)
# 인코딩: R,G = 법선 x,y (0~255), B = AO, A = 재질*40 (0이면 빈칸)
img = np.zeros((N, N, 4), np.uint8)
img[..., 0] = np.clip((nrm[..., 0] * 0.5 + 0.5) * 255, 0, 255)
img[..., 1] = np.clip((nrm[..., 1] * 0.5 + 0.5) * 255, 0, 255)
img[..., 2] = np.clip(ao * 255, 0, 255)
img[..., 3] = M * 40
img[~mask] = 0
Image.fromarray(img, 'RGBA').save('body-map.png', optimize=True)
json.dump(out, open('body-map.json', 'w'))
print(out)
# 미리보기 (단순 조명)
L = np.array([-0.5, 0.45, 0.74]); L /= np.linalg.norm(L)
sh = np.clip(nrm @ L, 0, 1) * ao
prev = (sh * 255).astype(np.uint8); prev[~mask] = 0
pv_img = Image.fromarray(prev).convert('RGB')
c = np.array(pv_img); c[M == 2] = c[M == 2] * np.array([1, 0.6, 0.6]); c[M == 3] = [90, 200, 220]; c[M == 4] = [255, 255, 0]
c[int(y0) - 3:int(y0) + 3, int(x0) - 3:int(x0) + 3] = [0, 255, 0]
Image.fromarray(c.astype(np.uint8)).save('preview.png')
