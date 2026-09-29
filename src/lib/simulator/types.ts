import { z } from 'zod';

// Schemas mirror the simulator's documented and measured responses.
// Responses that fail validation are rejected (brief §11: invalid response → reject + alert).

export const FUEL_TYPES = ['DIESEL', 'PETROL', 'OCTANE'] as const;
export const FuelTypeSchema = z.enum(FUEL_TYPES);
export type FuelType = z.infer<typeof FuelTypeSchema>;

export const FuelAmountsSchema = z.object({
  DIESEL: z.number(),
  PETROL: z.number(),
  OCTANE: z.number(),
});
export type FuelAmounts = z.infer<typeof FuelAmountsSchema>;

export const HealthSchema = z.object({
  status: z.string(),
  database: z.string(),
  simulation: z.object({
    status: z.enum(['PAUSED', 'RUNNING']),
    tick: z.number().int(),
  }),
});
export type SimulatorHealth = z.infer<typeof HealthSchema>;

export const InstanceSchema = z.object({
  id: z.number(),
  scenario_id: z.string(),
  scenario_version: z.string(),
  seed: z.number(),
  sim_time: z.string(),
  tick: z.number().int().min(0),
  tick_minutes: z.number().positive(),
  status: z.enum(['PAUSED', 'RUNNING']),
});
export type Instance = z.infer<typeof InstanceSchema>;

export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  demand_factor: z.number(),
});
export type Region = z.infer<typeof RegionSchema>;

export const DepotSchema = z.object({
  id: z.string(),
  name: z.string(),
  region_id: z.string(),
  status: z.enum(['OPEN', 'CONSTRAINED']),
  dispatch_capacity_per_tick: z.number().nonnegative(),
  capacity: FuelAmountsSchema,
  inventory: FuelAmountsSchema,
});
export type Depot = z.infer<typeof DepotSchema>;

export const StationSchema = z.object({
  id: z.string(),
  name: z.string(),
  region_id: z.string(),
  status: z.enum(['OPEN', 'OUTAGE']),
  demand_profile: z.string(),
  demand_multiplier: z.number(),
  capacity: FuelAmountsSchema,
  inventory: FuelAmountsSchema,
});
export type Station = z.infer<typeof StationSchema>;

export const RouteSchema = z.object({
  id: z.string(),
  source_depot_id: z.string(),
  destination_station_id: z.string(),
  transit_ticks: z.number().int().positive(),
  max_shipment: z.number().positive(),
  status: z.enum(['AVAILABLE', 'DISRUPTED']),
});
export type Route = z.infer<typeof RouteSchema>;

export const SupplyArrivalSchema = z.object({
  id: z.string(),
  depot_id: z.string(),
  fuel_type: FuelTypeSchema,
  quantity: z.number().nonnegative(),
  planned_tick: z.number().int(),
  actual_tick: z.number().int().nullable(),
  status: z.enum(['SCHEDULED', 'DELAYED', 'ARRIVED']),
});
export type SupplyArrival = z.infer<typeof SupplyArrivalSchema>;

export const EVENT_TYPES = [
  'demand_spike',
  'route_disruption',
  'station_outage',
  'depot_constraint',
  'shipment_delay',
  'supply_shortfall',
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const SimEventSchema = z.object({
  id: z.number(),
  type: EventTypeSchema,
  start_tick: z.number().int(),
  end_tick: z.number().int(),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'RESOLVED']),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
export type SimEvent = z.infer<typeof SimEventSchema>;

export const ALLOCATION_STATUSES = [
  'PENDING',
  'IN_TRANSIT',
  'ARRIVED',
  'FAILED',
  'CANCELLED',
] as const;
export const AllocationSchema = z.object({
  id: z.number(),
  idempotency_key: z.string(),
  source_depot_id: z.string(),
  destination_station_id: z.string(),
  route_id: z.string(),
  fuel_type: FuelTypeSchema,
  quantity: z.number(),
  created_tick: z.number().int(),
  departure_tick: z.number().int().nullable(),
  expected_arrival_tick: z.number().int().nullable(),
  actual_arrival_tick: z.number().int().nullable(),
  status: z.enum(ALLOCATION_STATUSES),
  failure_reason: z.string().nullable(),
});
export type Allocation = z.infer<typeof AllocationSchema>;

export const DemandObservationSchema = z.object({
  id: z.number(),
  station_id: z.string(),
  fuel_type: FuelTypeSchema,
  tick: z.number().int(),
  sim_time: z.string(),
  demand_liters: z.number().nonnegative(),
  served_liters: z.number().nonnegative(),
  unmet_liters: z.number().nonnegative(),
});
export type DemandObservation = z.infer<typeof DemandObservationSchema>;

export const SimMetricsSchema = z.object({
  served_demand_liters: z.number(),
  unmet_demand_liters: z.number(),
  service_level: z.number(),
  allocation_liters: z.number(),
  allocation_failures: z.number().int(),
});
export type SimMetrics = z.infer<typeof SimMetricsSchema>;

export const StepResultSchema = z.object({
  tick: z.number().int(),
  sim_time: z.string(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const AllocationRequestSchema = z.object({
  idempotency_key: z.string().min(1).max(150),
  source_depot_id: z.string().min(1),
  destination_station_id: z.string().min(1),
  route_id: z.string().min(1),
  fuel_type: FuelTypeSchema,
  quantity: z.number().positive(),
});
export type AllocationRequest = z.infer<typeof AllocationRequestSchema>;

export const EventInjectionSchema = z.object({
  type: EventTypeSchema,
  start_tick: z.number().int().min(0),
  duration_ticks: z.number().int().positive(),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
export type EventInjection = z.infer<typeof EventInjectionSchema>;

export const FAULT_TYPES = [
  'latency',
  'unavailable',
  'error_rate',
  'stale_data',
  'stream_disconnect',
] as const;
export const FaultInjectionSchema = z.object({
  type: z.enum(FAULT_TYPES),
  duration_seconds: z.number().int().positive().max(3600),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
export type FaultInjection = z.infer<typeof FaultInjectionSchema>;
