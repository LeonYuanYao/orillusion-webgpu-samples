import Stats from 'stats.js'
import dat from 'dat.gui';
import { mat4 } from 'gl-matrix'
import { getModelMatrix } from './math';

export function createInspectorBuffer(device: GPUDevice, size: number) {
    const buffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    })
    return buffer
}

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