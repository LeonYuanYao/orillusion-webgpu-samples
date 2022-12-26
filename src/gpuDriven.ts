import { mat4, vec3 } from 'gl-matrix'
import vertex from './shaders/normal-mvp.vert.wgsl?raw'
import fragment from './shaders/position-mvp.frag.wgsl?raw'
import * as sphere from './util/sphere'
import * as cube from './util/cube'
import { getModelMatrix, getProjectionMatrix } from './util/math'
import { Transform } from './util/types'
import { createInspectorBuffer, regCameraViewEvent, initTools } from './util/utils'
import { Frustum } from './util/frustum/frustum'
import { Sphere } from './util/frustum/sphere'
import { Box3 } from './util/frustum/box'

// 1. bbox & matrix into buffer
// 2. compute pass for frustum culling
// 3. write instance num (0 or 1) into IndirectBuffer

const RINGS = 30
const CUBES_PER_RING = 200
const NUM = CUBES_PER_RING * RINGS
console.log('NUM', NUM)

const CAMERA_CONFIG = {
    fovy: 100,
    near: 0.1, 
    far: 10000
}

const infoRef: {[key: string]: any} = {
    drawCount: '0',
    jsTime: '0',
    bundleRenderMode: false,
}

const visArrayBuffer = new Uint8Array(NUM)

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

function createInterleavedIndirectBuffer(device: GPUDevice) {
    const stride = 5
    const indirectBuffer = device.createBuffer({
        label: 'Indirect Buffer',
        size: stride * 4 * NUM, // 4 x Uint32: vertexCount instanceCount firstVertex firstInstance
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    })
    const indirectData = new Uint32Array(stride * NUM)

    let offset = 0
    for (let i = 0; i < NUM; i++) {
        indirectData[offset + 0] = sphere.indexCount     // indexCount
        indirectData[offset + 1] = 1                     // instanceCount
        indirectData[offset + 2] = 0                     // firstIndex
        indirectData[offset + 3] = 0                     // baseVertex
        indirectData[offset + 4] = 0                     // firstInstance
        offset += stride
    }
    device.queue.writeBuffer(indirectBuffer, 0, indirectData)
    console.log('indirectData', indirectData)

    return indirectBuffer
}

function createIndirectBuffers(device: GPUDevice) {
    const stride = 5
    const indirectBuffers: GPUBuffer[] = []
    for (let i = 0; i < NUM; i++) {
        const indirectBuffer = device.createBuffer({
            label: 'Indirect Buffer',
            size: stride * 4, // stride x Uint32: vertexCount instanceCount firstVertex firstInstance
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        })
        const indirectData = new Uint32Array(stride)
        indirectData[0] = sphere.indexCount     // indexCount
        indirectData[1] = 1                     // instanceCount
        indirectData[2] = 0                     // firstIndex
        indirectData[3] = 0                     // baseVertex
        indirectData[4] = 0                     // firstInstance
        device.queue.writeBuffer(indirectBuffer, 0, indirectData)
        indirectBuffers.push(indirectBuffer)
    }
    console.log('indirectData', indirectBuffers)

    return indirectBuffers
}

// create pipiline & buffers
interface Pipeline {
    pipeline: GPURenderPipeline;
    depthTexture: GPUTexture;
    depthView: GPUTextureView;
    sphereVB: GPUBuffer;
    sphereIB: GPUBuffer;
    cubeVB: GPUBuffer;
    modelMatrixBuffer: GPUBuffer;
    vpBuffer: GPUBuffer;
    bindGroups: GPUBindGroup[];
    vpBindGroup: GPUBindGroup;
    indirectBuffer: GPUBuffer;
}
async function initPipeline(device: GPUDevice, format: GPUTextureFormat, size:{width:number, height:number}): Promise<Pipeline> {
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
            // Culling backfaces pointing away from the camera
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

    // create vertex buffer SPHERE
    const sphereVB = device.createBuffer({
        label: 'sphere vertex buffer',
        size: sphere.vertex.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(sphereVB, 0, sphere.vertex)

    const sphereIB = device.createBuffer({
        label: 'sphere index buffer',
        size: sphere.index.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(sphereIB, 0, sphere.index)

    // create vertex buffer CUBE
    const cubeVB = device.createBuffer({
        label: 'cube vertex buffer',
        size: cube.vertex.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(cubeVB, 0, cube.vertex)

    // Uniforms
    const vpBuffer = device.createBuffer({
        label: 'ViewProjection Matrix Buffer',
        size: 16 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const vpBindGroup = device.createBindGroup({
        label: 'ViewProjection UBO',
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

    const bindGroups: GPUBindGroup[] = []
    const modelMatrixBuffer = device.createBuffer({
        label: 'Object Model Matrix Buffer',
        size: 256 * NUM, // webgpu minimum offset: 256 bytes
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    const modelMatrixLayout = pipeline.getBindGroupLayout(1)
    for (let i = 0; i < NUM; i++) {
        // const mvpBuffer = device.createBuffer({
        //     label: 'GPUBuffer store 4x4 matrix ' + i,
        //     size: 4 * 4 * 4, // 4 x 4 x float32
        //     usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        // })

        const group = device.createBindGroup({
            label: 'Model Matrix Uniform ' + i,
            layout: modelMatrixLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: modelMatrixBuffer,
                        offset: 256 * i,
                        size: 4 * 4 * 4,
                    }
                }
            ]
        })

        bindGroups.push(group)
    }

    const indirectBuffer = createInterleavedIndirectBuffer(device)

    return {
        pipeline, 
        depthTexture, 
        depthView, 
        sphereVB, 
        sphereIB,
        cubeVB, 
        modelMatrixBuffer, 
        vpBuffer, 
        bindGroups, 
        vpBindGroup, 
        indirectBuffer
    }
}

function genObjectInterleavedTransforms(): [Transform[], Float32Array] {
    const transforms: Transform[] = []
    const transformArray = new Float32Array(16 * NUM)
    const height = RINGS * 5
    const distance = CUBES_PER_RING / 10
    let offset = 0
    for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < CUBES_PER_RING; j++) {
            const rad = j / (CUBES_PER_RING - 1) * Math.PI * 2
            const h = height * i / (RINGS - 1) - height / 2
            const currDist = distance + i * 0
            const position = {x: Math.sin(rad) * currDist, y: h, z: Math.cos(rad) * currDist}
            const rotation = {x: 0, y: 0, z: 0}
            const scale = {x: 1, y: 1, z: 1}
            const matrix = getModelMatrix(position, rotation, scale)
            transformArray.set(matrix, offset)
            transforms.push({
                position,
                rotation,
                scale,
                matrix,
                boundingSphere: new Sphere(vec3.fromValues(position.x, position.y, position.z), 1),
                boundingBox: new Box3(),
            })
            offset += 16
        }
    }
    return [transforms, transformArray];
}

let renderBundles: GPURenderBundle[] | null = null

function drawRenderBundle(
    device: GPUDevice, 
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    pipelineObj: Pipeline,
) {
    const {pipeline, depthView, sphereVB, sphereIB, vpBindGroup, bindGroups, indirectBuffer} = pipelineObj;

    if (!renderBundles) {
        const bundleEncoder = device.createRenderBundleEncoder({
            colorFormats: [format],
            depthStencilFormat: 'depth24plus'
        })
        bundleEncoder.setPipeline(pipeline)
        bundleEncoder.setBindGroup(0, vpBindGroup)
        bundleEncoder.setVertexBuffer(0, sphereVB)
        bundleEncoder.setIndexBuffer(sphereIB, "uint16")
        for (let i = 0; i < NUM; i++) {
            bundleEncoder.setBindGroup(1, bindGroups[i])
            // passEncoder.draw(cube.vertexCount, 1)
            bundleEncoder.drawIndexedIndirect(indirectBuffer, 5 * 4 * i)

            infoRef.drawCount++
        }
        renderBundles = [bundleEncoder.finish()]
    }

    const commandEncoder = device.createCommandEncoder()
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

    infoRef.drawCount++
}

function drawNormalPass(
    device: GPUDevice, 
    context: GPUCanvasContext,
    pipelineObj: Pipeline,
) {
    const {pipeline, depthView, sphereVB, sphereIB, vpBindGroup, bindGroups, indirectBuffer} = pipelineObj;
    const commandEncoder = device.createCommandEncoder()
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
    passEncoder.setVertexBuffer(0, sphereVB)
    passEncoder.setIndexBuffer(sphereIB, "uint16")
    for (let i = 0; i < NUM; i++) {
        passEncoder.setBindGroup(1, bindGroups[i])
        // passEncoder.drawIndexed(sphere.indexCount, 1)
        passEncoder.drawIndexedIndirect(indirectBuffer, 5 * 4 * i)
        infoRef.drawCount++
    }
    passEncoder.end()
    device.queue.submit([commandEncoder.finish()])
}

async function run(){
    const canvas = document.querySelector('canvas')
    if (!canvas)
        throw new Error('No Canvas')
    const {device, context, format, size} = await initWebGPU(canvas)
    const pipelineObj = await initPipeline(device, format, size)
    const { vpBuffer, modelMatrixBuffer } = pipelineObj

    // default state
    let aspect = size.width / size.height

    const [transforms, transformArray] = genObjectInterleavedTransforms();
    device.queue.writeBuffer(modelMatrixBuffer, 0, transformArray)

    const camParams = {
        ...CAMERA_CONFIG,
        viewMatrix: mat4.create(),
        projectionMatrix: mat4.create(),
        vpMatrix: mat4.create(),
        frustum: new Frustum(),
    }
    
    const updateCamera = regCameraViewEvent(canvas, mat => camParams.viewMatrix = mat)

    const {stats, gui} = initTools();
    const controls = [
        gui.add(infoRef, 'drawCount'),
        gui.add(infoRef, 'jsTime'),
        gui.add(infoRef, 'bundleRenderMode')
    ];

    // start loop
    function frame() {
        stats.begin()

        const t1 = performance.now();
        infoRef.drawCount = 0

        // ------
        // Main loop
        // ------

        const now = Date.now() / 1000
        updateCamera()

        // Update camera matrices
        getProjectionMatrix(aspect, camParams.fovy, camParams.near, camParams.far, undefined, camParams.projectionMatrix)
        mat4.mul(camParams.vpMatrix, camParams.projectionMatrix, camParams.viewMatrix)
        device.queue.writeBuffer(vpBuffer, 0, camParams.vpMatrix as Float32Array)

        camParams.frustum.setFromProjectionMatrix(camParams.projectionMatrix);

        // let offset = 0
        // for (let i = 0; i < NUM; i++) {
        //     const ratio = i / (NUM - 1)
        //     const {position, rotation, scale, matrix} = transforms[i];
        //     rotation.x = Math.sin(now + Math.PI / 4 * ratio)
        //     rotation.y = Math.cos(now + Math.PI / 4 * ratio)
        //     transformArray.set(getModelMatrix(position, rotation, scale, matrix), offset)
        //     offset += 16
        // }
        // device.queue.writeBuffer(modelMatrixBuffer, 0, transformArray)

        if (infoRef.bundleRenderMode) {
            drawRenderBundle(device, context, format, pipelineObj)
        } else {
            drawNormalPass(device, context, pipelineObj)
        }

        // ------
        // Main loop
        // ------

        const t = performance.now() - t1
        infoRef.jsTime = (parseFloat(infoRef.jsTime) * 0.9 + t * 0.1).toFixed(3)

        stats.end()
        controls.forEach(v => v.updateDisplay())
        requestAnimationFrame(frame)
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
        // update aspect
        aspect = size.width/ size.height
    })
}

run()