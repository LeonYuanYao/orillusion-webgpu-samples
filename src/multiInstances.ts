// check webgpu support
async function initWebGPU() {
    try{
        if(!navigator.gpu)
            throw new Error('Not support WebGPU')

        const adapter = await navigator.gpu.requestAdapter()
        if(!adapter)
            throw new Error('No adapter found')
        console.log('adapter', adapter)

        const adapter2 = await navigator.gpu.requestAdapter()
        console.log('adapter2', adapter2)
        
        const device = await adapter.requestDevice()
        console.log('device', device)
        const device2 = await adapter.requestDevice()
        console.log('device2', device2)

        const buffer = await device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
        })
        console.log('buffer', buffer)
        const buffer2 = await device2.createBuffer({
            size: 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
        })
        console.log('buffer2', buffer2)

        device2.queue.writeBuffer(buffer, 0, new Uint32Array([255]))

        document.body.innerHTML = '<h1>Multi Instances Tests</h1>'
        document.body.innerHTML += `<p>{adapter === adapter2} : ${adapter === adapter2}</p>`
        document.body.innerHTML += `<p>{device === device2} : ${device === device2}</p>`
        document.body.innerHTML += `<p>{Write buffer1 with device2} : Check console</p>`
            
    } catch (error: any) {
        document.body.innerHTML = `<h1>${error.message}</h1>`
    }
}

initWebGPU()