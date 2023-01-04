const NUM = u32($$NUM$$);

struct Frustum {
    p0: vec4<f32>,
    p1: vec4<f32>,
    p2: vec4<f32>,
    p3: vec4<f32>,
    p4: vec4<f32>,
    p5: vec4<f32>,
}

@group(0) @binding(0) var<storage, read_write> modelData: array<f32>;
@group(0) @binding(1) var<uniform> frustum: Frustum;
@group(0) @binding(2) var<storage, read_write> indirectData: array<u32>;

const groupSize = u32(128);
@compute @workgroup_size(groupSize)
fn main(
    @builtin(global_invocation_id) GlobalInvocationID : vec3<u32>
) {
    var index: u32 = GlobalInvocationID.x;
    if(index >= NUM){
        return;
    }

    var offset = index * 64;

    var boxMin = vec3<f32>(modelData[offset + 16], modelData[offset + 17], modelData[offset + 18]);
    var boxMax = vec3<f32>(modelData[offset + 19], modelData[offset + 20], modelData[offset + 21]);

    if (frustumIntersectsBox(frustum, boxMin, boxMax) > 0) {
        indirectData[5 * index + 1] = 1; // instance count set to 1, draw object
    } else {
        indirectData[5 * index + 1] = 0; // instance count set to 0, skip draw
    }
}

fn distanceToPoint(plane: vec4<f32>, pos: vec3<f32>) -> f32 {
    var normal = vec3(plane.x, plane.y, plane.z);
    return dot(normal, pos) + plane.w;
}

fn planeIntersectsBox(plane: vec4<f32>, boxMin: vec3<f32>, boxMax: vec3<f32>) -> i32 {
    var normal = vec3(plane.x, plane.y, plane.z);
    var constant = plane.w;
    var vector = vec3(0.0, 0.0, 0.0);
    if (normal.x > 0) {
        vector.x = boxMax.x;
    } else {
        vector.x = boxMin.x;
    }
    if (normal.y > 0) {
        vector.y = boxMax.y;
    } else {
        vector.y = boxMin.y;
    }
    if (normal.z > 0) {
        vector.z = boxMax.z;
    } else {
        vector.z = boxMin.z;
    }
    if (distanceToPoint(plane, vector) < 0.0) {
        return -1;
    }
    return 1;
}

fn frustumIntersectsBox(frustum: Frustum, boxMin: vec3<f32>, boxMax: vec3<f32>) -> i32 {
    if (planeIntersectsBox(frustum.p0, boxMin, boxMax) < 0) {
        return -1;
    }
    if (planeIntersectsBox(frustum.p1, boxMin, boxMax) < 0) {
        return -1;
    }
    if (planeIntersectsBox(frustum.p2, boxMin, boxMax) < 0) {
        return -1;
    }
    if (planeIntersectsBox(frustum.p3, boxMin, boxMax) < 0) {
        return -1;
    }
    if (planeIntersectsBox(frustum.p4, boxMin, boxMax) < 0) {
        return -1;
    }
    if (planeIntersectsBox(frustum.p5, boxMin, boxMax) < 0) {
        return -1;
    }
    return 1;
}