import type { components } from '../schema';
import { toCan } from './account';

export type ApiDimension = components['schemas']['DimensionResource'];
export type ApiDimensionValue = components['schemas']['DimensionValueResource'];

export interface LiveDimensionValue {
  id: string;
  dimension_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  version: number;
}

export interface LiveDimension {
  id: string;
  code: string;
  name: string;
  position: number;
  is_active: boolean;
  version: number;
  values: LiveDimensionValue[];
  can: { update: boolean; deactivate: boolean };
}

export function toDimensionValue(v: ApiDimensionValue): LiveDimensionValue {
  return { id: v.id, dimension_id: v.dimension_id, code: v.code, name: v.name, parent_id: v.parent_id, is_active: v.is_active, version: v.version };
}

export function toDimension(d: ApiDimension): LiveDimension {
  const can = toCan(d.can);
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    position: d.position,
    is_active: d.is_active,
    version: d.version,
    values: (d.values ?? []).map(toDimensionValue),
    can: { update: can.update === true, deactivate: can.deactivate === true },
  };
}
