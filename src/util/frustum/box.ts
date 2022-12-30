import { vec3 } from "gl-matrix";
import { Sphere } from "./sphere";
import { clamp, distanceToSquared } from "../math";
import { Plane } from "./plane";

export class Box3 {
  min: vec3;
  max: vec3;

  constructor(min?: vec3, max?: vec3) {
		this.min = vec3.fromValues(Infinity, Infinity, Infinity);
		this.max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
		min && vec3.copy(this.min, min)
		max && vec3.copy(this.max, max)
  }

  clampPoint( point: vec3, target: vec3 ) {

    vec3.copy(target, point);
    return clamp(target, target, this.min, this.max);

	}

  intersectsBox( box: Box3 ) {

		// using 6 splitting planes to rule out intersections.
		return box.max[0] < this.min[0] || box.min[0] > this.max[0] ||
			box.max[1] < this.min[1] || box.min[1] > this.max[1] ||
			box.max[2] < this.min[2] || box.min[2] > this.max[2] ? false : true;

	}

	intersectsSphere( sphere: Sphere ) {

		// Find the point on the AABB closest to the sphere center.
		this.clampPoint( sphere.center, _vector );

		// If that point is inside the sphere, the AABB and sphere intersect.
    return distanceToSquared(_vector, sphere.center) <= ( sphere.radius * sphere.radius );

	}

	intersectsPlane( plane: Plane ) {

		// We compute the minimum and maximum dot product values. If those values
		// are on the same side (back or front) of the plane, then there is no intersection.

		let min, max;

		if ( plane.normal[0] > 0 ) {

			min = plane.normal[0] * this.min[0];
			max = plane.normal[0] * this.max[0];

		} else {

			min = plane.normal[0] * this.max[0];
			max = plane.normal[0] * this.min[0];

		}

		if ( plane.normal[1] > 0 ) {

			min += plane.normal[1] * this.min[1];
			max += plane.normal[1] * this.max[1];

		} else {

			min += plane.normal[1] * this.max[1];
			max += plane.normal[1] * this.min[1];

		}

		if ( plane.normal[2] > 0 ) {

			min += plane.normal[2] * this.min[2];
			max += plane.normal[2] * this.max[2];

		} else {

			min += plane.normal[2] * this.max[2];
			max += plane.normal[2] * this.min[2];

		}

		return ( min <= - plane.constant && max >= - plane.constant );

	}

	// intersectsTriangle( triangle ) {

	// 	if ( this.isEmpty() ) {

	// 		return false;

	// 	}

	// 	// compute box center and extents
	// 	this.getCenter( _center );
	// 	_extents.subVectors( this.max, _center );

	// 	// translate triangle to aabb origin
	// 	_v0.subVectors( triangle.a, _center );
	// 	_v1.subVectors( triangle.b, _center );
	// 	_v2.subVectors( triangle.c, _center );

	// 	// compute edge vectors for triangle
	// 	_f0.subVectors( _v1, _v0 );
	// 	_f1.subVectors( _v2, _v1 );
	// 	_f2.subVectors( _v0, _v2 );

	// 	// test against axes that are given by cross product combinations of the edges of the triangle and the edges of the aabb
	// 	// make an axis testing of each of the 3 sides of the aabb against each of the 3 sides of the triangle = 9 axis of separation
	// 	// axis_ij = u_i x f_j (u0, u1, u2 = face normals of aabb = x,y,z axes vectors since aabb is axis aligned)
	// 	let axes = [
	// 		0, - _f0.z, _f0.y, 0, - _f1.z, _f1.y, 0, - _f2.z, _f2.y,
	// 		_f0.z, 0, - _f0.x, _f1.z, 0, - _f1.x, _f2.z, 0, - _f2.x,
	// 		- _f0.y, _f0.x, 0, - _f1.y, _f1.x, 0, - _f2.y, _f2.x, 0
	// 	];
	// 	if ( ! satForAxes( axes, _v0, _v1, _v2, _extents ) ) {

	// 		return false;

	// 	}

	// 	// test 3 face normals from the aabb
	// 	axes = [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ];
	// 	if ( ! satForAxes( axes, _v0, _v1, _v2, _extents ) ) {

	// 		return false;

	// 	}

	// 	// finally testing the face normal of the triangle
	// 	// use already existing triangle edge vectors here
	// 	_triangleNormal.crossVectors( _f0, _f1 );
	// 	axes = [ _triangleNormal.x, _triangleNormal.y, _triangleNormal.z ];

	// 	return satForAxes( axes, _v0, _v1, _v2, _extents );

	// }
}

const _vector = vec3.create()