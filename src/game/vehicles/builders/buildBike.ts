import * as THREE from 'three';
import { VehicleEntity } from '../../types';
import { VehicleSpec } from '../VehicleSpecs';
import {
  addContactShadow,
  createVehicleLodRig,
  createVehicleSharedMaterials,
} from './sharedBuilderUtils';

/**
 * Constrói motocicleta low-poly articulada (guidão/garfo esterçável e 2 rodas) a partir de VehicleSpecs.
 */
export function buildBike(
  id: string,
  spec: VehicleSpec,
  bodyColorHex: number,
  x: number,
  z: number,
  heading: number,
  shadowTex: THREE.CanvasTexture,
  isSoftwareGl: boolean
): VehicleEntity {
  const { root, lod0, lod1, lod2 } = createVehicleLodRig(x, z, heading);
  const { width, length, wheelRadius, axleInset } = spec.dimensions;
  const mats = createVehicleSharedMaterials(bodyColorHex, isSoftwareGl, false);

  addContactShadow(lod0, width + 0.55, length + 0.45, shadowTex);

  // Quadro e tanque
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, length * 0.58), mats.trimMat);
  frame.position.set(0, 0.54, 0);
  frame.castShadow = true;
  lod0.add(frame);

  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.62), mats.paintMat);
  tank.position.set(0, 0.82, 0.22);
  tank.castShadow = true;
  lod0.add(tank);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.62), mats.trimMat);
  seat.position.set(0, 0.78, -0.32);
  lod0.add(seat);

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.82, 8), mats.rimMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.2, 0.36, -0.44);
  lod0.add(exhaust);

  // Rodas dianteira (com pivô no garfo/guidão) e traseira
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.18, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.56, wheelRadius * 0.56, 0.2, 8);
  rimGeo.rotateZ(Math.PI / 2);

  const frontPivot = new THREE.Group();
  frontPivot.position.set(0, wheelRadius, length / 2 - axleInset);
  const frontTire = new THREE.Mesh(wheelGeo, mats.tireMat);
  frontTire.add(new THREE.Mesh(rimGeo, mats.rimMat));
  frontTire.castShadow = true;
  frontPivot.add(frontTire);

  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.1), mats.rimMat);
  fork.position.set(0, 0.34, -0.06);
  fork.rotation.x = -0.28;
  frontPivot.add(fork);

  const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.06, 0.08), mats.trimMat);
  handlebar.position.set(0, 0.65, -0.14);
  frontPivot.add(handlebar);

  const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.12), mats.headlightMat);
  headlight.position.set(0, 0.48, 0.08);
  frontPivot.add(headlight);
  lod0.add(frontPivot);

  const rearTire = new THREE.Mesh(wheelGeo, mats.tireMat);
  rearTire.add(new THREE.Mesh(rimGeo, mats.rimMat));
  rearTire.position.set(0, wheelRadius, -length / 2 + axleInset);
  rearTire.castShadow = true;
  lod0.add(rearTire);

  const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.08), mats.taillightMat);
  taillight.position.set(0, 0.72, -length / 2 + 0.14);
  lod0.add(taillight);

  // LOD1 e LOD2 leves
  const midBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, length * 0.85), mats.paintMat);
  midBody.position.y = 0.56;
  lod1.add(midBody);

  const lowBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, length * 0.9), mats.paintMat);
  lowBody.position.y = 0.56;
  lod2.add(lowBody);

  return {
    id,
    name: spec.name,
    type: spec.type,
    class: spec.class,
    mesh: root,
    frontWheelPivots: [frontPivot],
    wheels: [frontTire, rearTire],
    headlights: [headlight],
    taillights: [taillight],
    x,
    z,
    y: 0,
    pitch: 0,
    roll: 0,
    heading,
    speed: 0,
    steerAngle: 0,
    halfWidth: width / 2,
    halfLength: length / 2,
    maxSpeed: spec.handling.maxSpeed,
    accel: spec.handling.accel,
    driver: 'none',
    paintHex: bodyColorHex,
    seat: { ...spec.seat },
    handling: { ...spec.handling },
    physicsAccum: 0,
    doors: [],
    prevSpeed: 0,
    prevHeading: heading,
  };
}
