import { mat4, vec3 } from 'gl-matrix'
import vertex from './shaders/normal-mvp.vert.wgsl?raw'
import fragment from './shaders/position-mvp.frag.wgsl?raw'
import updateShader from './shaders/compute.update.wgsl?raw'
import cullingShader from './shaders/compute.culling.wgsl?raw'
import * as sphere from './util/sphere'
import { getModelMatrix, getProjectionMatrix } from './util/math'
import { regCameraViewEvent, initTools, loadBoomBox } from './util/utils'
import { Frustum } from './util/frustum/frustum'
import { Sphere } from './util/frustum/sphere'
import { Box3 } from './util/frustum/box'

// 1. bbox & matrix into buffer
// 2. compute pass for frustum culling
// 3. write instance num (0 or 1) into IndirectBuffer

const RINGS = 50
const CUBES_PER_RING = 200
const NUM = CUBES_PER_RING * RINGS
const DURATION = 2000
const VELOCITY_SCALE = 0.3
const CAMERA_CONFIG = {
    fovy: 100,
    near: 0.1, 
    far: 10000,
    position: {x: 0, y: 0, z: 0},
}
console.log('NUM', NUM)

const infoRef: {[key: string]: any} = {
    NUM: NUM.toString(),
    drawCount: '0',
    computeCount: '0',
    jsTime: '0',
    drawTime: '0',
    indirectDraw: true,
    bundleRender: false,
    culling: true,
}

const {stats, gui} = initTools();
const controls = [
    gui.add(infoRef, 'NUM'),
    gui.add(infoRef, 'drawCount'),
    gui.add(infoRef, 'computeCount'),
    gui.add(infoRef, 'jsTime'),
    gui.add(infoRef, 'drawTime'),
    gui.add(infoRef, 'indirectDraw'),
    gui.add(infoRef, 'bundleRender'),
    gui.add(infoRef, 'culling'),
];

// Model VB & IB data
const model = await loadBoomBox() // sphere

// initialize webgpu device & config canvas context
async function initWebGPU(canvas: HTMLCanvasElement) {
    if(!navigator.gpu)
        throw new Error('Not Support WebGPU')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter)
        throw new Error('No Adapter Found')
    const device = await adapter.requestDevice()
    const context = canvas.getContext('webgpu') as GPUCanvasContext
    const format = navigator.gpu.getPreferredCanvasFormat ? navigator.gpu.getPreferredCanvasFormat() : context.getPreferredFormat(adapter)
    const devicePixelRatio = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * devicePixelRatio
    canvas.height = canvas.clientHeight * devicePixelRatio
    const size = {width: canvas.width, height: canvas.height}
    context.configure({
        device,
        format,
        alphaMode: 'opaque' // prevent chrome warning after v102
    })
    return {device, context, format, size}
}

function createInterleavedIndirectBuffer(device: GPUDevice, indirectBuffer?: GPUBuffer): [GPUBuffer, Uint32Array] {
    const stride = 5
    if (!indirectBuffer) {
        indirectBuffer = device.createBuffer({
            label: 'Indirect Buffer',
            size: stride * 4 * NUM, // 4 x Uint32: vertexCount instanceCount firstVertex firstInstance
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
    }

    const indirectData = new Uint32Array(stride * NUM)

    let offset = 0
    for (let i = 0; i < NUM; i++) {
        indirectData[offset + 0] = model.indexCount      // indexCount
        indirectData[offset + 1] = 1                     // instanceCount
        indirectData[offset + 2] = 0                     // firstIndex
        indirectData[offset + 3] = 0                     // baseVertex
        indirectData[offset + 4] = 0                     // firstInstance
        offset += stride
    }
    device.queue.writeBuffer(indirectBuffer, 0, indirectData)
    // console.log('indirectData', indirectData)
    return [indirectBuffer, indirectData]
}

// function createIndirectBuffers(device: GPUDevice) {
//     const stride = 5
//     const indirectBuffers: GPUBuffer[] = []
//     for (let i = 0; i < NUM; i++) {
//         const indirectBuffer = device.createBuffer({
//             label: 'Indirect Buffer',
//             size: stride * 4, // stride x Uint32: vertexCount instanceCount firstVertex firstInstance
//             usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
//         })
//         const indirectData = new Uint32Array(stride)
//         indirectData[0] = model.indexCount      // indexCount
//         indirectData[1] = 1                     // instanceCount
//         indirectData[2] = 0                     // firstIndex
//         indirectData[3] = 0                     // baseVertex
//         indirectData[4] = 0                     // firstInstance
//         device.queue.writeBuffer(indirectBuffer, 0, indirectData)
//         indirectBuffers.push(indirectBuffer)
//     }
//     console.log('indirectData', indirectBuffers)
//     return indirectBuffers
// }

// create pipiline & buffers

interface PipelineObj {
    pipeline: GPURenderPipeline;
    depthTexture: GPUTexture;
    depthView: GPUTextureView;
    modelVB: GPUBuffer;
    modelIB: GPUBuffer;
    modelDataBuffer: GPUBuffer;
    vpBuffer: GPUBuffer;
    bindGroups: GPUBindGroup[];
    vpBindGroup: GPUBindGroup;
    indirectBuffer: GPUBuffer;
    indirectData: Uint32Array;
    timeBuffer: GPUBuffer,
    updatePipeline: GPUComputePipeline;
    updateBindGroup: GPUBindGroup;
    frustumBuffer: GPUBuffer;
    cullingPipeline: GPUComputePipeline;
    cullingBindGroup: GPUBindGroup;
}

async function initPipeline(device: GPUDevice, format: GPUTextureFormat, size:{width:number, height:number}): Promise<PipelineObj> {
    const pipeline = await device.createRenderPipelineAsync({
        label: 'Basic Pipline',
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: vertex,
            }),
            entryPoint: 'main',
            buffers: [{
                arrayStride: 8 * 4, // 3 position 3 normal 2 uv,
                attributes: [
                    {
                        // position
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3',
                    },
                    {
                        // normal
                        shaderLocation: 1,
                        offset: 3 * 4,
                        format: 'float32x3',
                    },
                    {
                        // uv
                        shaderLocation: 2,
                        offset: 6 * 4,
                        format: 'float32x2',
                    },
                ]
            }]
        },
        fragment: {
            module: device.createShaderModule({
                code: fragment,
            }),
            entryPoint: 'main',
            targets: [{
                    format: format
                }]
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'back'
        },
        // Enable depth testing since we have z-level positions
        // Fragment closest to the camera is rendered in front
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        }
    } as GPURenderPipelineDescriptor)

    // create depthTexture for renderPass
    const depthTexture = device.createTexture({
        size, format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const depthView = depthTexture.createView()

    // create model vertex buffer
    const modelVB = device.createBuffer({
        label: 'model vertex buffer',
        size: model.vertex.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(modelVB, 0, model.vertex)

    const modelIB = device.createBuffer({
        label: 'model index buffer',
        size: model.index.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(modelIB, 0, model.index)

    // Uniforms
    const vpBuffer = device.createBuffer({
        label: 'ViewProjection Matrix Buffer',
        size: 16 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const vpBindGroup = device.createBindGroup({
        label: 'ViewProjection BindGroup',
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
                binding: 0,
                resource: {
                    buffer: vpBuffer,
                    offset: 0,
                    size: 16 * 4
                }
            }]
    })

    // 16 * float32 for modelMatrix
    //  6 * float32 for boundingBox
    //  3 * float32 for velocity
    const modelDataBuffer = device.createBuffer({
        label: 'Object Model Matrix Buffer',
        size: 256 * NUM, // webgpu minimum offset: 256 bytes
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    const bindGroups: GPUBindGroup[] = []
    const modelMatrixLayout = pipeline.getBindGroupLayout(1)
    for (let i = 0; i < NUM; i++) {
        bindGroups.push(device.createBindGroup({
            label: 'Model Matrix Uniform ' + i,
            layout: modelMatrixLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: modelDataBuffer,
                        offset: 256 * i,
                        size: 4 * 4 * 4,
                    }
                }
            ]
        }))
    }

    // --- indirect draw ---
    const [indirectBuffer, indirectData] = createInterleavedIndirectBuffer(device)

    // --- compute update pipeline ---
    const updateCode = updateShader.replaceAll('$$NUM$$', NUM.toString())
    const updatePipeline = await device.createComputePipelineAsync({
        label: 'compute update pipeline',
        layout: 'auto',
        compute: {
            module: device.createShaderModule({
                code: updateCode
            }),
            entryPoint: 'main'
        }
    })
    
    const timeBuffer = device.createBuffer({
        label: 'time buffer',
        size: Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const durationBuffer = device.createBuffer({
        label: 'duration buffer',
        size: Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(durationBuffer, 0, new Uint32Array([DURATION])) // 2000 ms

    const updateBindGroup = device.createBindGroup({
        label: 'update compute bindgroup',
        layout: updatePipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: modelDataBuffer,
                    offset: 0,
                    size: 256 * NUM,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: timeBuffer,
                    offset: 0,
                    size: Uint32Array.BYTES_PER_ELEMENT,
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: durationBuffer,
                    offset: 0,
                    size: Uint32Array.BYTES_PER_ELEMENT,
                }
            },
        ]
    })

    // --- compute culling pipeline ---
    const cullingCode = cullingShader.replaceAll('$$NUM$$', NUM.toString())
    const cullingPipeline = await device.createComputePipelineAsync({
        label: 'culling compute pipeline',
        layout: 'auto',
        compute: {
            module: device.createShaderModule({
                code: cullingCode
            }),
            entryPoint: 'main'
        }
    })

    const frustumBuffer = device.createBuffer({
        label: 'frustum buffer',
        size: 6 * 4 * Float32Array.BYTES_PER_ELEMENT, // 6 planes, normal + constant
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const cullingBindGroup = device.createBindGroup({
        label: 'culling compute bindGroup',
        layout: cullingPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: modelDataBuffer,
                    offset: 0,
                    size: 256 * NUM,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: frustumBuffer,
                    offset: 0,
                    size: 6 * 4 * Float32Array.BYTES_PER_ELEMENT,
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: indirectBuffer,
                    offset: 0,
                    size: 5 * NUM * Uint32Array.BYTES_PER_ELEMENT,
                }
            },
        ]
    })

    return {
        pipeline, 
        depthTexture, 
        depthView, 
        modelVB, 
        modelIB,
        modelDataBuffer, 
        vpBuffer, 
        bindGroups, 
        vpBindGroup, 
        indirectBuffer,
        indirectData,
        updatePipeline,
        updateBindGroup,
        timeBuffer,
        frustumBuffer,
        cullingPipeline,
        cullingBindGroup,
    }
}

type Transform = {
    position: vec3;
    rotation: vec3;
    scale: vec3;
    matrix: mat4;
    boundingSphere: Sphere;
    boundingBox: Box3;
    velocity: vec3;
}
  
function genObjectInterleavedTransforms(transforms?: Transform[], transformArray?: Float32Array): [Transform[], Float32Array] {
    // 16 * 4 = 64 for modelMatrix
    // 6 * 4 = 24 for boundingBox
    // 3 * 4 = 12 for velocity
    if (!transformArray) {
        transformArray = new Float32Array(64 * NUM)
    }
    if (!transforms) {
        transforms = []
    }
    transforms.length = 0

    const height = RINGS * 5
    const distance = CUBES_PER_RING / 4

    let offset = 0
    const center = vec3.fromValues(0.0, 0.0, 0.0)
    const boxMin = model.box.min // vec3.fromValues(-1.0, -1.0, -1.0)
    const boxMax = model.box.max // vec3.fromValues(1.0, 1.0, 1.0)
    for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < CUBES_PER_RING; j++) {
            const rad = j / (CUBES_PER_RING - 1) * Math.PI * 2
            const h = height * i / (RINGS - 1) - height / 2
            const currDist = distance + i * 0

            const position = vec3.fromValues(Math.sin(rad) * currDist, h, Math.cos(rad) * currDist)
            const rotation = vec3.fromValues(0, 0, 0)
            const scale = vec3.fromValues(1, 1, 1)
            const matrix = getModelMatrix(
                {x: position[0], y: position[1], z: position[2]},
                {x: rotation[0], y: rotation[1], z: rotation[2]}, 
                {x: scale[0], y: scale[1], z: scale[2]}, 
                )
            vec3.copy(center, position)

            const velocity = vec3.fromValues(Math.random(), Math.random(), Math.random())
            vec3.scale(velocity, velocity, VELOCITY_SCALE)
            
            const transform: Transform = {
                position,
                rotation,
                scale,
                matrix,
                boundingSphere: new Sphere(vec3.copy(vec3.create(), center), 1),
                boundingBox: new Box3(
                    vec3.add(vec3.create(), center, boxMin),
                    vec3.add(vec3.create(), center, boxMax)
                    ),
                velocity: velocity
            }

            transforms.push(transform)
            transformArray.set(matrix, offset)
            transformArray.set(transform.boundingBox.min, offset + 16)
            transformArray.set(transform.boundingBox.max, offset + 19)
            transformArray.set(transform.velocity, offset + 22)

            offset += 64
        }
    }
    console.log('transformArray', transformArray)
    return [transforms, transformArray];
}

const pos = vec3.create()
const vel = vec3.create()
const box = new Box3()
function frustumCulling(frustum: Frustum, time: number, modelData: Float32Array, modelIndex: number) {
    const round = Math.floor(time / DURATION);
    let scale = 1.0;
    if (round % 2 === 0) {
        // forward
        scale = 1.0;
    } else {
        // backward
        scale = -1.0;
    }
    
    const offset = modelIndex * 64

    pos[0] = modelData[offset + 12]
    pos[1] = modelData[offset + 13]
    pos[2] = modelData[offset + 14]

    box.min[0] = modelData[offset + 16]
    box.min[1] = modelData[offset + 17]
    box.min[2] = modelData[offset + 18]

    box.max[0] = modelData[offset + 19]
    box.max[1] = modelData[offset + 20]
    box.max[2] = modelData[offset + 21]

    vel[0] = modelData[offset + 22]
    vel[1] = modelData[offset + 23]
    vel[2] = modelData[offset + 24]

    vel[0] = vel[0] * scale
    vel[1] = vel[1] * scale
    vel[2] = vel[2] * scale

    vec3.add(pos, pos, vel)
    vec3.add(box.min, box.min, vel)
    vec3.add(box.max, box.max, vel)

    modelData[offset + 12] = pos[0]
    modelData[offset + 13] = pos[1]
    modelData[offset + 14] = pos[2]

    modelData[offset + 16] = box.min[0]
    modelData[offset + 17] = box.min[1]
    modelData[offset + 18] = box.min[2]

    modelData[offset + 19] = box.max[0]
    modelData[offset + 20] = box.max[1]
    modelData[offset + 21] = box.max[2]

    return frustum.intersectsBox(box)
}

let renderBundles: GPURenderBundle[] | null = null

function drawRenderBundlePass(
    device: GPUDevice, 
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    pipelineObj: PipelineObj,
    frustum: Frustum
) {
    const {
        pipeline,
        depthView,
        modelVB,
        modelIB,
        vpBindGroup,
        bindGroups,
        indirectBuffer,
        updatePipeline,
        updateBindGroup,
        cullingPipeline,
        cullingBindGroup,
        frustumBuffer,
    } = pipelineObj;

    if (!infoRef.indirectDraw) {
        infoRef.indirectDraw = true
    }

    const commandEncoder = device.createCommandEncoder()

    const computePass = commandEncoder.beginComputePass()
    computePass.setPipeline(updatePipeline)
    computePass.setBindGroup(0, updateBindGroup)
    computePass.dispatchWorkgroups(Math.ceil(NUM / 128))
    infoRef.computeCount++

    if (infoRef.culling) {
        device.queue.writeBuffer(frustumBuffer, 0, frustum.array)
        computePass.setPipeline(cullingPipeline)
        computePass.setBindGroup(0, cullingBindGroup)
        computePass.dispatchWorkgroups(Math.ceil(NUM / 128))
        infoRef.computeCount++
    }

    computePass.end()

    infoRef.drawTime = 0
    const t1 = performance.now()

    if (!renderBundles) {
        const bundleEncoder = device.createRenderBundleEncoder({
            colorFormats: [format],
            depthStencilFormat: 'depth24plus'
        })
        bundleEncoder.setPipeline(pipeline)
        bundleEncoder.setBindGroup(0, vpBindGroup)
        for (let i = 0; i < NUM; i++) {
            bundleEncoder.setVertexBuffer(0, modelVB)
            bundleEncoder.setIndexBuffer(modelIB, "uint16")
            bundleEncoder.setBindGroup(1, bindGroups[i])
            bundleEncoder.drawIndexedIndirect(indirectBuffer, 5 * i * Uint32Array.BYTES_PER_ELEMENT)
            infoRef.drawCount++
        }
        renderBundles = [bundleEncoder.finish()]
    }

    const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ],
        depthStencilAttachment: {
            view: depthView,
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        }
    }
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)
    passEncoder.executeBundles(renderBundles)
    passEncoder.end()

    device.queue.submit([commandEncoder.finish()])

    infoRef.drawTime = (performance.now() - t1).toFixed(3)
    infoRef.drawCount++
}

function drawNormalPass(
    device: GPUDevice, 
    context: GPUCanvasContext,
    pipelineObj: PipelineObj,
    frustum: Frustum,
    time: number,
    modelData: Float32Array,
) {
    const {
        pipeline,
        depthView,
        modelVB,
        modelIB,
        vpBindGroup,
        bindGroups,
        indirectBuffer,
        indirectData,
        updatePipeline,
        updateBindGroup,
    } = pipelineObj;

    const commandEncoder = device.createCommandEncoder()

    const computePass = commandEncoder.beginComputePass()
    computePass.setPipeline(updatePipeline)
    computePass.setBindGroup(0, updateBindGroup)
    computePass.dispatchWorkgroups(Math.ceil(NUM / 128))
    computePass.end()
    infoRef.computeCount++

    infoRef.drawTime = 0
    const t1 = performance.now()

    const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ],
        depthStencilAttachment: {
            view: depthView,
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        }
    }
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)
    passEncoder.setPipeline(pipeline)
    passEncoder.setBindGroup(0, vpBindGroup)

    if (infoRef.indirectDraw) {
        let offset = 0
        if (infoRef.culling) {
            for (let i = 0; i < NUM; i++) {
                if (frustumCulling(frustum, time, modelData, i)) {
                    indirectData[offset + 1] = 1
                } else {
                    indirectData[offset + 1] = 0
                }
                offset += 5
            }
        } else {
            for (let i = 0; i < NUM; i++) {
                indirectData[offset + 1] = 1
                offset += 5
            }
        }
        device.queue.writeBuffer(indirectBuffer, 0, indirectData, 0)

        offset = 0
        const step = 5 * Uint32Array.BYTES_PER_ELEMENT
        for (let i = 0; i < NUM; i++) {
            if (indirectData[5 * i + 1] > 0) {
                passEncoder.setVertexBuffer(0, modelVB)
                passEncoder.setIndexBuffer(modelIB, "uint16")
                passEncoder.setBindGroup(1, bindGroups[i])
                passEncoder.drawIndexedIndirect(indirectBuffer, offset)
                infoRef.drawCount++
            }
            offset += step
        }
    } else {
        if (infoRef.culling) {
            for (let i = 0; i < NUM; i++) {
                if (frustumCulling(frustum, time, modelData, i)) {
                    passEncoder.setVertexBuffer(0, modelVB)
                    passEncoder.setIndexBuffer(modelIB, "uint16")
                    passEncoder.setBindGroup(1, bindGroups[i])
                    passEncoder.drawIndexed(model.indexCount, 1)
                    infoRef.drawCount++
                }
            }
        } else {
            for (let i = 0; i < NUM; i++) {
                passEncoder.setVertexBuffer(0, modelVB)
                passEncoder.setIndexBuffer(modelIB, "uint16")
                passEncoder.setBindGroup(1, bindGroups[i])
                passEncoder.drawIndexed(model.indexCount, 1)
                infoRef.drawCount++
            }
        }
    }

    passEncoder.end()
    device.queue.submit([commandEncoder.finish()])

    infoRef.drawTime = (performance.now() - t1).toFixed(3)
}

async function run(){
    const canvas = document.querySelector('canvas')
    if (!canvas)
        throw new Error('No Canvas')
    const {device, context, format, size} = await initWebGPU(canvas)
    const pipelineObj = await initPipeline(device, format, size)
    const { vpBuffer, modelDataBuffer, timeBuffer, indirectBuffer } = pipelineObj

    // default state
    let aspect = size.width / size.height

    const [transforms, transformArray] = genObjectInterleavedTransforms()
    device.queue.writeBuffer(modelDataBuffer, 0, transformArray)

    const refreshModelDataAndBuffer = () => {
        createInterleavedIndirectBuffer(device, indirectBuffer)
        genObjectInterleavedTransforms(transforms, transformArray)
        device.queue.writeBuffer(modelDataBuffer, 0, transformArray)
    }
    controls[5].onChange(refreshModelDataAndBuffer)
    controls[6].onChange(refreshModelDataAndBuffer)
    controls[7].onChange(refreshModelDataAndBuffer)
    
    const camParams = {
        ...CAMERA_CONFIG,
        viewMatrix: mat4.create(),
        projectionMatrix: mat4.create(),
        vpMatrix: mat4.create(),
        frustum: new Frustum(),
    }
    
    regCameraViewEvent(canvas, mat => (camParams.viewMatrix as Float32Array).set(mat))

    // start loop
    function frame() {
        requestAnimationFrame(frame)

        stats.begin()

        const t1 = performance.now();
        infoRef.drawCount = 0
        infoRef.computeCount = 0

        // ------
        // Main loop starts
        // ------
        const now = Math.floor(performance.now())
        device.queue.writeBuffer(timeBuffer, 0, new Uint32Array([now]))

        getProjectionMatrix(aspect, camParams.fovy, camParams.near, camParams.far, camParams.position, camParams.projectionMatrix)
        mat4.mul(camParams.vpMatrix, camParams.projectionMatrix, camParams.viewMatrix)
        device.queue.writeBuffer(vpBuffer, 0, camParams.vpMatrix as Float32Array)

        camParams.frustum.setFromProjectionMatrix(camParams.projectionMatrix)
        
        if (infoRef.bundleRender) {
            drawRenderBundlePass(device, context, format, pipelineObj, camParams.frustum)
        } else {
            drawNormalPass(device, context, pipelineObj, camParams.frustum, now, transformArray)
        }

        // ------
        // Main loop ends
        // ------

        const t = performance.now() - t1
        infoRef.jsTime = (parseFloat(infoRef.jsTime) * 0.9 + t * 0.1).toFixed(3)

        controls.forEach(v => v.updateDisplay())

        stats.end()
    }

    frame()

    // re-configure context on resize
    window.addEventListener('resize', () => {
        size.width = canvas.width = canvas.clientWidth * devicePixelRatio
        size.height = canvas.height = canvas.clientHeight * devicePixelRatio
        // don't need to recall context.configure() after v104
        // re-create depth texture
        pipelineObj.depthTexture.destroy()
        pipelineObj.depthTexture = device.createTexture({
            size,
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
        pipelineObj.depthView = pipelineObj.depthTexture.createView()
        aspect = size.width / size.height
    })
}

run()