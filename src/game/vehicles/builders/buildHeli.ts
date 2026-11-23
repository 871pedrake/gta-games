import * as THREE from 'three';
import { VehicleEntity } from '../../types';
import { VehicleSpec } from '../VehicleSpecs';
import {
  addContactShadow,
  createSeatedDriverRig,
  createVehicleLodRig,
  createVehicleSharedMaterials,
} from './sharedBuilderUtils';

/**
 * Constrói helicóptero low-poly com esquis, cabine envidraçada, rotor principal e rotor de cauda.
 */
export function buildHeli(
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
  const { width, length, bodyHeight } = spec.dimensions;
  const mats = createVehicleSharedMaterials(bodyColorHex, isSoftwareGl, false);

  addContactShadow(lod0, width + 1.4, length + 0.8, shadowTex);

  // Esquis de pouso
  [-0.78, 0.78].forEach((sx) => {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 3.3), mats.trimMat);
    skid.position.set(sx, 0.08, 0.25);
    lod0.add(skid);
    [-0.7, 0.9].forEach((sz) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.1), mats.trimMat);
      strut.position.set(sx * 0.86, 0.28, sz);
      lod0.add(strut);
    });
  });

  // Fuselagem principal e cabine envidraçada
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.35, 3.2), mats.paintMat);
  fuselage.position.set(0, 1.15, 0.35);
  fuselage.castShadow = true;
  lod0.add(fuselage);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.92, 1.5), mats.glassMat);
  canopy.position.set(0, 1.24, 1.45);
  lod0.add(canopy);

  // Cone / lança de cauda
  const tailBoom = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.48, 3.1), mats.paintMat);
  tailBoom.position.set(0, 1.25, -2.45);
  tailBoom.castShadow = true;
  lod0.add(tailBoom);

  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.88, 0.55), mats.paintMat);
  tailFin.position.set(0, 1.62, -3.75);
  lod0.add(tailFin);

  // Rotor principal
  const mainRotorPivot = new THREE.Group();
  mainRotorPivot.position.set(0, 2.02, 0.2);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.32, 8), mats.trimMat);
  mast.position.y = -0.1;
  mainRotorPivot.add(mast);

  const bladeA = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.05, 0.28), mats.trimMat);
  const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 6.8), mats.trimMat);
  mainRotorPivot.add(bladeA, bladeB);
  lod0.add(mainRotorPivot);

  // Rotor de cauda
  const tailRotorPivot = new THREE.Group();
  tailRotorPivot.position.set(0.16, 1.65, -3.75);
  const tailBladeA = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.14), mats.rimMat);
  const tailBladeB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 1.15), mats.rimMat);
  tailRotorPivot.add(tailBladeA, tailBladeB);
  lod0.add(tailRotorPivot);

  const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.1), mats.headlightMat);
  headlight.position.set(0, 0.7, 1.98);
  lod0.add(headlight);

  const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), mats.taillightMat);
  taillight.position.set(0, 2.08, -3.75);
  lod0.add(taillight);

  // LOD1 e LOD2
  const midBody = new THREE.Mesh(new THREE.BoxGeometry(1.75, bodyHeight * 0.7, length * 0.8), mats.paintMat);
  midBody.position.set(0, 1.15, -0.4);
  lod1.add(midBody);

  const lowBody = new THREE.Mesh(new THREE.BoxGeometry(2.0, bodyHeight * 0.75, length * 0.85), mats.paintMat);
  lowBody.position.set(0, 1.15, -0.4);
  lod2.add(lowBody);

  const seatedDriverGroup = createSeatedDriverRig(mats.trimMat, 0x0f172a);
  seatedDriverGroup.position.set(spec.seat.driverX, spec.seat.driverY, spec.seat.driverZ);
  seatedDriverGroup.visible = false;
  lod0.add(seatedDriverGroup);

  return {
    id,
    name: spec.name,
    type: spec.type,
    class: spec.class,
    mesh: root,
    frontWheelPivots: [],
    wheels: [],
    headlights: [headlight],
    taillights: [taillight],
    rotors: [mainRotorPivot, tailRotorPivot],
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
    flight: {
      vy: 0,
      rotorSpeed: 0,
      throttle: 0,
      airborne: false,
    },
    physicsAccum: 0,
    doors: [],
    cabinVisuals: {
      glassMats: [mats.glassMat],
      doorWellGroups: [],
      seatedDriverGroup,
    },
    prevSpeed: 0,
    prevHeading: heading,
  };
}
