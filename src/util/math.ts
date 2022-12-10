import { mat4, vec3 } from 'gl-matrix'

const _modelViewMatrix = mat4.create();
const _projectionMatrix = mat4.create();
const camPosition = {x:0, y:0, z:0}

// return mvp matrix from given aspect, position, rotation, scale
function getMvpMatrix(
    aspect: number,
    position: {x:number, y:number, z:number},
    rotation: {x:number, y:number, z:number},
    scale: {x:number, y:number, z:number},
    outMatrix = mat4.create(),
    camParams: { fovy?: number; near?: number; far?: number; viewMatrix?: mat4; } = {},
){
    // get modelView Matrix
    const modelViewMatrix = getModelViewMatrix(position, rotation, scale, _modelViewMatrix, camParams.viewMatrix)
    // get projection Matrix
    const projectionMatrix = getProjectionMatrix(aspect, camParams.fovy, camParams.near, camParams.far, camPosition, _projectionMatrix)
    // get mvp matrix
    mat4.multiply(outMatrix, projectionMatrix, modelViewMatrix)
    
    return outMatrix as Float32Array
}

// return modelView matrix from given position, rotation, scale
function getModelViewMatrix(
    position = {x:0, y:0, z:0},
    rotation = {x:0, y:0, z:0},
    scale = {x:1, y:1, z:1},
    outMatrix = mat4.create(),
    viewMatrix?: mat4
){
    getModelMatrix(position, rotation, scale, outMatrix)
    return viewMatrix ? mat4.mul(outMatrix, viewMatrix, outMatrix) : outMatrix;
}

function getModelMatrix(
    position = {x:0, y:0, z:0},
    rotation = {x:0, y:0, z:0},
    scale = {x:1, y:1, z:1},
    outMatrix = mat4.create(),
) {
    mat4.identity(outMatrix)
    // translate position
    mat4.translate(outMatrix, outMatrix, vec3.fromValues(position.x, position.y, position.z))
    // rotate
    mat4.rotateX(outMatrix, outMatrix, rotation.x)
    mat4.rotateY(outMatrix, outMatrix, rotation.y)
    mat4.rotateZ(outMatrix, outMatrix, rotation.z)
    // scale
    mat4.scale(outMatrix, outMatrix, vec3.fromValues(scale.x, scale.y, scale.z))

    return outMatrix as Float32Array
}

const center = vec3.fromValues(0,0,0)
const up = vec3.fromValues(0,1,0)
const cameraView = mat4.create()
const DEG2RAD = (deg: number) => deg / 180 * Math.PI

function getProjectionMatrix(
    aspect: number,
    fov = 60,
    near = 0.1,
    far = 100.0,
    position = {x:0, y:0, z:0},
    outMatrix = mat4.create()
){  
    // const eye = vec3.fromValues(position.x, position.y, position.z)
    // mat4.translate(cameraView, cameraView, eye)
    // mat4.lookAt(cameraView, eye, center, up)
    
    mat4.identity(outMatrix)
    mat4.perspective(outMatrix, DEG2RAD(fov), aspect, near, far)
    // mat4.multiply(outMatrix, outMatrix, cameraView)

    return outMatrix as Float32Array
}

export { getMvpMatrix, getModelViewMatrix, getProjectionMatrix, getModelMatrix }