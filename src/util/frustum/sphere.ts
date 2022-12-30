import { vec3 } from "gl-matrix";
import { distanceToSquared } from "../math";
import { Box3 } from "./box";
import { Plane } from "./plane";

export class Sphere {
  radius = 0;
  center = vec3.create();

  constructor(center?: vec3, radius?: number) {
    this.radius = radius ?? this.radius;
    center && vec3.copy(this.center, center);
  }

  intersectsSphere( sphere: Sphere ) {

		const radiusSum = this.radius + sphere.radius;

		return distanceToSquared( sphere.center, this.center ) <= ( radiusSum * radiusSum );

	}

	intersectsBox( box: Box3 ) {

		return box.intersectsSphere( this );

	}

	intersectsPlane( plane: Plane ) {

		return Math.abs( plane.distanceToPoint( this.center ) ) <= this.radius;

	}
}