import { mat4, vec3 } from "gl-matrix";
import { Box3 } from "./box";
import { Plane } from "./plane";
import { Sphere } from "./sphere";

export class Frustum {

  planes: [Plane, Plane, Plane, Plane, Plane, Plane];

  private _array = new Float32Array(6 * 4);

  get array() {
    for (let i = 0; i < this.planes.length; i++) {
        const plane = this.planes[i]
        this._array[i * 4 + 0] = plane.normal[0]
        this._array[i * 4 + 1] = plane.normal[1]
        this._array[i * 4 + 2] = plane.normal[2]
        this._array[i * 4 + 3] = plane.constant
    }
    return this._array
  }

	constructor( p0 = new Plane(), p1 = new Plane(), p2 = new Plane(), p3 = new Plane(), p4 = new Plane(), p5 = new Plane() ) {

		this.planes = [ p0, p1, p2, p3, p4, p5 ];

	}

	set( p0: Plane, p1: Plane, p2: Plane, p3: Plane, p4: Plane, p5: Plane ) {

		const planes = this.planes;

		planes[ 0 ].copy( p0 );
		planes[ 1 ].copy( p1 );
		planes[ 2 ].copy( p2 );
		planes[ 3 ].copy( p3 );
		planes[ 4 ].copy( p4 );
		planes[ 5 ].copy( p5 );

		return this;

	}

	copy( frustum: Frustum ) {

		const planes = this.planes;

		for ( let i = 0; i < 6; i ++ ) {

			planes[ i ].copy( frustum.planes[ i ] );

		}

		return this;

	}

	setFromProjectionMatrix( m: mat4 ) {

		const planes = this.planes;
		const me = m as Float32Array;
		const me0 = me[ 0 ], me1 = me[ 1 ], me2 = me[ 2 ], me3 = me[ 3 ];
		const me4 = me[ 4 ], me5 = me[ 5 ], me6 = me[ 6 ], me7 = me[ 7 ];
		const me8 = me[ 8 ], me9 = me[ 9 ], me10 = me[ 10 ], me11 = me[ 11 ];
		const me12 = me[ 12 ], me13 = me[ 13 ], me14 = me[ 14 ], me15 = me[ 15 ];

		planes[ 0 ].setComponents( me3 - me0, me7 - me4, me11 - me8, me15 - me12 ).normalize();
		planes[ 1 ].setComponents( me3 + me0, me7 + me4, me11 + me8, me15 + me12 ).normalize();
		planes[ 2 ].setComponents( me3 + me1, me7 + me5, me11 + me9, me15 + me13 ).normalize();
		planes[ 3 ].setComponents( me3 - me1, me7 - me5, me11 - me9, me15 - me13 ).normalize();
		planes[ 4 ].setComponents( me3 - me2, me7 - me6, me11 - me10, me15 - me14 ).normalize();
		planes[ 5 ].setComponents( me3 + me2, me7 + me6, me11 + me10, me15 + me14 ).normalize();

		return this;

	}

	// intersectsObject( object ) {

	// 	const geometry = object.geometry;

	// 	if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();

	// 	_sphere.copy( geometry.boundingSphere ).applyMatrix4( object.matrixWorld );

	// 	return this.intersectsSphere( _sphere );

	// }

	// intersectsSprite( sprite ) {

	// 	_sphere.center.set( 0, 0, 0 );
	// 	_sphere.radius = 0.7071067811865476;
	// 	_sphere.applyMatrix4( sprite.matrixWorld );

	// 	return this.intersectsSphere( _sphere );

	// }

	intersectsSphere( sphere: Sphere ) {

		const planes = this.planes;
		const center = sphere.center;
		const negRadius = - sphere.radius;

		for ( let i = 0; i < 6; i ++ ) {

			const distance = planes[ i ].distanceToPoint( center );

			if ( distance < negRadius ) {

				return false;

			}

		}

		return true;

	}

	intersectsBox( box: Box3 ) {

		const planes = this.planes;

		for ( let i = 0; i < 6; i ++ ) {

			const plane = planes[ i ];

			// corner at max distance

			_vector[0] = plane.normal[0] > 0 ? box.max[0] : box.min[0];
			_vector[1] = plane.normal[1] > 0 ? box.max[1] : box.min[1];
			_vector[2] = plane.normal[2] > 0 ? box.max[2] : box.min[2];

			if ( plane.distanceToPoint( _vector ) < 0 ) {

				return false;

			}

		}

		return true;

	}

	containsPoint( point: vec3 ) {

		const planes = this.planes;

		for ( let i = 0; i < 6; i ++ ) {

			if ( planes[ i ].distanceToPoint( point ) < 0 ) {

				return false;

			}

		}

		return true;

	}

	clone() {

		return new Frustum().copy( this );

	}

}

const _vector = vec3.create();