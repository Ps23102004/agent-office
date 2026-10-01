"""The street's and the garage's Kenney cars, as src/client/models/cars.glb.

Plain Python (numpy + Pillow), not Blender: it reads Kenney's Car Kit (CC0, see CREDITS.md) and writes
one small file the office's code reads (client/world/carkit.ts):

    python3 blender/scripts/build_cars.py <path to kenney_car-kit>

Kenney's models are painted by UV into a shared palette texture; here each vertex takes its color from
the palette instead (no texture to load, and one toon material draws them all). Each model becomes a
node `<name>` (no mesh) holding three meshes, in metres, nose to +z, left +x, wheels on y = 0:

    <name>_body   everything that keeps its colors
    <name>_paint  the bodywork in the model's main color, white-ish (its shading only), for tinting
    <name>_wheel  one wheel, its hub facing -x (the right side's), at the origin: the code places four

and its extras: the wheels' hubs, where its head-, tail- and roof lights are, its size, its beltline
(where the glass starts) and the cabin's length, and the paint it came in.
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Kenney's cars are about 2.5 units long: stretched to a car's length, a bit less across and up so
# they stay chunky but people still fit them. Wheels scale evenly (to stay round) by the height.
SX, SY, SZ = 1.35, 1.35, 1.7  # The wheels' meshes are scaled by SY, so SX must equal it: they line up with the arches.
MODELS = [
    'sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'police', 'van', 'delivery',
    'delivery-flat', 'truck', 'garbage-truck', 'ambulance', 'firetruck', 'race', 'race-future',
]
# Palette cells (8 across, 4 down): what isn't paint (greys, white, glass, lights).
GLASS, HEAD, TAIL, BLUE = 24, 25, 26, 27
NEUTRAL = {17, 18, 19, 20, 21, 22, 23, GLASS, HEAD, TAIL, 0, 1, 2, 3, 4, 5, 6, 7}

CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(path):
    b = path.read_bytes()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    blob = b[20 + jl + 8:]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        n, dt = NC[a['type']], CT[a['componentType']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        assert bv.get('byteStride', 0) in (0, np.dtype(dt).itemsize * n), 'tightly packed'
        return np.frombuffer(blob, dt, a['count'] * n, start).reshape(a['count'], n).astype(np.float32 if dt == np.float32 else np.int64)

    def local(n):
        m = np.eye(4)
        x, y, z, w = n.get('rotation', [0, 0, 0, 1])
        m[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        m[:3, :3] *= np.array(n.get('scale', [1, 1, 1]))
        m[:3, 3] = n.get('translation', [0, 0, 0])
        return m

    parent = {c: i for i, n in enumerate(j['nodes']) for c in n.get('children', [])}

    def world(i):
        m = local(j['nodes'][i])
        while i in parent:
            i = parent[i]
            m = local(j['nodes'][i]) @ m
        return m

    nodes = []
    for i, n in enumerate(j['nodes']):
        if 'mesh' not in n:
            continue
        m = world(i)
        for p in j['meshes'][n['mesh']]['primitives']:
            at = p['attributes']
            nodes.append(dict(name=n['name'], m=m, t=m[:3, 3].astype(np.float32),
                              pos=acc(at['POSITION']), nrm=acc(at['NORMAL']), uv=acc(at['TEXCOORD_0']), idx=acc(p['indices']).reshape(-1)))
    return nodes


def linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def build(kit: Path, out: Path):
    tex = np.asarray(Image.open(kit / 'Models/GLB format/Textures/colormap.png').convert('RGB')).astype(np.float32)
    H, W = tex.shape[:2]
    lin = linear(tex)

    def sample(uv):
        x = np.clip((uv[:, 0] * W).astype(int), 0, W - 1)
        y = np.clip((uv[:, 1] * H).astype(int), 0, H - 1)
        return lin[y, x], (np.clip(uv[:, 1], 0, 0.9999) * 4).astype(int) * 8 + (np.clip(uv[:, 0], 0, 0.9999) * 8).astype(int)

    def cell_color(k):
        # The cell's flat (left) half: what the paint "is".
        return tex[(k // 8) * 128 + 64, (k % 8) * 64 + 8]

    blob = bytearray()
    views, accessors, meshes, gnodes = [], [], [], []
    roots = []

    def view(data: bytes, target):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(views) - 1

    def add_mesh(name, pos, nrm, col, idx):
        a = len(accessors)
        accessors.append({'bufferView': view(pos.astype(np.float32).tobytes(), 34962), 'componentType': 5126, 'count': len(pos), 'type': 'VEC3',
                          'min': pos.min(0).round(4).tolist(), 'max': pos.max(0).round(4).tolist()})
        accessors.append({'bufferView': view(nrm.astype(np.float32).tobytes(), 34962), 'componentType': 5126, 'count': len(pos), 'type': 'VEC3'})
        rgba = np.concatenate([np.clip(np.round(col * 255), 0, 255), np.full((len(col), 1), 255)], 1).astype(np.uint8)
        accessors.append({'bufferView': view(rgba.tobytes(), 34962), 'componentType': 5121, 'normalized': True, 'count': len(pos), 'type': 'VEC4'})
        accessors.append({'bufferView': view(idx.astype(np.uint16).tobytes(), 34963), 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'})
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': a, 'NORMAL': a + 1, 'COLOR_0': a + 2}, 'indices': a + 3, 'material': 0}]})
        return len(meshes) - 1

    def node(name, mesh=None, extras=None, children=None):
        n = {'name': name}
        if mesh is not None:
            n['mesh'] = mesh
        if extras:
            n['extras'] = extras
        if children:
            n['children'] = children
        gnodes.append(n)
        return len(gnodes) - 1

    wheels_seen = {}
    r3 = lambda v: [round(float(x), 3) for x in v]
    for name in MODELS:
        parts = read(kit / 'Models/GLB format' / f'{name}.glb')
        wheels = [p for p in parts if p['name'].startswith('wheel-') and p['name'].endswith(('-left', '-right'))]
        rest = [p for p in parts if p not in wheels]
        assert len(wheels) == 4, name
        S = np.array([SX, SY, SZ], np.float32)
        P, N, C, K, I = [], [], [], [], []
        base = 0
        for p in rest:
            pos = (p['pos'] @ p['m'][:3, :3].T + p['t']) * S
            nrm = (p['nrm'] @ np.linalg.inv(p['m'][:3, :3])) / S
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
            col, cell = sample(p['uv'])
            P.append(pos); N.append(nrm); C.append(col); K.append(cell); I.append(p['idx'] + base)
            base += len(pos)
        P, N, C, K, I = map(np.concatenate, (P, N, C, K, I))
        tri = I.reshape(-1, 3)
        area = 0.5 * np.linalg.norm(np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]]), axis=1)
        tc = K[tri[:, 0]]
        by = {}
        for k, a in zip(tc, area):
            by[int(k)] = by.get(int(k), 0) + a
        paint = max((k for k in by if k not in NEUTRAL), key=lambda k: by[k], default=None)
        if name == 'police':
            paint = None  # Black and white, always.
        # The paint's own shading (its gradient), with the paint itself taken out.
        is_paint = np.isin(tc, [paint]) if paint is not None else np.zeros(len(tri), bool)

        def split(mask):
            t = tri[mask]
            used, inv = np.unique(t.reshape(-1), return_inverse=True)
            return used, inv.reshape(-1)

        children = []
        used, idx = split(~is_paint)
        children.append(node(f'{name}_body', add_mesh(f'{name}_body', P[used], N[used], C[used], idx)))
        paint_hex = None
        if paint is not None:
            used, idx = split(is_paint)
            flat = linear(cell_color(paint))
            shade = np.clip((C[used] / np.maximum(flat, 1e-4)).mean(1, keepdims=True), 0, 1).repeat(3, 1)
            children.append(node(f'{name}_paint', add_mesh(f'{name}_paint', P[used], N[used], shade, idx)))
            paint_hex = '#%02x%02x%02x' % tuple(int(v) for v in cell_color(paint))

        # One wheel (a right-hand one, hub facing -x), shared between the models that have the same.
        w = next(p for p in wheels if p['name'].endswith('-right'))
        key = (len(w['pos']), round(float(np.abs(w['pos']).sum()), 3))
        if key not in wheels_seen:
            col, _ = sample(w['uv'])
            # Evenly, by the height: a stretched wheel would wobble as it turns.
            wheels_seen[key] = add_mesh(f'wheel{len(wheels_seen)}', w['pos'] * SY, w['nrm'], col, w['idx'])
        children.append(node(f'{name}_wheel', wheels_seen[key]))
        hubs = [r3(p['t'] * S) for p in wheels]
        radius = float(np.abs(w['pos'][:, 1]).max() * SY)

        def lights(mask):
            if not mask.any():
                return []
            out = []
            for side in (1, -1):
                m = mask & (np.sign(P[:, 0]) == side)
                if m.any():
                    out.append(r3(P[m].mean(0)))
            return out

        top = P[:, 1].max()
        glass = K == GLASS
        belt = float(P[glass, 1].min()) if glass.any() else float(top)
        front, back = P[:, 2].max(), P[:, 2].min()
        roof = P[:, 1] > top - 0.35
        head = lights((K == HEAD) & (P[:, 2] > front * 0.5)) or [r3([s * (P[:, 0].max() - 0.35), 0.8, front]) for s in (1, -1)]
        tail = lights((K == TAIL) & (P[:, 2] < back * 0.5) & ~roof) or [r3([s * (P[:, 0].max() - 0.35), 0.8, back]) for s in (1, -1)]
        if name.startswith('race'):
            head, tail = [], []  # No lights on a racing car.
        beacons = []
        if name in ('police', 'ambulance', 'firetruck'):
            beacons = [[*b, 'red'] for b in lights((K == TAIL) & roof)] + [[*b, 'blue'] for b in lights((K == BLUE) & roof)]
        cabin = r3([P[glass, 2].min(), P[glass, 2].max()]) if glass.any() else [0, 0]
        extras = {
            'length': round(float(P[:, 2].max() - P[:, 2].min()), 3), 'width': round(float(P[:, 0].max() - P[:, 0].min()), 3),
            'height': round(float(top), 3), 'belt': round(belt, 3), 'cabin': cabin, 'radius': round(radius, 3),
            'wheels': hubs, 'head': head, 'tail': tail, 'beacons': beacons, 'paint': paint_hex,
        }
        roots.append(node(name, extras=extras, children=children))
        print(name, extras)

    while len(blob) % 4:
        blob.append(0)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'agent-office build_cars.py (Car Kit by Kenney, CC0)'},
        'scene': 0, 'scenes': [{'nodes': roots}], 'nodes': gnodes, 'meshes': meshes,
        'materials': [{'name': 'kit', 'pbrMetallicRoughness': {'metallicFactor': 0}, 'doubleSided': True}],
        'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    data = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    out.write_bytes(data)
    print(out, len(data), 'bytes')


if __name__ == '__main__':
    build(Path(sys.argv[1]), Path(__file__).resolve().parents[2] / 'src/client/models/cars.glb')
