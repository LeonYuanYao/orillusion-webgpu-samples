const NUM = u32($$NUM$$);

@group(0) @binding(0) var<storage, read_write> modelData: array<f32>;
@group(0) @binding(1) var<uniform> time: u32;
@group(0) @binding(2) var<uniform> duration: u32;

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

    var mat4_00 = modelData[offset + 0];
    var mat4_01 = modelData[offset + 1];
    var mat4_02 = modelData[offset + 2];
    var mat4_03 = modelData[offset + 3];
    var mat4_10 = modelData[offset + 4];
    var mat4_11 = modelData[offset + 5];
    var mat4_12 = modelData[offset + 6];
    var mat4_13 = modelData[offset + 7];
    var mat4_20 = modelData[offset + 8];
    var mat4_21 = modelData[offset + 9];
    var mat4_22 = modelData[offset + 10];
    var mat4_23 = modelData[offset + 11];
    var mat4_30 = modelData[offset + 12];
    var mat4_31 = modelData[offset + 13];
    var mat4_32 = modelData[offset + 14];
    var mat4_33 = modelData[offset + 15];

    var modelMatrix = mat4x4<f32>(
	    vec4<f32>(mat4_00, mat4_01, mat4_02, mat4_03),
	    vec4<f32>(mat4_10, mat4_11, mat4_12, mat4_13),
	    vec4<f32>(mat4_20, mat4_21, mat4_22, mat4_23),
	    vec4<f32>(mat4_30, mat4_31, mat4_32, mat4_33),
    );

    var pos = vec3<f32>(mat4_30, mat4_31, mat4_32);
    var boxMin = vec3<f32>(modelData[offset + 16], modelData[offset + 17], modelData[offset + 18]);
    var boxMax = vec3<f32>(modelData[offset + 19], modelData[offset + 20], modelData[offset + 21]);
    var vel = vec3<f32>(modelData[offset + 22], modelData[offset + 23], modelData[offset + 24]);

    var round = time / duration;
    var scale = 1.0;
    if (round % 2 == 0) {
        // forward
        scale = 1.0;
    } else {
        // backward
        scale = -1.0;
    }

    vel *= vec3(scale);

    pos.x += vel.x;
    pos.y += vel.y;
    pos.z += vel.z;

    boxMin.x += vel.x;
    boxMin.y += vel.y;
    boxMin.z += vel.z;

    boxMax.x += vel.x;
    boxMax.y += vel.y;
    boxMax.z += vel.z;

    modelData[offset + 12] = pos.x;
    modelData[offset + 13] = pos.y;
    modelData[offset + 14] = pos.z;

    modelData[offset + 16] = boxMin.x;
    modelData[offset + 17] = boxMin.y;
    modelData[offset + 18] = boxMin.z;

    modelData[offset + 19] = boxMax.x;
    modelData[offset + 20] = boxMax.y;
    modelData[offset + 21] = boxMax.z;
}