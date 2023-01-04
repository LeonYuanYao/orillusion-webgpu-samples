import Stats from 'stats.js'
import dat from 'dat.gui';
import { mat4 } from 'gl-matrix'
import { getModelMatrix } from './math';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Mesh } from 'three'
import { Box3 } from './frustum/box';

export function regCameraViewEvent(canvas: HTMLCanvasElement, onCameraChange: (viewMatrix: Float32Array) => void) {
    let mousePos: [number, number] | null = null;
    let mouseDown = false;
    let width = 0, height = 0
    canvas.addEventListener('mousedown', (ev) => {
        mouseDown = true
        width = (ev.target as any).clientWidth ?? 0
        height = (ev.target as any).clientHeight ?? 0
    })
    canvas.addEventListener('mouseup', (ev) => {
        mouseDown = false
    })
    canvas.addEventListener('mousemove', (ev) => {
        mousePos = [ev.clientX, ev.clientY]
    })

    const position = {x: 0, y: 0, z: 0}
    const rotation = {x: 0, y: 0, z: 0}
    const scale = {x: 1, y: 1, z: 1}
    const speed = 0.005
    const viewMatrix = mat4.create()

    const update = () => {
        if (mouseDown && mousePos) {
            const halfWidth = width * 0.5
            const halfHeight = height * 0.5
            const [x, y] = mousePos

            if (x < halfWidth - 10) {
                rotation.y += speed
            } else if (x > halfWidth + 10) {
                rotation.y -= speed
            }

            // if (y < halfHeight - 10) {
            //     rotation.x += speed
            // } else if (y > halfHeight + 10) {
            //     rotation.x -= speed
            // }

            mat4.invert(viewMatrix, getModelMatrix(position, rotation, scale, viewMatrix))
            onCameraChange(viewMatrix as Float32Array)
        }
        requestAnimationFrame(update)
    }
    update()
}

export function initTools() {
    const stats = new Stats();
    stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    document.body.appendChild(stats.dom);

    const gui = new dat.GUI({
        name: 'GUI',
        width: 320,
    });

    return {stats, gui}
}

let bufferMap = new Map<number, GPUBuffer[]>()
export function getReadbackBuffer(device: GPUDevice, size: number): [GPUBuffer, () => void] {
    let availableBuffers = bufferMap.get(size)
    if (!availableBuffers) {
        availableBuffers = []
        bufferMap.set(size, availableBuffers)
    }
    
    const buffer = availableBuffers.pop() ?? device.createBuffer({
        label: 'readback buffer',
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    const release = () => {
        const buffers = bufferMap.get(size) ?? []
        buffers.push(buffer)
    }

    return [buffer, release]
}

export function loadBoomBox(): Promise<{
    vertex: Float32Array;
    index: Uint16Array;
    vertexCount: number;
    indexCount: number;
    box: Box3;
}> {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader()
        loader.load('http://localhost:3000/public/BoomBox.glb', (gltf) => {
            const mesh = gltf.scene.children[0] as Mesh
            const geom = mesh.geometry
            const vertexCount = geom.attributes.position.count
            const vertex = new Float32Array(vertexCount * 8) // 3 pos + 3 norm + 2 uv, interleaved vertex data
            const model = {
                vertex: vertex,
                index: geom.index!.array as Uint16Array,
                vertexCount: vertexCount,
                indexCount: geom.index!.count,
                box: new Box3(),
            }
            const scale = 100
            const box = model.box
            const positions = geom.attributes.position.array
            const normals = geom.attributes.normal.array
            const uvs = geom.attributes.uv.array
            for (let i = 0; i < vertexCount; i++) {
                const i3 = i * 3
                const i2 = i * 2
                const x = positions[i3 + 0] * scale
                const y = positions[i3 + 1] * scale
                const z = positions[i3 + 2] * scale
                box.min[0] = Math.min(box.min[0], x)
                box.min[1] = Math.min(box.min[1], y)
                box.min[2] = Math.min(box.min[2], z)
                box.max[0] = Math.max(box.max[0], x)
                box.max[1] = Math.max(box.max[1], y)
                box.max[2] = Math.max(box.max[2], z)
                vertex[i * 8 + 0] = x
                vertex[i * 8 + 1] = y
                vertex[i * 8 + 2] = z
                vertex[i * 8 + 3] = normals[i3 + 0]
                vertex[i * 8 + 4] = normals[i3 + 1]
                vertex[i * 8 + 5] = normals[i3 + 2]
                vertex[i * 8 + 6] = uvs[i2 + 0]
                vertex[i * 8 + 7] = uvs[i2 + 1]
            }
            resolve(model)
        }, () => {}, (err) => {
            reject(err)
        })
    })
}