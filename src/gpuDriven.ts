import { mat4 } from 'gl-matrix'
import vert from './shaders/normal-mvp.vert.wgsl?raw'
import farg from './shaders/position-mvp.frag.wgsl?raw'
import * as model from './util/sphere'
import { getMvpMatrix } from './util/math'
import { Transform } from './util/types'
import { createInspectorBuffer, initCameraEvents, initTools } from './util/utils'

// 1. bbox & matrix into buffer
// 2. compute pass for frustum culling
// 3. write instance num (0 or 1) into IndirectBuffer

const RINGS = 8
const CUBES_PER_RING = 400
const NUM = CUBES_PER_RING * RINGS
console.log('NUM', NUM)

const CAMERA_CONFIG = {
    fovy: 100,
    near: 0.1, 
    far: 10000
}

const infoRef = {
    drawcount: 0,
    bundleRenderMode: false,
}

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
        // prevent chrome warning after v102
        alphaMode: 'opaque'
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
        indirectData[offset + 0] = model.indexCount     // indexCount
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
        indirectData[0] = model.indexCount     // indexCount
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
async function initPipeline(device: GPUDevice, format: GPUTextureFormat, size:{width:number, height:number}) {
    const pipeline = await device.createRenderPipelineAsync({
        label: 'Basic Pipline',
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: vert,
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
                code: farg,
            }),
            entryPoint: 'main',
            targets: [
                {
                    format: format
                }
            ]
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
    // create vertex buffer
    const vertexBuffer = device.createBuffer({
        label: 'GPUBuffer store vertex',
        size: model.vertex.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(vertexBuffer, 0, model.vertex)

    const indexBuffer = device.createBuffer({
        label: 'GPUBuffer store index',
        size: model.index.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(indexBuffer, 0, model.index)

    const bindGroups: GPUBindGroup[] = []
    const mvpBuffer = device.createBuffer({
        label: 'GPUBuffer store 4x4 matrix',
        // size: 4 * 4 * 4 * NUM, // 4 x 4 x float32
        size: 256 * NUM, // minimum offset is 256
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    for (let i = 0; i < NUM; i++) {
        // create a 4x4 mvp matrix1
        // const mvpBuffer = device.createBuffer({
        //     label: 'GPUBuffer store 4x4 matrix ' + i,
        //     size: 4 * 4 * 4, // 4 x 4 x float32
        //     usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        // })

        // create a uniform group for Matrix2
        const group = device.createBindGroup({
            label: 'Uniform Group with matrix ' + i,
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: mvpBuffer,
                        // offset: 4 * 4 * 4 * i,
                        offset: 256 * i,
                        size: 4 * 4 * 4,
                    }
                }
            ]
        })

        bindGroups.push(group)
    }

    const indirectBuffer = createInterleavedIndirectBuffer(device)

    // return all vars
    return {pipeline, depthTexture, depthView, vertexBuffer, indexBuffer, mvpBuffer, bindGroups, indirectBuffer}
}

// function genObjectTransforms(): [Transform[]] {
//     const transforms: Transform[] = []
//     const height = RINGS * 10
//     const distance = 10
//     for (let i = 0; i < RINGS; i++) {
//         for (let j = 0; j < CUBES_PER_RING; j++) {
//             const rad = j / (CUBES_PER_RING - 1) * Math.PI * 2
//             const h = height * i / (RINGS - 1) - height / 2
//             const currDist = distance + i * 2
//             const position = {x: Math.sin(rad) * currDist, y: h, z: Math.cos(rad) * currDist}
//             const rotation = {x: 0, y: 0, z: 0}
//             const scale = {x: 1, y: 1, z: 1}
//             transforms.push({
//                 position,
//                 rotation,
//                 scale,
//                 matrix: mat4.create(),
//                 boundingSphere: {
//                     center: position,
//                     radius: 1,
//                 }
//             })
//         }
//     }
//     return [transforms];
// }

function genObjectInterleavedTransforms(): [Transform[], Float32Array] {
    const transforms: Transform[] = []
    const mvpArray = new Float32Array(16 * NUM)
    const height = RINGS * 10
    const distance = 10
    for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < CUBES_PER_RING; j++) {
            const rad = j / (CUBES_PER_RING - 1) * Math.PI * 2
            const h = height * i / (RINGS - 1) - height / 2
            const currDist = distance + i * 2
            const position = {x: Math.sin(rad) * currDist, y: h, z: Math.cos(rad) * currDist}
            const rotation = {x: 0, y: 0, z: 0}
            const scale = {x: 1, y: 1, z: 1}
            transforms.push({
                position,
                rotation,
                scale,
                matrix: mat4.create(),
                boundingSphere: {
                    center: position,
                    radius: 1,
                }
            })
        }
    }
    return [transforms, mvpArray];
}

let renderBundles: GPURenderBundle[] | null = null

function drawRenderBundle(
    device: GPUDevice, 
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    pipelineObj: {
        pipeline: GPURenderPipeline,
        vertexBuffer: GPUBuffer,
        indexBuffer: GPUBuffer,
        depthView: GPUTextureView,
        mvpBuffer: GPUBuffer,
        bindGroups: GPUBindGroup[],
        indirectBuffer: GPUBuffer,
    },
) {
    const {pipeline, depthView, vertexBuffer, indexBuffer, bindGroups, indirectBuffer} = pipelineObj;

    infoRef.drawcount = 0

    if (!renderBundles) {
        const bundleEncoder = device.createRenderBundleEncoder({
            colorFormats: [format],
            depthStencilFormat: 'depth24plus'
        })
        bundleEncoder.setPipeline(pipeline)
        bundleEncoder.setVertexBuffer(0, vertexBuffer)
        bundleEncoder.setIndexBuffer(indexBuffer, "uint16")
        for (let i = 0; i < NUM; i++) {
            bundleEncoder.setBindGroup(0, bindGroups[i])
            // passEncoder.draw(cube.vertexCount, 1)
            bundleEncoder.drawIndexedIndirect(indirectBuffer, 5 * 4 * i)

            infoRef.drawcount++
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

    infoRef.drawcount++

    device.queue.submit([commandEncoder.finish()])
}

function drawNormalPass(
    device: GPUDevice, 
    context: GPUCanvasContext,
    pipelineObj: {
        pipeline: GPURenderPipeline,
        vertexBuffer: GPUBuffer,
        indexBuffer: GPUBuffer,
        depthView: GPUTextureView,
        mvpBuffer: GPUBuffer,
        bindGroups: GPUBindGroup[],
        indirectBuffer: GPUBuffer,
    },
) {
    infoRef.drawcount = 0

    const {pipeline, depthView, vertexBuffer, indexBuffer, bindGroups, indirectBuffer} = pipelineObj;
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
    passEncoder.setVertexBuffer(0, vertexBuffer)
    passEncoder.setIndexBuffer(indexBuffer, "uint16")
    for (let i = 0; i < NUM; i++) {
        passEncoder.setBindGroup(0, bindGroups[i])
        // passEncoder.draw(cube.vertexCount, 1)
        passEncoder.drawIndexedIndirect(indirectBuffer, 5 * 4 * i)

        infoRef.drawcount++
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
    const { mvpBuffer } = pipelineObj

    // default state
    let aspect = size.width / size.height

    const [transforms, mvpArray] = genObjectInterleavedTransforms();

    const camParams = {
        ...CAMERA_CONFIG,
        viewMatrix: mat4.create(),
        projectionMatrix: mat4.create(),
    }

    initCameraEvents(canvas, mat => camParams.viewMatrix = mat)

    const {stats, gui} = initTools();
    const drawcountControl = gui.add(infoRef, 'drawcount')
    const bundleControl = gui.add(infoRef, 'bundleRenderMode')

    // start loop
    function frame() {
        stats.begin()

        // ------
        // Main loop
        // ------

        const now = Date.now() / 1000
        let offset = 0
        for (let i = 0; i < NUM; i++) {
            const ratio = i / (NUM - 1)
            const {position, rotation, scale, matrix} = transforms[i];
            rotation.x = Math.sin(now + Math.PI / 4 * ratio)
            rotation.y = Math.cos(now + Math.PI / 4 * ratio)
            const mvpMatrix = getMvpMatrix(aspect, position, rotation, scale, matrix, camParams)
            mvpArray.set(mvpMatrix, offset)
            offset += 16
        }

        device.queue.writeBuffer(mvpBuffer, 0, mvpArray)

        if (infoRef.bundleRenderMode) {
            drawRenderBundle(device, context, format, pipelineObj)
        } else {
            drawNormalPass(device, context, pipelineObj)
        }

        // ------
        // Main loop
        // ------

        stats.end()
        drawcountControl.updateDisplay()
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