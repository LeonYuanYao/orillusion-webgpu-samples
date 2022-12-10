import { mat4 } from 'gl-matrix'
import basicVert from './shaders/basic.vert.wgsl?raw'
import positionFrag from './shaders/position.frag.wgsl?raw'
import * as cube from './util/cube'
import { getMvpMatrix } from './util/math'
import { createInspectorBuffer, initCameraEvents } from './util/utils'

// 1. bbox & matrix into buffer
// 2. compute pass for frustum culling
// 3. write instance num (0 or 1) into IndirectBuffer

const RINGS = 10
const CUBES_PER_RING = 60
const NUM = CUBES_PER_RING * RINGS
console.log('NUM', NUM)

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

// create pipiline & buffers
async function initPipeline(device: GPUDevice, format: GPUTextureFormat, size:{width:number, height:number}) {
    const pipeline = await device.createRenderPipelineAsync({
        label: 'Basic Pipline',
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: basicVert,
            }),
            entryPoint: 'main',
            buffers: [{
                arrayStride: 5 * 4, // 3 position 2 uv,
                attributes: [
                    {
                        // position
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3',
                    },
                    {
                        // uv
                        shaderLocation: 1,
                        offset: 3 * 4,
                        format: 'float32x2',
                    }
                ]
            }]
        },
        fragment: {
            module: device.createShaderModule({
                code: positionFrag,
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
        size: cube.vertex.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(vertexBuffer, 0, cube.vertex)

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

    // return all vars
    return {pipeline, depthTexture, depthView, vertexBuffer, mvpBuffer, bindGroups}
}

function createInterleavedIndirectData(device: GPUDevice) {
    const indirectBuffer = device.createBuffer({
        label: 'Indirect Buffer',
        size: 4 * 4 * NUM, // 4 x Uint32: vertexCount instanceCount firstVertex firstInstance
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    })
    const indirectData = new Uint32Array(4 * NUM)

    let offset = 0
    for (let i = 0; i < NUM; i++) {
        indirectData[offset + 0] = cube.vertexCount     // vertexCount
        indirectData[offset + 1] = 1                    // instanceCount
        indirectData[offset + 2] = 0                    // firstVertex
        indirectData[offset + 3] = 0                    // firstInstance
        offset += 4
    }
    device.queue.writeBuffer(indirectBuffer, 0, indirectData)
    console.log('indirectData', indirectData)
    return indirectBuffer
}

function createIndirectData(device: GPUDevice) {
    const indirectBuffers: GPUBuffer[] = []
    for (let i = 0; i < NUM; i++) {
        const indirectBuffer = device.createBuffer({
            label: 'Indirect Buffer',
            size: 4 * 4, // 4 x Uint32: vertexCount instanceCount firstVertex firstInstance
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        })
        const indirectData = new Uint32Array(4)
        indirectData[0] = cube.vertexCount     // vertexCount
        indirectData[1] = 1                    // instanceCount
        indirectData[2] = 0                    // firstVertex
        indirectData[3] = 0                    // firstInstance
        device.queue.writeBuffer(indirectBuffer, 0, indirectData)
        indirectBuffers.push(indirectBuffer)
    }
    console.log('indirectData', indirectBuffers)
    return indirectBuffers
}

// create & submit device commands
function draw(
    device: GPUDevice, 
    context: GPUCanvasContext,
    pipelineObj: {
        pipeline: GPURenderPipeline,
        vertexBuffer: GPUBuffer,
        depthView: GPUTextureView,
        mvpBuffer: GPUBuffer,
        bindGroups: GPUBindGroup[],
    },
    indirectBuffer: GPUBuffer,
) {
    const {pipeline, depthView, vertexBuffer, bindGroups} = pipelineObj;
    // start encoder
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
    // set vertex
    passEncoder.setVertexBuffer(0, vertexBuffer)
    // indirect draws
    for (let i = 0; i < NUM; i++) {
        // draw second cube
        passEncoder.setBindGroup(0, bindGroups[i])
        // passEncoder.draw(cube.vertexCount, 1)
        passEncoder.drawIndirect(indirectBuffer, 4 * 4 * i)
    }
    passEncoder.end()
    // webgpu run in a separate process, all the commands will be executed after submit
    device.queue.submit([commandEncoder.finish()])
}

function genObjectTransforms() {
    const transforms: any[] = []
    const height = 50
    const distance = 40
    for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < CUBES_PER_RING; j++) {
            const rad = j / (CUBES_PER_RING - 1) * Math.PI * 2
            const h = height * i / (RINGS - 1) - height / 2
            // const position = {x: -span / 2 + ratio * span, y: 0, z: -dist}
            // const rotation = {x: 0, y: 0, z: 0}
            // const scale = {x: 1, y: 1, z: 1}    
            const position = {x: Math.sin(rad) * distance, y: h, z: Math.cos(rad) * distance}
            const rotation = {x: 0, y: 0, z: 0}
            const scale = {x: 1, y: 1, z: 1}
            transforms.push({
                position,
                rotation,
                scale,
                matrix: mat4.create(),
            })
        }
    }
    return transforms;
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

    // indirect
    const indirectBuffers = createInterleavedIndirectData(device)

    const transforms = genObjectTransforms();

    const camParams = {
        fovy: 100,
        near: 0.1, 
        far: 10000,
        viewMatrix: mat4.create(),
    }
    initCameraEvents(mat => camParams.viewMatrix = mat)

    // start loop
    function frame() {
        const now = Date.now() / 1000
        for (let i = 0; i < NUM; i++) {
            const ratio = i / (NUM - 1)
            const {position, rotation, scale, matrix} = transforms[i];

            rotation.x = Math.sin(now + Math.PI / 4 * ratio)
            rotation.y = Math.cos(now + Math.PI / 4 * ratio)

            const mvpMatrix = getMvpMatrix(aspect, position, rotation, scale, matrix, camParams)

            // device.queue.writeBuffer(mvpBuffer, 4 * 4 * 4 * i, mvpMatrix)
            device.queue.writeBuffer(mvpBuffer, 256 * i, mvpMatrix)
        }
        // draw
        draw(device, context, pipelineObj, indirectBuffers)
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