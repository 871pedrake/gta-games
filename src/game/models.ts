import * as THREE from 'three';
export { createVehicleEntity } from './vehicles/createVehicleEntity';

export function applyTextureQuality(
  tex: THREE.Texture,
  maxAnisotropy: number,
  mipmaps = true
): void {
  tex.anisotropy = Math.max(1, maxAnisotropy);
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
}

// Cria textura radial suave para sombra de contato sob personagens e veículos
export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(6, 4, 16, 0.72)');
  grad.addColorStop(0.55, 'rgba(6, 4, 16, 0.34)');
  grad.addColorStop(1, 'rgba(6, 4, 16, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cria textura radial em estrela para o flash do cano (retorna null em ambiente headless)
export function createMuzzleFlashTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;

  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 240, 1.0)');
  grad.addColorStop(0.32, 'rgba(255, 215, 96, 0.92)');
  grad.addColorStop(0.68, 'rgba(255, 128, 32, 0.45)');
  grad.addColorStop(1, 'rgba(255, 90, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  // Pontas de estrela cartoon no flash
  ctx.save();
  ctx.translate(32, 32);
  ctx.fillStyle = 'rgba(255, 248, 200, 0.85)';
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cria textura procedural de fachada com janelas iluminadas e acabamento Art Déco
export function createBuildingFacadeTexture(
  baseHex: string,
  windowLitHex: string,
  maxAnisotropy: number,
  mipmaps = true
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 512);

  // Faixas sutis verticais de concreto
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, 0, 18, 512);
  ctx.fillRect(238, 0, 18, 512);

  // Grade de janelas
  const cols = 4;
  const rows = 10;
  const padX = 28;
  const padY = 24;
  const cellW = (256 - padX * 2) / cols;
  const cellH = (512 - padY * 2) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = padX + c * cellW + 6;
      const wy = padY + r * cellH + 8;
      const ww = cellW - 12;
      const wh = cellH - 16;

      // Alternância determinística de janelas acesas/apagadas
      const lit = ((r * 7 + c * 13) % 5) !== 0;
      ctx.fillStyle = lit ? windowLitHex : '#1b1d36';
      ctx.fillRect(wx, wy, ww, wh);

      // Moldura fina superior
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(wx, wy, ww, 3);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  applyTextureQuality(tex, maxAnisotropy, mipmaps);
  return tex;
}

// Cria textura procedural de asfalto com faixas de rua
export function createAsphaltTexture(maxAnisotropy: number, mipmaps = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1c1d2e';
  ctx.fillRect(0, 0, 256, 256);

  // Granulação sutil do asfalto
  for (let i = 0; i < 1600; i++) {
    const x = (i * 73) % 256;
    const y = (i * 137) % 256;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  applyTextureQuality(tex, maxAnisotropy, mipmaps);
  return tex;
}

// Cria textura de areia da praia com marcas sutis de vento
export function createSandTexture(maxAnisotropy: number, mipmaps = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e7c28e';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 2000; i++) {
    const x = (i * 53) % 256;
    const y = (i * 97) % 256;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 240, 210, 0.16)' : 'rgba(180, 128, 72, 0.12)';
    ctx.fillRect(x, y, 2, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  applyTextureQuality(tex, maxAnisotropy, mipmaps);
  return tex;
}

export interface PlayerRig {
  root: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  torsoGroup: THREE.Group;
  weaponMount?: THREE.Group;
  muzzleTip?: THREE.Object3D;
  weaponMeshes?: Record<string, THREE.Group>;
  weaponMuzzles?: Record<string, THREE.Object3D>;
}

export function setPlayerRigWeapon(rig: PlayerRig, weaponId: string): void {
  if (!rig.weaponMeshes) return;
  for (const [id, meshGroup] of Object.entries(rig.weaponMeshes)) {
    meshGroup.visible = id === weaponId;
  }
  if (rig.weaponMuzzles && rig.weaponMuzzles[weaponId]) {
    rig.muzzleTip = rig.weaponMuzzles[weaponId];
  }
}

// Constrói o personagem do jogador em estilo low-poly articulado (9 partes distintas)
export function createPlayerModel(shadowTex: THREE.CanvasTexture): PlayerRig {
  const root = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd99b72, roughness: 0.65, metalness: 0.05 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0xff3b7f, roughness: 0.42, metalness: 0.12 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x16f2d4, roughness: 0.55, metalness: 0.05 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e223d, roughness: 0.82, metalness: 0.04 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf4f5fb, roughness: 0.5, metalness: 0.08 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x14111f, roughness: 0.78, metalness: 0.05 });
  const shadesMat = new THREE.MeshStandardMaterial({
    color: 0x0b0f1c,
    roughness: 0.12,
    metalness: 0.85,
    emissive: 0x093545,
    emissiveIntensity: 0.4,
  });

  // Sombra de contato no chão
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.02;
  root.add(shadowPlane);

  // Pernas articuladas no quadril (y = 0.78)
  const makeLeg = (xOffset: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, 0.78, 0);

    const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.66, 0.24), pantsMat);
    legMesh.position.y = -0.33;
    legMesh.castShadow = true;
    pivot.add(legMesh);

    const shoeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.34), shoeMat);
    shoeMesh.position.set(0, -0.71, 0.04);
    shoeMesh.castShadow = true;
    pivot.add(shoeMesh);

    return pivot;
  };

  const leftLegPivot = makeLeg(-0.15);
  const rightLegPivot = makeLeg(0.15);
  root.add(leftLegPivot, rightLegPivot);

  // Tronco + cabeça
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.78, 0);
  root.add(torsoGroup);

  // Jaqueta aberta
  const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.32), jacketMat);
  jacket.position.y = 0.34;
  jacket.castShadow = true;
  torsoGroup.add(jacket);

  // Camisa interna neon ciano
  const innerShirt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.64, 0.34), shirtMat);
  innerShirt.position.set(0, 0.34, 0.01);
  torsoGroup.add(innerShirt);

  // Cabeça
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skinMat);
  head.position.y = 0.88;
  head.castShadow = true;
  torsoGroup.add(head);

  // Cabelo estilizado
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.4), hairMat);
  hair.position.set(0, 1.07, -0.02);
  torsoGroup.add(hair);

  // Óculos escuros estilo Vice
  const shades = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.08), shadesMat);
  shades.position.set(0, 0.9, 0.18);
  torsoGroup.add(shades);

  // Braços articulados nos ombros
  const makeArm = (xOffset: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, 0.62, 0);

    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.2), jacketMat);
    sleeve.position.y = -0.21;
    sleeve.castShadow = true;
    pivot.add(sleeve);

    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.16), skinMat);
    hand.position.y = -0.49;
    pivot.add(hand);

    return pivot;
  };

  const leftArmPivot = makeArm(-0.38);
  const rightArmPivot = makeArm(0.38);
  torsoGroup.add(leftArmPivot, rightArmPivot);

  // Montagem de armas na mão direita (eixo -Y local do braço = para frente ao mirar com rot.x = -PI/2)
  const weaponMount = new THREE.Group();
  weaponMount.position.set(0, -0.5, 0.06);
  rightArmPivot.add(weaponMount);

  const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x1b2133, roughness: 0.38, metalness: 0.72 });
  const gunSteelMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.22, metalness: 0.88 });
  const gunPolymerMat = new THREE.MeshStandardMaterial({ color: 0x111521, roughness: 0.78, metalness: 0.08 });
  const gunAccentMat = new THREE.MeshStandardMaterial({
    color: 0x16f2d4,
    roughness: 0.25,
    metalness: 0.35,
    emissive: 0x074b44,
    emissiveIntensity: 0.45,
  });
  const gunWoodMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.72, metalness: 0.06 });

  const makeWeaponBox = (w: number, h: number, d: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(0, y, z);
    m.castShadow = true;
    return m;
  };

  const makeMuzzleNode = (y: number, z: number) => {
    const node = new THREE.Object3D();
    node.name = 'muzzle';
    node.position.set(0, y, z);
    return node;
  };

  // Pistola 9mm (5 partes + muzzle)
  const pistolGroup = new THREE.Group();
  pistolGroup.add(makeWeaponBox(0.056, 0.125, 0.078, -0.02, 0.008, gunPolymerMat)); // punho ergonômico
  pistolGroup.add(makeWeaponBox(0.042, 0.055, 0.045, -0.08, 0.025, gunDarkMat)); // guarda-mato
  pistolGroup.add(makeWeaponBox(0.058, 0.21, 0.036, -0.14, 0.055, gunDarkMat)); // armação inferior
  pistolGroup.add(makeWeaponBox(0.064, 0.235, 0.052, -0.15, 0.095, gunSteelMat)); // ferrolho metálico
  pistolGroup.add(makeWeaponBox(0.018, 0.024, 0.02, -0.25, 0.126, gunAccentMat)); // massa de mira
  const pistolMuzzle = makeMuzzleNode(-0.28, 0.09);
  pistolGroup.add(pistolMuzzle);
  pistolGroup.visible = false;
  weaponMount.add(pistolGroup);

  // SMG MP-Solara (6 partes + muzzle)
  const smgGroup = new THREE.Group();
  smgGroup.add(makeWeaponBox(0.062, 0.11, 0.075, -0.02, 0.01, gunPolymerMat)); // punho
  smgGroup.add(makeWeaponBox(0.074, 0.31, 0.105, -0.155, 0.075, gunDarkMat)); // receptor
  smgGroup.add(makeWeaponBox(0.052, 0.17, 0.088, -0.17, -0.035, gunPolymerMat)); // carregador longo
  smgGroup.add(makeWeaponBox(0.046, 0.14, 0.05, 0.03, 0.072, gunSteelMat)); // coronha rebatível
  smgGroup.add(makeWeaponBox(0.042, 0.16, 0.044, -0.37, 0.078, gunSteelMat)); // cano com supressor curto
  smgGroup.add(makeWeaponBox(0.022, 0.06, 0.022, -0.15, 0.136, gunAccentMat)); // mira holográfica
  const smgMuzzle = makeMuzzleNode(-0.46, 0.078);
  smgGroup.add(smgMuzzle);
  smgGroup.visible = false;
  weaponMount.add(smgGroup);

  // Escopeta (6 partes + muzzle)
  const shotgunGroup = new THREE.Group();
  shotgunGroup.add(makeWeaponBox(0.074, 0.23, 0.098, 0.065, 0.045, gunWoodMat)); // coronha de madeira
  shotgunGroup.add(makeWeaponBox(0.072, 0.21, 0.095, -0.11, 0.075, gunDarkMat)); // caixa da culatra
  shotgunGroup.add(makeWeaponBox(0.044, 0.38, 0.044, -0.37, 0.092, gunSteelMat)); // cano superior
  shotgunGroup.add(makeWeaponBox(0.038, 0.34, 0.038, -0.35, 0.056, gunDarkMat)); // tubo carregador
  shotgunGroup.add(makeWeaponBox(0.076, 0.17, 0.065, -0.29, 0.05, gunWoodMat)); // telha pump
  shotgunGroup.add(makeWeaponBox(0.018, 0.022, 0.02, -0.54, 0.118, gunAccentMat)); // mira frontal
  const shotgunMuzzle = makeMuzzleNode(-0.575, 0.092);
  shotgunGroup.add(shotgunMuzzle);
  shotgunGroup.visible = false;
  weaponMount.add(shotgunGroup);

  // Fuzil de Assalto (7 partes + muzzle)
  const rifleGroup = new THREE.Group();
  rifleGroup.add(makeWeaponBox(0.07, 0.21, 0.098, 0.065, 0.055, gunPolymerMat)); // coronha tática
  rifleGroup.add(makeWeaponBox(0.058, 0.11, 0.072, -0.02, 0.008, gunPolymerMat)); // punho
  rifleGroup.add(makeWeaponBox(0.076, 0.28, 0.105, -0.15, 0.078, gunDarkMat)); // receptor
  rifleGroup.add(makeWeaponBox(0.068, 0.21, 0.088, -0.36, 0.078, gunPolymerMat)); // guarda-mão tático
  rifleGroup.add(makeWeaponBox(0.036, 0.24, 0.036, -0.54, 0.082, gunSteelMat)); // cano longo + quebra-chama
  rifleGroup.add(makeWeaponBox(0.052, 0.175, 0.088, -0.185, -0.04, gunPolymerMat)); // carregador curvo
  rifleGroup.add(makeWeaponBox(0.034, 0.11, 0.038, -0.16, 0.142, gunAccentMat)); // mira óptica tática
  const rifleMuzzle = makeMuzzleNode(-0.67, 0.082);
  rifleGroup.add(rifleMuzzle);
  rifleGroup.visible = false;
  weaponMount.add(rifleGroup);

  const weaponMeshes: Record<string, THREE.Group> = {
    pistol: pistolGroup,
    smg: smgGroup,
    shotgun: shotgunGroup,
    rifle: rifleGroup,
  };

  const weaponMuzzles: Record<string, THREE.Object3D> = {
    pistol: pistolMuzzle,
    smg: smgMuzzle,
    shotgun: shotgunMuzzle,
    rifle: rifleMuzzle,
  };

  const muzzleTip: THREE.Object3D = pistolMuzzle;

  return {
    root,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    torsoGroup,
    weaponMount,
    muzzleTip,
    weaponMeshes,
    weaponMuzzles,
  };
}

// A construção de veículos foi modularizada em src/game/vehicles/ (builders por classe) e re-exportada acima.

// Constrói rig articulado para os paramédicos NPC da ambulância
export function createParamedicRig(shadowTex: THREE.CanvasTexture): PlayerRig {
  const root = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd99b72, roughness: 0.65 });
  const coatMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.72 });
  const redCrossMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0x991b1b,
    emissiveIntensity: 0.4,
  });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x0d9488, roughness: 0.55 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });

  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 1.0),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.02;
  root.add(shadowPlane);

  const makeLeg = (xOffset: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, 0.74, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), pantsMat);
    leg.position.y = -0.31;
    leg.castShadow = true;
    pivot.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.3), shoeMat);
    shoe.position.set(0, -0.67, 0.04);
    pivot.add(shoe);
    return pivot;
  };

  const leftLegPivot = makeLeg(-0.14);
  const rightLegPivot = makeLeg(0.14);
  root.add(leftLegPivot, rightLegPivot);

  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.74, 0);
  root.add(torsoGroup);

  const coat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.3), coatMat);
  coat.position.y = 0.33;
  coat.castShadow = true;
  torsoGroup.add(coat);

  // Cruz vermelha nas costas e no peito
  const crossBackH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.32), redCrossMat);
  crossBackH.position.y = 0.36;
  const crossBackV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.32), redCrossMat);
  crossBackV.position.y = 0.36;
  torsoGroup.add(crossBackH, crossBackV);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
  head.position.y = 0.86;
  head.castShadow = true;
  torsoGroup.add(head);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.38), capMat);
  cap.position.set(0, 1.04, 0);
  torsoGroup.add(cap);

  const makeArm = (xOffset: number, withMedkit: boolean) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, 0.6, 0);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.18), coatMat);
    sleeve.position.y = -0.21;
    pivot.add(sleeve);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.15), skinMat);
    hand.position.y = -0.47;
    pivot.add(hand);
    if (withMedkit) {
      const kit = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.34), redCrossMat);
      kit.position.set(0.06, -0.56, 0.04);
      pivot.add(kit);
    }
    return pivot;
  };

  const leftArmPivot = makeArm(-0.35, false);
  const rightArmPivot = makeArm(0.35, true);
  torsoGroup.add(leftArmPivot, rightArmPivot);

  return {
    root,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    torsoGroup,
  };
}

// Constrói uma palmeira litorânea low-poly composta (tronco curvo em 4 segmentos + 6 folhas + cocos)
export function createPalmTree(scale = 1, seed = 0): THREE.Group {
  const palm = new THREE.Group();

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x7b5438,
    roughness: 0.9,
    metalness: 0.02,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x22b573,
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const coconutMat = new THREE.MeshStandardMaterial({
    color: 0x4b2e1b,
    roughness: 0.85,
  });

  let curY = 0;
  let curX = 0;
  const leanDir = (seed % 2 === 0 ? 1 : -1) * 0.26;

  for (let i = 0; i < 4; i++) {
    const segH = 1.65;
    const rBottom = 0.28 - i * 0.04;
    const rTop = 0.24 - i * 0.04;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, segH, 7), trunkMat);
    seg.position.set(curX + leanDir * i * 0.35, curY + segH / 2, 0);
    seg.rotation.z = -leanDir * (i * 0.14);
    seg.castShadow = true;
    palm.add(seg);
    curY += segH - 0.12;
    curX += leanDir * i * 0.25;
  }

  const crown = new THREE.Group();
  crown.position.set(curX + leanDir * 0.5, curY, 0);
  palm.add(crown);

  // Cocos no topo
  for (let c = 0; c < 3; c++) {
    const a = (c * Math.PI * 2) / 3;
    const coco = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), coconutMat);
    coco.position.set(Math.cos(a) * 0.24, -0.12, Math.sin(a) * 0.24);
    crown.add(coco);
  }

  // 6 folhas em leque arqueado
  const frondGeo = new THREE.ConeGeometry(0.48, 2.8, 4);
  frondGeo.scale(1.1, 1, 0.18);
  frondGeo.translate(0, 1.4, 0);
  frondGeo.rotateX(Math.PI * 0.38);

  for (let f = 0; f < 6; f++) {
    const frond = new THREE.Mesh(frondGeo, leafMat);
    frond.rotation.y = (f * Math.PI * 2) / 6 + (seed % 3) * 0.2;
    frond.rotation.x = 0.12;
    frond.castShadow = true;
    crown.add(frond);
  }

  palm.scale.setScalar(scale);
  return palm;
}

// Constrói pacote de dinheiro flutuante colecionável
export function createCashPickupMesh(): THREE.Group {
  const group = new THREE.Group();

  const billMat = new THREE.MeshStandardMaterial({
    color: 0x22f59a,
    emissive: 0x0fb86b,
    emissiveIntensity: 0.75,
    roughness: 0.35,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    roughness: 0.4,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x22f59a,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });

  const bundle = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.32, 0.42), billMat);
  bundle.position.y = 0.85;
  group.add(bundle);

  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.45), bandMat);
  strap.position.y = 0.85;
  group.add(strap);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 20), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  return group;
}
