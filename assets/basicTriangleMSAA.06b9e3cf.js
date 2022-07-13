import"./modulepreload-polyfill.b7f2da20.js";import{t as d,r as u}from"./red.frag.553e6bc6.js";async function g(e){if(!navigator.gpu)throw new Error("Not Support WebGPU");const t=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!t)throw new Error("No Adapter Found");const o=await t.requestDevice(),n=e.getContext("webgpu"),r=navigator.gpu.getPreferredCanvasFormat?navigator.gpu.getPreferredCanvasFormat():n.getPreferredFormat(t),a=window.devicePixelRatio||1;e.width=e.clientWidth*a,e.height=e.clientHeight*a;const i={width:e.width,height:e.height};return n.configure({device:o,format:r,alphaMode:"opaque"}),{device:o,context:n,format:r,size:i}}async function l(e,t){const o={layout:"auto",vertex:{module:e.createShaderModule({code:d}),entryPoint:"main"},primitive:{topology:"triangle-list"},fragment:{module:e.createShaderModule({code:u}),entryPoint:"main",targets:[{format:t}]},multisample:{count:4}};return await e.createRenderPipelineAsync(o)}function s(e,t,o,n){const r=e.createCommandEncoder(),a={colorAttachments:[{view:n,resolveTarget:t.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]},i=r.beginRenderPass(a);i.setPipeline(o),i.draw(3),i.end(),e.queue.submit([r.finish()])}async function p(){const e=document.querySelector("canvas");if(!e)throw new Error("No Canvas");const{device:t,context:o,format:n,size:r}=await g(e),a=await l(t,n);let i=t.createTexture({size:r,format:n,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT}),c=i.createView();s(t,o,a,c),window.addEventListener("resize",()=>{r.width=e.width=e.clientWidth*devicePixelRatio,r.height=e.height=e.clientHeight*devicePixelRatio,i.destroy(),i=t.createTexture({size:r,format:n,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT}),c=i.createView(),s(t,o,a,c)})}p();
