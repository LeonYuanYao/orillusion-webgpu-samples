import { mat3, mat4, vec3 } from 'gl-matrix'
import { Box3 } from './box';
import { Sphere } from './sphere';

export class Plane {

  isPlane = true;

  normal: vec3;

  constant: number;

	constructor( normal = vec3.fromValues( 1, 0, 0 ), constant = 0 ) {

		this.isPlane = true;

		// normal is assumed to be normalized

		this.normal = normal;
		this.constant = constant;

	}

	set( normal: vec3, constant: number ) {

    vec3.copy(this.normal, normal)

		this.constant = constant;

		return this;

	}

	setComponents( x: number, y: number, z: number, w: number ) {

    vec3.set(this.normal, x, y, z);
		this.constant = w;

		return this;

	}

	setFromNormalAndCoplanarPoint( normal: vec3, point: vec3 ) {

    vec3.copy(this.normal, normal);
    this.constant = - vec3.dot(point, this.normal);

		return this;

	}

	setFromCoplanarPoints( a: vec3, b: vec3, c: vec3 ) {

    vec3.cross(_vector3, vec3.sub(_vector1, c, b), vec3.sub(_vector2, a, b))
    vec3.normalize(_vector3, _vector3)

		// Q: should an error be thrown if normal is zero (e.g. degenerate plane)?

		this.setFromNormalAndCoplanarPoint( _vector3, a );

		return this;

	}

	copy( plane: Plane ) {

    vec3.copy(this.normal, plane.normal);
		this.constant = plane.constant;

		return this;

	}

	normalize() {

		// Note: will lead to a divide by zero if the plane is invalid.

		const inverseNormalLength = 1.0 / vec3.len(this.normal);
    vec3.scale(this.normal, this.normal, inverseNormalLength);
		this.constant *= inverseNormalLength;

		return this;

	}

	negate() {

		this.constant *= - 1;
    vec3.negate(this.normal, this.normal);

		return this;

	}

	distanceToPoint( point: vec3 ) {

    return vec3.dot(this.normal, point) + this.constant;

	}

	distanceToSphere( sphere: Sphere ) {

		return this.distanceToPoint( sphere.center ) - sphere.radius;

	}

	projectPoint( point: vec3, target: vec3 ) {

    vec3.copy(target, this.normal);
    vec3.scale(target, target, - this.distanceToPoint( point ));
    vec3.add(target, target, point);
    return target;

	}

	// intersectLine( line, target ) {

	// 	const direction = line.delta( _vector1 );

	// 	const denominator = this.normal.dot( direction );

	// 	if ( denominator === 0 ) {

	// 		// line is coplanar, return origin
	// 		if ( this.distanceToPoint( line.start ) === 0 ) {

	// 			return target.copy( line.start );

	// 		}

	// 		// Unsure if this is the correct method to handle this case.
	// 		return null;

	// 	}

	// 	const t = - ( line.start.dot( this.normal ) + this.constant ) / denominator;

	// 	if ( t < 0 || t > 1 ) {

	// 		return null;

	// 	}

	// 	return target.copy( direction ).multiplyScalar( t ).add( line.start );

	// }

	// intersectsLine( line ) {

	// 	// Note: this tests if a line intersects the plane, not whether it (or its end-points) are coplanar with it.

	// 	const startSign = this.distanceToPoint( line.start );
	// 	const endSign = this.distanceToPoint( line.end );

	// 	return ( startSign < 0 && endSign > 0 ) || ( endSign < 0 && startSign > 0 );

	// }

	intersectsBox( box: Box3 ) {

		return box.intersectsPlane( this );

	}

	intersectsSphere( sphere: Sphere ) {

		return sphere.intersectsPlane( this );

	}

	coplanarPoint( target: vec3 ) {

    vec3.copy(target, this.normal)
    return vec3.scale(target, target, - this.constant);

	}

	applyMatrix4( matrix: mat4, optionalNormalMatrix: mat3 ) {

		const normalMatrix = optionalNormalMatrix || mat3.normalFromMat4(_normalMatrix, matrix);

    const referencePoint = this.coplanarPoint( _vector1 );

    vec3.transformMat4(referencePoint, referencePoint, matrix);

    vec3.transformMat3(this.normal, this.normal, normalMatrix)

		const normal = vec3.normalize(this.normal, this.normal);

		this.constant = - vec3.dot(referencePoint, normal);

		return this;

	}

	translate( offset: vec3 ) {

		this.constant -= vec3.dot( offset, this.normal );

		return this;

	}

	equals( plane: Plane ) {

		return vec3.equals(plane.normal, this.normal) && ( plane.constant === this.constant );

	}

	clone() {

		return new Plane().copy( this );

	}

}

const _vector1 = vec3.create();
const _vector2 = vec3.create();
const _vector3 = vec3.create();
const _normalMatrix = mat3.create();