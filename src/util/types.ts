import { mat4 } from "gl-matrix";

export type Vec3 = {x: number; y: number; z: number;}

export type AABB = {
  min: Vec3;
  max: Vec3;
}

export type Sphere = {
  radius: number;
  center: Vec3;
}

export type Transform = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  matrix: mat4;
  boundingSphere: Sphere;
}