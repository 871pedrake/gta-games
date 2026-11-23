import * as THREE from 'three';
import { VehicleEntity, VehicleType } from '../types';
import { buildBike } from './builders/buildBike';
import { buildCar } from './builders/buildCar';
import { buildHeli } from './builders/buildHeli';
import { buildPlane } from './builders/buildPlane';
import { VEHICLE_SPECS } from './VehicleSpecs';

/**
 * Fábrica unificada de veículos orientada pelos metadados de VEHICLE_SPECS.
 */
export function createVehicleEntity(
  id: string,
  type: VehicleType,
  bodyColorHex: number,
  x: number,
  z: number,
  heading: number,
  shadowTex: THREE.CanvasTexture,
  isSoftwareGl: boolean
): VehicleEntity {
  const spec = VEHICLE_SPECS[type];
  switch (spec.class) {
    case 'bike':
      return buildBike(id, spec, bodyColorHex, x, z, heading, shadowTex, isSoftwareGl);
    case 'heli':
      return buildHeli(id, spec, bodyColorHex, x, z, heading, shadowTex, isSoftwareGl);
    case 'plane':
      return buildPlane(id, spec, bodyColorHex, x, z, heading, shadowTex, isSoftwareGl);
    case 'car':
    default:
      return buildCar(id, spec, bodyColorHex, x, z, heading, shadowTex, isSoftwareGl);
  }
}
