// @group(0) @binding(0) var<storage> modelViews : array<mat4x4<f32>>;
// @group(0) @binding(1) var<uniform> projection : mat4x4<f32>;
// @group(0) @binding(2) var<storage> colors : array<vec4<f32>>;

@binding(0) @group(0) var<uniform> mvpMatrix : mat4x4<f32>;

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
    var output : VertexOutput;
    var pos : vec4<f32> = mvpMatrix * position;
    output.Position = pos;
    output.fragUV = uv;
    output.fragPosition = 0.5 * (position + vec4<f32>(1.0, 1.0, 1.0, 1.0));
    return output;
}
