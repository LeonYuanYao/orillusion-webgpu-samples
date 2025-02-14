@group(0) @binding(0) var<uniform> vpMatrix : mat4x4<f32>;
@group(1) @binding(0) var<storage> modelMatrix : mat4x4<f32>;

struct VertexOutput {
    @builtin(position) Position : vec4<f32>,
    @location(0) fragUV : vec2<f32>,
    @location(1) fragPosition: vec4<f32>
};

@vertex
fn main(
    @builtin(instance_index) index : u32,
    @location(0) position : vec4<f32>,
    @location(1) normal : vec3<f32>,
    @location(2) uv : vec2<f32>,
) -> VertexOutput {
    var mvpMatrix : mat4x4<f32> = vpMatrix * modelMatrix;
    var output : VertexOutput;
    var pos : vec4<f32> = mvpMatrix * position;
    output.Position = pos;
    output.fragUV = uv;
    output.fragPosition = 0.5 * (position + vec4<f32>(1.0, 1.0, 1.0, 1.0));
    return output;
}
