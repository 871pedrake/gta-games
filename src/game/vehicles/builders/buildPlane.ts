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
 * Constrói avião monomotor low-poly com asas, estabilizadores, trem de pouso e hélice frontal.
 */
export function buildPlane(
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
  const { width, length, wheelRadius } = spec.dimensions;
  const mats = createVehicleSharedMaterials(bodyColorHex, isSoftwareGl, false);

  addContactShadow(lod0, width * 0.72, length + 0.8, shadowTex);

  // Fuselagem e cockpit
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.25, length * 0.82), mats.paintMat);
  fuselage.position.set(0, 1.05, 0);
  fuselage.castShadow = true;
  lod0.add(fuselage);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.72, 1.95), mats.glassMat);
  cockpit.position.set(0, 1.65, 0.35);
  lod0.add(cockpit);

  // Asas principais
  const mainWing = new THREE.Mesh(new THREE.BoxGeometry(width, 0.14, 1.65), mats.paintMat);
  mainWing.position.set(0, 1.28, 0.35);
  mainWing.castShadow = true;
  lod0.add(mainWing);

  // Estabilizador horizontal e leme vertical
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.1, 0.78), mats.paintMat);
  hStab.position.set(0, 1.22, -length * 0.39);
  lod0.add(hStab);

  const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.15, 0.92), mats.paintMat);
  vStab.position.set(0, 1.85, -length * 0.38);
  lod0.add(vStab);

  // Hélice frontal animada
  const propPivot = new THREE.Group();
  propPivot.position.set(0, 1.05, length * 0.43);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 8), mats.rimMat);
  spinner.rotation.x = Math.PI / 2;
  propPivot.add(spinner);

  const propBladeA = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.14, 0.06), mats.trimMat);
  const propBladeB = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.05, 0.06), mats.trimMat);
  propPivot.add(propBladeA, propBladeB);
  lod0.add(propPivot);

  // Trem de pouso triciclo
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.22, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  const gearPositions = [
    { x: -1.05, z: 0.75 },
    { x: 1.05, z: 0.75 },
    { x: 0, z: -2.15 },
  ];
  for (const gp of gearPositions) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), mats.trimMat);
    strut.position.set(gp.x, 0.52, gp.z);
    const tire = new THREE.Mesh(wheelGeo, mats.tireMat);
    tire.position.set(gp.x, wheelRadius, gp.z);
    lod0.add(strut, tire);
    wheels.push(tire);
  }

  const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.1), mats.headlightMat);
  headlight.position.set(0, 0.72, length * 0.39);
  const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), mats.taillightMat);
  taillight.position.set(0, 2.38, -length * 0.41);
  lod0.add(headlight, taillight);

  // LOD1 e LOD2
  const midFuse = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, length * 0.85), mats.paintMat);
  midFuse.position.set(0, 1.05, 0);
  const midWing = new THREE.Mesh(new THREE.BoxGeometry(width, 0.14, 1.6), mats.paintMat);
  midWing.position.set(0, 1.28, 0.35);
  lod1.add(midFuse, midWing);

  const lowBody = new THREE.Mesh(new THREE.BoxGeometry(width * 0.85, 1.2, length * 0.8), mats.paintMat);
  lowBody.position.set(0, 1.15, 0);
  lod2.add(lowBody);

  const seatedDriverGroup = createSeatedDriverRig(mats.trimMat, 0x1e293b);
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
    wheels,
    headlights: [headlight],
    taillights: [taillight],
    rotors: [propPivot],
    x,
    z,
    y: 0,
    pitch: 0,
    roll: 0,
    heading,
    speed: 0,
    steerAngle: 0,
    halfWidth: 1.5,
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
