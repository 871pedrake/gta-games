import * as THREE from 'three';
import {
  VehicleCabinVisuals,
  VehicleDoorMechanism,
  VehicleDoorSide,
  VehicleDoorState,
  VehicleEntity,
} from '../../types';
import { VehicleSpec } from '../VehicleSpecs';
import {
  addContactShadow,
  createSeatedDriverRig,
  createVehicleLodRig,
  createVehicleSharedMaterials,
} from './sharedBuilderUtils';

/**
 * Constrói entidades de carro (hatch, sedan, cupê, esportivo, SUV, picape, van, conversível,
 * viatura, ônibus e ambulância) a partir da tabela VehicleSpecs.
 * A carroceria fica dentro de `sprungGroup` para suportar mergulho, agachamento, rolagem e quique
 * independentes do contato das 4 rodas com o terreno.
 */
export function buildCar(
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

  const style = spec.bodyStyle ?? (spec.type as NonNullable<VehicleSpec['bodyStyle']>);
  const isPolice = style === 'police';
  const isSports = style === 'sports';
  const isBus = style === 'bus';
  const isAmbulance = style === 'ambulance';
  const isHatch = style === 'hatch';
  const isSuv = style === 'suv';
  const isPickup = style === 'pickup';
  const isVan = style === 'van';
  const isConvertible = style === 'convertible';
  const hasRoof = spec.hasRoof !== false;

  const { width, length, bodyHeight, wheelRadius, axleInset } = spec.dimensions;

  const baseColor = isPolice ? 0x161926 : isAmbulance ? 0xf8fafc : bodyColorHex;
  const finish = spec.defaultFinish ?? 'gloss';

  const mats = createVehicleSharedMaterials(baseColor, isSoftwareGl, isBus || isAmbulance, finish);

  // 1. Sombra de contato (mantida diretamente no LOD0 para acompanhar o solo)
  addContactShadow(lod0, width + 0.75, length + 0.85, shadowTex);

  // Grupo suspenso que recebe mergulho na frenagem, rolagem em curva e quique ao aterrissar
  const sprungGroup = new THREE.Group();
  sprungGroup.name = 'car_sprung_body';
  lod0.add(sprungGroup);

  const rideClearance = isSuv || isPickup ? 0.56 : 0.48;
  const bodyCenterY = rideClearance + bodyHeight / 2;

  // 2. Chassi inferior / saia
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(width, 0.24, length), mats.trimMat);
  chassis.position.y = rideClearance - 0.1;
  chassis.castShadow = true;
  sprungGroup.add(chassis);

  // Para-choques / protetores inferiores em SUV e Picape
  if (isSuv || isPickup) {
    const skidMat = mats.rimMat;
    const frontSkid = new THREE.Mesh(new THREE.BoxGeometry(width * 0.62, 0.14, 0.14), skidMat);
    frontSkid.position.set(0, rideClearance - 0.06, length / 2 + 0.02);
    const rearSkid = new THREE.Mesh(new THREE.BoxGeometry(width * 0.62, 0.14, 0.14), skidMat);
    rearSkid.position.set(0, rideClearance - 0.06, -length / 2 - 0.02);
    sprungGroup.add(frontSkid, rearSkid);
  }

  // 3. Silhueta LOD1
  const mainBodyGeo = new THREE.BoxGeometry(width - 0.04, bodyHeight, length - 0.08);
  const midBody = new THREE.Mesh(mainBodyGeo, mats.paintMat);
  midBody.position.set(0, bodyCenterY, 0);
  lod1.add(midBody);

  const doors: VehicleDoorState[] = [];
  const doorWellGroups: THREE.Group[] = [];
  const interiorGroup = new THREE.Group();
  interiorGroup.name = 'vehicle_interior';
  interiorGroup.visible = !hasRoof;
  sprungGroup.add(interiorGroup);

  const seatMat = new THREE.MeshStandardMaterial({ color: 0x202636, roughness: 0.78 });
  const doorWellDarkMat = new THREE.MeshStandardMaterial({
    color: 0x090b10,
    roughness: 0.94,
    metalness: 0.05,
  });

  const driverShirtColor = isPolice
    ? 0x1e3a8a
    : isAmbulance
    ? 0xe11d48
    : isBus
    ? 0x0369a1
    : isConvertible
    ? 0x0f766e
    : 0x334155;
  const seatedDriverGroup = createSeatedDriverRig(mats.trimMat, driverShirtColor);
  seatedDriverGroup.position.set(spec.seat.driverX, spec.seat.driverY - 0.05, spec.seat.driverZ);
  seatedDriverGroup.visible = false;
  sprungGroup.add(seatedDriverGroup);

  let lightBarRed: THREE.Mesh | undefined;
  let lightBarBlue: THREE.Mesh | undefined;
  let tailgatePivot: THREE.Group | undefined;
  const headlights: THREE.Mesh[] = [];
  const taillights: THREE.Mesh[] = [];

  // Função auxiliar para montar portas pivotadas no LOD0 com painel saliente (~0,02), friso escuro, vidro e maçaneta
  const addHingedSideDoor = (options: {
    id: string;
    side: VehicleDoorSide;
    frontZ: number;
    rearZ: number;
    mechanism: VehicleDoorMechanism;
    includeMirror: boolean;
    doorH: number;
    doorCenterY: number;
    windowH: number;
    hasWindowFrame: boolean;
    doorMaterial: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  }) => {
    const doorLen = options.frontZ - options.rearZ;
    const doorMidZ = (options.frontZ + options.rearZ) / 2;
    const isLeft = options.side === 'left';
    const openSign: 1 | -1 = isLeft ? 1 : -1;
    const pivotX = isLeft ? -(width / 2 - 0.03) : width / 2 - 0.03;

    const pivot = new THREE.Group();
    pivot.name = `door_pivot_${options.id}`;
    pivot.position.set(pivotX, options.doorCenterY, options.frontZ);

    // Painel saliente (~0,02) para fora da caixa principal
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, options.doorH, doorLen),
      options.doorMaterial
    );
    panel.position.set(isLeft ? -0.008 : 0.008, 0, -doorLen / 2);
    panel.castShadow = true;
    pivot.add(panel);

    const frisoEscuro = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.075, Math.max(0.25, doorLen - 0.05)),
      mats.trimMat
    );
    frisoEscuro.position.set(isLeft ? -0.052 : 0.052, -options.doorH * 0.08, -doorLen / 2);
    pivot.add(frisoEscuro);

    const innerCard = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, Math.max(0.24, options.doorH - 0.14), Math.max(0.2, doorLen - 0.1)),
      mats.trimMat
    );
    innerCard.position.set(isLeft ? 0.052 : -0.052, -0.02, -doorLen / 2);
    pivot.add(innerCard);

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.052, 0.16),
      isPolice ? mats.trimMat : mats.rimMat
    );
    handle.position.set(isLeft ? -0.055 : 0.055, options.doorH * 0.24, -doorLen + 0.2);
    pivot.add(handle);

    if (options.includeMirror) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.085, 0.11), mats.trimMat);
      mirror.position.set(isLeft ? -0.095 : 0.095, options.doorH * 0.5 + 0.03, -0.16);
      pivot.add(mirror);
    }

    if (options.windowH > 0.05) {
      const windowLen = Math.max(0.25, doorLen - 0.14);
      const doorWindow = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, options.windowH, windowLen),
        mats.glassMat
      );
      doorWindow.position.set(
        isLeft ? 0.045 : -0.045,
        options.doorH * 0.5 + options.windowH * 0.45,
        -doorLen / 2 - 0.01
      );
      pivot.add(doorWindow);

      if (options.hasWindowFrame) {
        const topFrame = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.05, windowLen + 0.03),
          mats.trimMat
        );
        topFrame.position.set(
          isLeft ? 0.045 : -0.045,
          options.doorH * 0.5 + options.windowH * 0.9,
          -doorLen / 2 - 0.01
        );
        pivot.add(topFrame);
      }
    }

    sprungGroup.add(pivot);

    // Vão escuro da soleira/moldura (ativado somente acima de 2° de abertura)
    const doorWell = new THREE.Group();
    doorWell.name = `door_well_${options.id}`;
    doorWell.visible = false;
    const sillBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, doorLen), doorWellDarkMat);
    sillBar.position.set(isLeft ? -(width / 2 - 0.1) : width / 2 - 0.1, rideClearance + 0.04, doorMidZ);
    const pillarFront = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, options.doorH + options.windowH * 0.7, 0.075),
      doorWellDarkMat
    );
    pillarFront.position.set(
      isLeft ? -(width / 2 - 0.1) : width / 2 - 0.1,
      options.doorCenterY + 0.16,
      options.frontZ - 0.03
    );
    const pillarRear = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, options.doorH + options.windowH * 0.7, 0.075),
      doorWellDarkMat
    );
    pillarRear.position.set(
      isLeft ? -(width / 2 - 0.1) : width / 2 - 0.1,
      options.doorCenterY + 0.16,
      options.rearZ + 0.03
    );
    doorWell.add(sillBar, pillarFront, pillarRear);
    sprungGroup.add(doorWell);
    doorWellGroups.push(doorWell);

    doors.push({
      id: options.id,
      side: options.side,
      mechanism: options.mechanism,
      pivot,
      openSign,
      angle: 0,
      angularVel: 0,
      targetAngle: null,
      maxAngle: spec.doors.maxAngle,
      latched: true,
      eventState: 'closed',
      openTimer: 0,
    });
  };

  if (isBus || isAmbulance) {
    const mainBody = new THREE.Mesh(mainBodyGeo, mats.paintMat);
    mainBody.position.set(0, bodyCenterY, 0);
    mainBody.castShadow = true;
    mainBody.receiveShadow = true;
    sprungGroup.add(mainBody);
  }

  if (isBus) {
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xca8a04,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    });
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.02, 0.22, length - 0.12),
      stripeMat
    );
    stripe.position.y = 1.05;
    sprungGroup.add(stripe);

    const sideWindows = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.01, 0.78, length - 0.75),
      mats.glassMat
    );
    sideWindows.position.set(0, 1.95, 0.08);
    sprungGroup.add(sideWindows);

    const midWindows = new THREE.Mesh(sideWindows.geometry, mats.glassMat);
    midWindows.position.copy(sideWindows.position);
    lod1.add(midWindows);

    const frontWindshield = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.24, 0.92, 0.14),
      mats.glassMat
    );
    frontWindshield.position.set(0, 1.9, length / 2 - 0.04);
    sprungGroup.add(frontWindshield);

    const busSeat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.42), seatMat);
    busSeat.position.set(spec.seat.driverX, spec.seat.driverY + 0.2, spec.seat.driverZ - 0.1);
    const busWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 10), mats.trimMat);
    busWheel.rotation.x = Math.PI * 0.32;
    busWheel.position.set(spec.seat.driverX, spec.seat.driverY + 0.35, spec.seat.driverZ + 0.35);
    interiorGroup.add(busSeat, busWheel);

    const destSign = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 0.24, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0x16f2d4,
        emissive: 0x16f2d4,
        emissiveIntensity: 1.4,
      })
    );
    destSign.position.set(0, 2.48, length / 2 - 0.02);
    sprungGroup.add(destSign);

    const acMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 });
    const acGeo = new THREE.BoxGeometry(1.25, 0.22, 1.5);
    [-1.4, 1.4].forEach((az) => {
      const ac = new THREE.Mesh(acGeo, acMat);
      ac.position.set(0, 2.74, az);
      sprungGroup.add(ac);
    });
  } else if (isAmbulance) {
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xb91c1c,
      emissiveIntensity: 0.65,
      roughness: 0.3,
    });
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.02, 0.22, length - 0.16),
      redMat
    );
    stripe.position.y = 0.92;
    sprungGroup.add(stripe);

    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.32, 0.62, 1.35),
      mats.glassMat
    );
    windshield.position.set(0, 1.56, length / 2 - 0.85);
    sprungGroup.add(windshield);

    const midWindshield = new THREE.Mesh(windshield.geometry, mats.glassMat);
    midWindshield.position.copy(windshield.position);
    lod1.add(midWindshield);

    const cabSeat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.44), seatMat);
    cabSeat.position.set(spec.seat.driverX, spec.seat.driverY + 0.18, spec.seat.driverZ - 0.08);
    const cabWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10), mats.trimMat);
    cabWheel.rotation.x = Math.PI * 0.35;
    cabWheel.position.set(spec.seat.driverX, spec.seat.driverY + 0.32, spec.seat.driverZ + 0.36);
    interiorGroup.add(cabSeat, cabWheel);

    const doorFrontZ = spec.doors.frontZ;
    const doorRearZ = spec.doors.rearZ;
    addHingedSideDoor({
      id: 'door_left',
      side: 'left',
      frontZ: doorFrontZ,
      rearZ: doorRearZ,
      mechanism: 'hinged',
      includeMirror: true,
      doorH: bodyHeight * 0.78,
      doorCenterY: bodyCenterY - 0.06,
      windowH: 0.42,
      hasWindowFrame: true,
      doorMaterial: mats.whiteDoorMat,
    });

    // Porta lateral de correr (~0,9 m)
    const slideDoorLen = 1.18;
    const slideRestZ = 0.28;
    const slideRestX = width / 2 - 0.01;
    const slidePivot = new THREE.Group();
    slidePivot.name = 'door_pivot_right_sliding';
    slidePivot.position.set(slideRestX, bodyCenterY, slideRestZ);

    const slidePanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, bodyHeight - 0.1, slideDoorLen),
      mats.whiteDoorMat
    );
    slidePanel.position.set(0.02, 0, -slideDoorLen / 2);
    slidePanel.castShadow = true;

    const slideFriso = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.09, slideDoorLen - 0.06),
      mats.trimMat
    );
    slideFriso.position.set(0.046, -0.18, -slideDoorLen / 2);

    const slideStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.2, slideDoorLen - 0.04),
      redMat
    );
    slideStripe.position.set(0.044, 0.92 - bodyCenterY, -slideDoorLen / 2);

    const slideWindow = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.42, slideDoorLen - 0.24),
      mats.glassMat
    );
    slideWindow.position.set(0.036, 0.32, -slideDoorLen / 2);

    const slideHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.16), mats.trimMat);
    slideHandle.position.set(0.055, -0.02, -0.2);

    slidePivot.add(slidePanel, slideFriso, slideStripe, slideWindow, slideHandle);
    sprungGroup.add(slidePivot);

    const rightWell = new THREE.Group();
    rightWell.visible = false;
    const rightWellRecess = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, bodyHeight - 0.14, slideDoorLen - 0.06),
      doorWellDarkMat
    );
    rightWellRecess.position.set(width / 2 - 0.015, bodyCenterY, slideRestZ - slideDoorLen / 2);
    const medBench = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.72), seatMat);
    medBench.position.set(width / 2 - 0.16, bodyCenterY - 0.26, slideRestZ - slideDoorLen / 2);
    rightWell.add(rightWellRecess, medBench);
    sprungGroup.add(rightWell);
    doorWellGroups.push(rightWell);

    doors.push({
      id: 'door_right',
      side: 'right',
      mechanism: spec.doors.sideDoorMechanism ?? 'sliding',
      pivot: slidePivot,
      openSign: -1,
      angle: 0,
      angularVel: 0,
      targetAngle: null,
      maxAngle: spec.doors.maxAngle,
      maxSlide: spec.doors.maxSlide ?? 0.9,
      slideDistance: 0,
      restPosZ: slideRestZ,
      restPosX: slideRestX,
      latched: true,
      eventState: 'closed',
      openTimer: 0,
    });

    const hBarGeo = new THREE.BoxGeometry(0.05, 0.18, 0.62);
    const vBarGeo = new THREE.BoxGeometry(0.05, 0.62, 0.18);
    [-width / 2 - 0.01, width / 2 + 0.01].forEach((sx) => {
      const hBar = new THREE.Mesh(hBarGeo, redMat);
      hBar.position.set(sx, 1.45, -1.25);
      const vBar = new THREE.Mesh(vBarGeo, redMat);
      vBar.position.set(sx, 1.45, -1.25);
      sprungGroup.add(hBar, vBar);
    });

    const roofCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.24), redMat);
    roofCrossH.position.set(0, rideClearance + bodyHeight + 0.04, -0.65);
    const roofCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.85), redMat);
    roofCrossV.position.set(0, rideClearance + bodyHeight + 0.04, -0.65);
    sprungGroup.add(roofCrossH, roofCrossV);

    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.09, 0.28), mats.trimMat);
    barBase.position.set(0, rideClearance + bodyHeight + 0.04, length / 2 - 0.95);
    sprungGroup.add(barBase);

    const sirenRedMat = new THREE.MeshStandardMaterial({
      color: 0xff2244,
      emissive: 0xff1133,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    const sirenWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 2.0,
      roughness: 0.2,
    });
    lightBarRed = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.14, 0.24), sirenRedMat);
    lightBarRed.position.set(-0.34, rideClearance + bodyHeight + 0.12, length / 2 - 0.95);
    lightBarBlue = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.14, 0.24), sirenWhiteMat);
    lightBarBlue.position.set(0.34, rideClearance + bodyHeight + 0.12, length / 2 - 0.95);
    sprungGroup.add(lightBarRed, lightBarBlue);
  } else if (isVan) {
    // Van utilitária pesada: cabine dianteira com 2 portas articuladas + compartimento de carga com porta lateral de correr (0,9 m)
    const doorFrontZ = spec.doors.frontZ;
    const doorRearZ = spec.doors.rearZ;
    const frontEndZ = length / 2 - 0.04;
    const rearEndZ = -length / 2 + 0.04;
    const frontLen = Math.max(0.45, frontEndZ - doorFrontZ);
    const cargoLen = Math.max(1.2, doorRearZ - rearEndZ);

    const noseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.04, bodyHeight * 0.72, frontLen),
      mats.paintMat
    );
    noseMesh.position.set(0, rideClearance + bodyHeight * 0.36, (frontEndZ + doorFrontZ) / 2);
    noseMesh.castShadow = true;
    noseMesh.receiveShadow = true;
    sprungGroup.add(noseMesh);

    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.24, bodyHeight * 0.42, 0.16),
      mats.glassMat
    );
    windshield.position.set(0, rideClearance + bodyHeight * 0.78, doorFrontZ + 0.14);
    windshield.rotation.x = -0.22;
    sprungGroup.add(windshield);

    const roofVan = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.08, 0.12, length - frontLen * 0.45),
      mats.paintMat
    );
    roofVan.position.set(0, rideClearance + bodyHeight - 0.02, -0.14);
    roofVan.castShadow = true;
    sprungGroup.add(roofVan);

    // Parede traseira fechada + lateral esquerda de carga + vão da porta deslizante na direita
    const cargoLeftWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, bodyHeight, cargoLen),
      mats.paintMat
    );
    cargoLeftWall.position.set(-(width / 2 - 0.09), bodyCenterY, (doorRearZ + rearEndZ) / 2);
    cargoLeftWall.castShadow = true;

    const cargoRearWall = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.06, bodyHeight, 0.22),
      mats.paintMat
    );
    cargoRearWall.position.set(0, bodyCenterY, rearEndZ + 0.11);
    cargoRearWall.castShadow = true;

    const cargoFloor = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.12, 0.14, cargoLen + 0.2),
      mats.trimMat
    );
    cargoFloor.position.set(0, rideClearance + 0.07, (doorRearZ + rearEndZ) / 2);

    const rearCargoCorner = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, bodyHeight, Math.max(0.5, cargoLen - 1.35)),
      mats.paintMat
    );
    rearCargoCorner.position.set(width / 2 - 0.09, bodyCenterY, rearEndZ + (cargoLen - 1.35) / 2);
    sprungGroup.add(cargoLeftWall, cargoRearWall, cargoFloor, rearCargoCorner);

    // Interior da cabine dianteira da van
    const cabFloor = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.12, 0.12, doorFrontZ - doorRearZ + 0.2),
      mats.trimMat
    );
    cabFloor.position.set(0, rideClearance + 0.07, (doorFrontZ + doorRearZ) / 2);
    const vanDash = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.34, 0.32), mats.trimMat);
    vanDash.position.set(0, rideClearance + 0.56, doorFrontZ - 0.16);
    const vanWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 10), mats.trimMat);
    vanWheel.rotation.x = Math.PI * 0.34;
    vanWheel.position.set(spec.seat.driverX, spec.seat.driverY + 0.3, spec.seat.driverZ + 0.32);
    interiorGroup.add(cabFloor, vanDash, vanWheel);
    [-0.46, 0.46].forEach((sx) => {
      const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.44), seatMat);
      seatBase.position.set(sx, rideClearance + 0.3, (doorFrontZ + doorRearZ) / 2 - 0.08);
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.14), seatMat);
      seatBack.position.set(sx, rideClearance + 0.58, (doorFrontZ + doorRearZ) / 2 - 0.26);
      interiorGroup.add(seatBase, seatBack);
    });

    // Duas portas dianteiras articuladas (índices 0 e 1 -> embarque)
    addHingedSideDoor({
      id: 'door_left',
      side: 'left',
      frontZ: doorFrontZ,
      rearZ: doorRearZ,
      mechanism: 'hinged',
      includeMirror: true,
      doorH: bodyHeight * 0.62,
      doorCenterY: rideClearance + bodyHeight * 0.32,
      windowH: bodyHeight * 0.28,
      hasWindowFrame: true,
      doorMaterial: mats.paintMat,
    });
    addHingedSideDoor({
      id: 'door_right',
      side: 'right',
      frontZ: doorFrontZ,
      rearZ: doorRearZ,
      mechanism: 'hinged',
      includeMirror: true,
      doorH: bodyHeight * 0.62,
      doorCenterY: rideClearance + bodyHeight * 0.32,
      windowH: bodyHeight * 0.28,
      hasWindowFrame: true,
      doorMaterial: mats.paintMat,
    });

    // Terceira porta: porta lateral de correr de 0,9 m no lado direito (índice 2)
    const slideDoorLen = 1.24;
    const slideRestZ = doorRearZ - 0.02;
    const slideRestX = width / 2 - 0.01;
    const slidePivot = new THREE.Group();
    slidePivot.name = 'door_pivot_van_sliding';
    slidePivot.position.set(slideRestX, bodyCenterY - 0.02, slideRestZ);

    const slidePanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, bodyHeight - 0.12, slideDoorLen),
      mats.paintMat
    );
    slidePanel.position.set(0.018, 0, -slideDoorLen / 2);
    slidePanel.castShadow = true;

    const slideFriso = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.085, slideDoorLen - 0.06),
      mats.trimMat
    );
    slideFriso.position.set(0.048, -0.18, -slideDoorLen / 2);

    const slideWindow = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.4, slideDoorLen - 0.22),
      mats.glassMat
    );
    slideWindow.position.set(0.035, 0.3, -slideDoorLen / 2);

    const slideHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.16), mats.trimMat);
    slideHandle.position.set(0.055, -0.02, -0.18);

    slidePivot.add(slidePanel, slideFriso, slideWindow, slideHandle);
    sprungGroup.add(slidePivot);

    const cargoWell = new THREE.Group();
    cargoWell.visible = false;
    const cargoWellRecess = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, bodyHeight - 0.14, slideDoorLen - 0.06),
      doorWellDarkMat
    );
    cargoWellRecess.position.set(width / 2 - 0.02, bodyCenterY - 0.02, slideRestZ - slideDoorLen / 2);
    const cargoCrate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 0.65), seatMat);
    cargoCrate.position.set(width / 2 - 0.38, rideClearance + 0.34, slideRestZ - slideDoorLen / 2);
    cargoWell.add(cargoWellRecess, cargoCrate);
    sprungGroup.add(cargoWell);
    doorWellGroups.push(cargoWell);

    doors.push({
      id: 'door_side_sliding',
      side: 'right',
      mechanism: 'sliding',
      pivot: slidePivot,
      openSign: -1,
      angle: 0,
      angularVel: 0,
      targetAngle: null,
      maxAngle: spec.doors.maxAngle,
      maxSlide: spec.doors.maxSlide ?? 0.9,
      slideDistance: 0,
      restPosZ: slideRestZ,
      restPosX: slideRestX,
      latched: true,
      eventState: 'closed',
      openTimer: 0,
    });
  } else {
    // Hatch, Sedã, Cupê, Esportivo, SUV, Picape, Conversível e Viatura
    const doorFrontZ = spec.doors.frontZ;
    const doorRearZ = spec.doors.rearZ;
    const doorLen = doorFrontZ - doorRearZ;
    const frontEndZ = length / 2 - 0.04;
    const rearEndZ = -length / 2 + 0.04;
    const frontLen = Math.max(0.45, frontEndZ - doorFrontZ);
    const rearLen = Math.max(0.35, doorRearZ - rearEndZ);

    const hoodMesh = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.04, bodyHeight, frontLen),
      mats.paintMat
    );
    hoodMesh.position.set(0, bodyCenterY, (frontEndZ + doorFrontZ) / 2);
    hoodMesh.castShadow = true;
    hoodMesh.receiveShadow = true;
    sprungGroup.add(hoodMesh);

    if (isPickup) {
      // Caçamba aberta na traseira da picape + tampa traseira articulada (tailgatePivot)
      const bedLen = rearLen;
      const bedMidZ = (rearEndZ + doorRearZ) / 2;
      const wallThick = 0.14;

      const bedFloor = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.12, 0.14, bedLen),
        mats.trimMat
      );
      bedFloor.position.set(0, rideClearance + 0.18, bedMidZ);
      bedFloor.receiveShadow = true;

      const leftBedWall = new THREE.Mesh(
        new THREE.BoxGeometry(wallThick, bodyHeight * 0.85, bedLen),
        mats.paintMat
      );
      leftBedWall.position.set(-(width / 2 - wallThick / 2 - 0.02), rideClearance + bodyHeight * 0.44, bedMidZ);
      leftBedWall.castShadow = true;

      const rightBedWall = new THREE.Mesh(
        new THREE.BoxGeometry(wallThick, bodyHeight * 0.85, bedLen),
        mats.paintMat
      );
      rightBedWall.position.set(width / 2 - wallThick / 2 - 0.02, rideClearance + bodyHeight * 0.44, bedMidZ);
      rightBedWall.castShadow = true;

      const cabBulkhead = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.1, bodyHeight * 0.85, 0.14),
        mats.paintMat
      );
      cabBulkhead.position.set(0, rideClearance + bodyHeight * 0.44, doorRearZ - 0.05);

      sprungGroup.add(bedFloor, leftBedWall, rightBedWall, cabBulkhead);

      // Tampa traseira pivotada na borda inferior da caçamba
      tailgatePivot = new THREE.Group();
      tailgatePivot.name = 'pickup_tailgate_pivot';
      tailgatePivot.position.set(0, rideClearance + 0.18, rearEndZ + 0.06);

      const tailgatePanel = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.3, bodyHeight * 0.78, 0.11),
        mats.paintMat
      );
      tailgatePanel.position.set(0, bodyHeight * 0.39, 0);
      tailgatePanel.castShadow = true;

      const tailgateHandle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.04), mats.trimMat);
      tailgateHandle.position.set(0, bodyHeight * 0.62, -0.06);
      tailgatePivot.add(tailgatePanel, tailgateHandle);
      sprungGroup.add(tailgatePivot);
    } else {
      const trunkMesh = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.04, bodyHeight, rearLen),
        mats.paintMat
      );
      trunkMesh.position.set(0, bodyCenterY, (rearEndZ + doorRearZ) / 2);
      trunkMesh.castShadow = true;
      trunkMesh.receiveShadow = true;
      sprungGroup.add(trunkMesh);
    }

    // Interior detalhado (assoalho, túnel, painel, volante, bancos dianteiros e traseiros em 4 portas)
    const doorMidZ = (doorFrontZ + doorRearZ) / 2;
    const floorPan = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.08, 0.14, doorLen + 0.04),
      mats.trimMat
    );
    floorPan.position.set(0, rideClearance + 0.09, doorMidZ);
    floorPan.receiveShadow = true;
    interiorGroup.add(floorPan);

    const consoleTunnel = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, Math.max(0.5, doorLen - 0.1)),
      mats.trimMat
    );
    consoleTunnel.position.set(0, rideClearance + 0.22, doorMidZ);
    interiorGroup.add(consoleTunnel);

    const dashboard = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.18, 0.34, 0.32),
      mats.trimMat
    );
    dashboard.position.set(0, rideClearance + 0.4, doorFrontZ - 0.18);
    interiorGroup.add(dashboard);

    const steeringWheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10),
      mats.trimMat
    );
    steeringWheel.rotation.x = Math.PI * 0.36;
    steeringWheel.position.set(spec.seat.driverX + 0.04, spec.seat.driverY + 0.29, spec.seat.driverZ + 0.38);
    interiorGroup.add(steeringWheel);

    const frontSeatZ = isPickup ? doorRearZ + 0.46 : spec.seat.driverZ - 0.02;
    [-0.42, 0.42].forEach((sx) => {
      const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.46), seatMat);
      seatBase.position.set(sx, rideClearance + 0.21, frontSeatZ);
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.14), seatMat);
      seatBack.position.set(sx, rideClearance + 0.46, frontSeatZ - 0.18);
      seatBack.rotation.x = -0.14;
      interiorGroup.add(seatBase, seatBack);
    });

    if (spec.doors.count >= 4 || isConvertible) {
      const rearBenchBase = new THREE.Mesh(new THREE.BoxGeometry(width - 0.36, 0.14, 0.44), seatMat);
      rearBenchBase.position.set(0, rideClearance + 0.21, doorRearZ + 0.3);
      const rearBenchBack = new THREE.Mesh(new THREE.BoxGeometry(width - 0.38, 0.44, 0.14), seatMat);
      rearBenchBack.position.set(0, rideClearance + 0.45, doorRearZ + 0.12);
      interiorGroup.add(rearBenchBase, rearBenchBack);
    }

    // Cabine / teto diferenciados por estilo
    const cabinBottomY = rideClearance + bodyHeight - 0.04;
    const cabinH = isSports ? 0.46 : isSuv ? 0.64 : isHatch ? 0.58 : isPickup ? 0.58 : 0.56;
    const cabinTopY = cabinBottomY + cabinH;
    const roofMat = isPolice ? mats.whiteDoorMat : mats.paintMat;

    if (isConvertible) {
      // Conversível sem teto: para-brisa inclinado e santantônio duplo atrás dos bancos
      const windshield = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.28, 0.42, 0.28),
        mats.glassMat
      );
      windshield.position.set(0, cabinBottomY + 0.18, doorFrontZ - 0.04);
      windshield.rotation.x = 0.48;

      const windFrame = new THREE.Mesh(new THREE.BoxGeometry(width - 0.24, 0.06, 0.08), mats.trimMat);
      windFrame.position.set(0, cabinBottomY + 0.38, doorFrontZ - 0.14);

      const hoopGeo = new THREE.BoxGeometry(0.24, 0.26, 0.1);
      [-0.42, 0.42].forEach((hx) => {
        const hoop = new THREE.Mesh(hoopGeo, mats.rimMat);
        hoop.position.set(hx, cabinBottomY + 0.14, doorRearZ + 0.05);
        sprungGroup.add(hoop);
      });
      sprungGroup.add(windshield, windFrame);

      const midWindshield = new THREE.Mesh(windshield.geometry, mats.glassMat);
      midWindshield.position.copy(windshield.position);
      midWindshield.rotation.copy(windshield.rotation);
      lod1.add(midWindshield);
    } else {
      const cabinLen = isSports
        ? 1.85
        : isPickup
        ? 1.38
        : isHatch
        ? 2.25
        : isSuv
        ? 2.68
        : 2.18;
      const cabinZ = isSports
        ? -0.18
        : isPickup
        ? 0.52
        : isHatch
        ? -0.22
        : isSuv
        ? -0.2
        : -0.06;

      const roofMesh = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.26, 0.09, cabinLen),
        roofMat
      );
      roofMesh.position.set(0, cabinTopY - 0.045, cabinZ);
      roofMesh.castShadow = true;
      sprungGroup.add(roofMesh);

      const frontGlassLen = Math.max(0.28, cabinZ + cabinLen / 2 - doorFrontZ + 0.14);
      const frontGlass = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.32, cabinH * 0.84, frontGlassLen),
        mats.glassMat
      );
      frontGlass.position.set(0, cabinBottomY + cabinH * 0.44, cabinZ + cabinLen / 2 - frontGlassLen / 2);
      sprungGroup.add(frontGlass);

      const rearGlassLen = Math.max(0.28, doorRearZ - (cabinZ - cabinLen / 2) + 0.14);
      const rearCabinBlock = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.28, cabinH * 0.9, rearGlassLen),
        roofMat
      );
      rearCabinBlock.position.set(0, cabinBottomY + cabinH * 0.45, cabinZ - cabinLen / 2 + rearGlassLen / 2);
      const rearGlass = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.26, cabinH * 0.72, rearGlassLen * 0.82),
        mats.glassMat
      );
      rearGlass.position.copy(rearCabinBlock.position);
      sprungGroup.add(rearCabinBlock, rearGlass);

      if (isHatch) {
        // Aerofólio discreto no teto traseiro do hatch
        const hatchLip = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.07, 0.22), mats.trimMat);
        hatchLip.position.set(0, cabinTopY + 0.01, cabinZ - cabinLen / 2 + 0.05);
        sprungGroup.add(hatchLip);
      }

      if (isSuv) {
        // Barras longitudinais no teto e estepe traseiro do SUV
        [-width / 2 + 0.22, width / 2 - 0.22].forEach((rx) => {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, cabinLen - 0.24), mats.trimMat);
          rail.position.set(rx, cabinTopY + 0.04, cabinZ);
          sprungGroup.add(rail);
        });
        const spareTire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12), mats.tireMat);
        spareTire.rotation.x = Math.PI / 2;
        spareTire.position.set(0, bodyCenterY + 0.1, -length / 2 - 0.04);
        sprungGroup.add(spareTire);
      }

      const midCabin = new THREE.Mesh(new THREE.BoxGeometry(width - 0.28, cabinH, cabinLen), roofMat);
      midCabin.position.set(0, cabinBottomY + cabinH / 2, cabinZ);
      lod1.add(midCabin);

      if (isPolice) {
        const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.08, 0.26), mats.trimMat);
        barBase.position.set(0, cabinTopY - 0.01, cabinZ + 0.1);
        sprungGroup.add(barBase);

        const redMat = new THREE.MeshStandardMaterial({
          color: 0xff2244,
          emissive: 0xff1133,
          emissiveIntensity: 2.2,
          roughness: 0.2,
        });
        const blueMat = new THREE.MeshStandardMaterial({
          color: 0x2288ff,
          emissive: 0x0066ff,
          emissiveIntensity: 2.2,
          roughness: 0.2,
        });
        const barHalfGeo = new THREE.BoxGeometry(0.52, 0.13, 0.22);
        lightBarRed = new THREE.Mesh(barHalfGeo, redMat);
        lightBarRed.position.set(-0.29, cabinTopY + 0.05, cabinZ + 0.1);
        lightBarBlue = new THREE.Mesh(barHalfGeo, blueMat);
        lightBarBlue.position.set(0.29, cabinTopY + 0.05, cabinZ + 0.1);
        sprungGroup.add(lightBarRed, lightBarBlue);
      }
    }

    // Construção das portas (2 portas dianteiras ou 4 portas para hatch/sedan/suv)
    if (spec.doors.hasHingedDoors) {
      const doorMat = isPolice ? mats.whiteDoorMat : mats.paintMat;
      const mechanism: VehicleDoorMechanism = spec.doors.mechanism ?? 'hinged';
      const doorWindowH = isConvertible ? 0 : cabinH * 0.72;
      const hasFrame = hasRoof;

      if (spec.doors.count >= 4) {
        const splitZ = doorRearZ + doorLen * 0.46;
        // Coluna B fina entre porta dianteira e traseira
        [-1, 1].forEach((sx) => {
          const bPillar = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, bodyHeight + cabinH * 0.85, 0.06),
            mats.trimMat
          );
          bPillar.position.set(sx * (width / 2 - 0.06), bodyCenterY + cabinH * 0.35, splitZ);
          sprungGroup.add(bPillar);
        });

        // Portas dianteiras (índices 0 e 1 -> embarque)
        addHingedSideDoor({
          id: 'door_left',
          side: 'left',
          frontZ: doorFrontZ,
          rearZ: splitZ + 0.02,
          mechanism,
          includeMirror: true,
          doorH: bodyHeight - 0.06,
          doorCenterY: bodyCenterY,
          windowH: doorWindowH,
          hasWindowFrame: hasFrame,
          doorMaterial: doorMat,
        });
        addHingedSideDoor({
          id: 'door_right',
          side: 'right',
          frontZ: doorFrontZ,
          rearZ: splitZ + 0.02,
          mechanism,
          includeMirror: true,
          doorH: bodyHeight - 0.06,
          doorCenterY: bodyCenterY,
          windowH: doorWindowH,
          hasWindowFrame: hasFrame,
          doorMaterial: doorMat,
        });

        // Portas traseiras (índices 2 e 3)
        addHingedSideDoor({
          id: 'door_rear_left',
          side: 'left',
          frontZ: splitZ - 0.02,
          rearZ: doorRearZ,
          mechanism: 'hinged',
          includeMirror: false,
          doorH: bodyHeight - 0.06,
          doorCenterY: bodyCenterY,
          windowH: doorWindowH,
          hasWindowFrame: hasFrame,
          doorMaterial: doorMat,
        });
        addHingedSideDoor({
          id: 'door_rear_right',
          side: 'right',
          frontZ: splitZ - 0.02,
          rearZ: doorRearZ,
          mechanism: 'hinged',
          includeMirror: false,
          doorH: bodyHeight - 0.06,
          doorCenterY: bodyCenterY,
          windowH: doorWindowH,
          hasWindowFrame: hasFrame,
          doorMaterial: doorMat,
        });
      } else {
        addHingedSideDoor({
          id: 'door_left',
          side: 'left',
          frontZ: doorFrontZ,
          rearZ: doorRearZ,
          mechanism,
          includeMirror: true,
          doorH: bodyHeight - 0.06,
          doorCenterY: bodyCenterY,
          windowH: doorWindowH,
          hasWindowFrame: hasFrame,
          doorMaterial: doorMat,
        });
        addHingedSideDoor({
          id: 'door_right',
          side: 'right',
          frontZ: doorFrontZ,
          rearZ: doorRearZ,
          mechanism,
          includeMirror: true,
          doorH: bodyHeight - 0.06,
          doorCenterY: bodyCenterY,
          windowH: doorWindowH,
          hasWindowFrame: hasFrame,
          doorMaterial: doorMat,
        });
      }
    }

    if (isSports) {
      const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(width - 0.12, 0.07, 0.32), mats.trimMat);
      spoilerWing.position.set(0, rideClearance + bodyHeight + 0.18, -length / 2 + 0.24);
      sprungGroup.add(spoilerWing);
      const strutGeo = new THREE.BoxGeometry(0.08, 0.16, 0.18);
      const strutL = new THREE.Mesh(strutGeo, mats.trimMat);
      strutL.position.set(-0.55, rideClearance + bodyHeight + 0.08, -length / 2 + 0.24);
      const strutR = new THREE.Mesh(strutGeo, mats.trimMat);
      strutR.position.set(0.55, rideClearance + bodyHeight + 0.08, -length / 2 + 0.24);
      sprungGroup.add(strutL, strutR);
    }
  }

  // Faróis dianteiros e lanternas traseiras
  const headGeo = new THREE.BoxGeometry(isBus ? 0.42 : 0.36, 0.15, 0.08);
  const tailGeo = new THREE.BoxGeometry(isBus ? 0.44 : 0.4, 0.15, 0.08);
  const lightXOffset = width * 0.33;
  const lightY = isBus || isAmbulance ? 0.72 : rideClearance + bodyHeight * 0.3;

  [-lightXOffset, lightXOffset].forEach((ox) => {
    const hl = new THREE.Mesh(headGeo, mats.headlightMat);
    hl.position.set(ox, lightY, length / 2 - 0.03);
    sprungGroup.add(hl);
    headlights.push(hl);

    const tl = new THREE.Mesh(tailGeo, mats.taillightMat);
    tl.position.set(ox, lightY + 0.04, -length / 2 + 0.03);
    sprungGroup.add(tl);
    taillights.push(tl);
  });

  // Quatro rodas montadas diretamente em LOD0/LOD1 para manter contato contínuo com o solo
  const wheelWidth = isSuv || isPickup || isSports ? 0.33 : 0.29;
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 12);
  wheelGeo.rotateZ(Math.PI / 2);

  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.55, wheelRadius * 0.55, wheelWidth + 0.02, 8);
  rimGeo.rotateZ(Math.PI / 2);

  const midWheelGeo = new THREE.BoxGeometry(wheelWidth, wheelRadius * 1.8, wheelRadius * 1.8);

  const frontWheelPivots: THREE.Group[] = [];
  const wheels: THREE.Mesh[] = [];

  const wheelPositions: Array<{ x: number; z: number; front: boolean }> = [
    { x: -width / 2 + 0.04, z: length / 2 - axleInset, front: true },
    { x: width / 2 - 0.04, z: length / 2 - axleInset, front: true },
    { x: -width / 2 + 0.04, z: -length / 2 + axleInset, front: false },
    { x: width / 2 - 0.04, z: -length / 2 + axleInset, front: false },
  ];

  wheelPositions.forEach((wp) => {
    const tire = new THREE.Mesh(wheelGeo, mats.tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, mats.rimMat);
    tire.add(rim);
    wheels.push(tire);

    if (wp.front) {
      const pivot = new THREE.Group();
      pivot.position.set(wp.x, wheelRadius, wp.z);
      pivot.add(tire);
      lod0.add(pivot);
      frontWheelPivots.push(pivot);
    } else {
      tire.position.set(wp.x, wheelRadius, wp.z);
      lod0.add(tire);
    }

    const midWheel = new THREE.Mesh(midWheelGeo, mats.tireMat);
    midWheel.position.set(wp.x, wheelRadius, wp.z);
    lod1.add(midWheel);
  });

  // LOD2: silhueta única leve além de 115 m
  const lod2Height = bodyHeight + (hasRoof ? (isBus ? 0.35 : 0.55) : 0.2);
  const lowSilhouette = new THREE.Mesh(new THREE.BoxGeometry(width, lod2Height, length), mats.paintMat);
  lowSilhouette.position.y = rideClearance - 0.08 + lod2Height / 2;
  lod2.add(lowSilhouette);

  const cabinVisuals: VehicleCabinVisuals = {
    glassMats: [mats.glassMat],
    doorWellGroups,
    interiorGroup,
    seatedDriverGroup,
  };

  return {
    id,
    name: spec.name,
    type: spec.type,
    class: spec.class,
    mesh: root,
    sprungGroup,
    tailgatePivot,
    paintMaterial: mats.paintMat,
    frontWheelPivots,
    wheels,
    headlights,
    taillights,
    lightBarRed,
    lightBarBlue,
    x,
    z,
    y: 0,
    pitch: 0,
    roll: 0,
    heading,
    speed: 0,
    steerAngle: 0,
    vx: 0,
    vy: 0,
    yawRate: 0,
    longAccel: 0,
    latAccel: 0,
    gear: 1,
    rpmNormalized: 0.2,
    bodyPitchOffset: 0,
    bodyPitchVel: 0,
    bodyRollOffset: 0,
    bodyRollVel: 0,
    bodyBounceY: 0,
    bodyBounceVelY: 0,
    verticalVel: 0,
    halfWidth: width / 2,
    halfLength: length / 2,
    maxSpeed: spec.handling.maxSpeed,
    accel: spec.handling.accel,
    driver: isPolice ? 'police' : isBus ? 'bus' : isAmbulance ? 'ambulance' : 'npc',
    paintHex: baseColor,
    finish,
    busPassengerCount: 0,
    seat: { ...spec.seat },
    handling: { ...spec.handling },
    physicsAccum: 0,
    doors,
    cabinVisuals,
    prevSpeed: 0,
    prevHeading: heading,
  };
}
