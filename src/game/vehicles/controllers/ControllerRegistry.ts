import { VehicleClass } from '../../types';
import { BikeController } from './BikeController';
import { CarController } from './CarController';
import { HeliController } from './HeliController';
import { PlaneController } from './PlaneController';
import { VehicleController } from './VehicleController';

const CONTROLLERS: Record<VehicleClass, VehicleController> = {
  car: new CarController(),
  bike: new BikeController(),
  heli: new HeliController(),
  plane: new PlaneController(),
};

/**
 * Retorna o controlador correspondente à classe do veículo.
 */
export function getVehicleController(vehicleClass: VehicleClass): VehicleController {
  return CONTROLLERS[vehicleClass];
}
